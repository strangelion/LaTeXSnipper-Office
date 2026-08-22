const MAX_SOURCE_BYTES = 256 * 1024;
const RENDER_TIMEOUT_MS = 35_000;

let graphvizPromise;
let mermaidPromise;
let tikzPromise;

export const MERMAID_RENDER_OPTIONS = Object.freeze({
  startOnLoad: false,
  securityLevel: "strict",
  deterministicIds: true,
  suppressErrorRendering: true,
  htmlLabels: false,
  flowchart: Object.freeze({ htmlLabels: false }),
});

export function normalizeMermaidRenderId(id) {
  const safe = String(id || "drawing").replace(/[^a-z0-9_-]/gi, "-");
  return `mermaid-${safe}`;
}

function assertSafeSource(source) {
  const text = String(source || "");
  if (!text.trim()) throw new Error("绘图源码不能为空");
  if (new TextEncoder().encode(text).length > MAX_SOURCE_BYTES) {
    throw new Error("绘图源码超过 256 KiB 安全限制");
  }
  return text;
}

function withTimeout(promise, timeout = RENDER_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("本地渲染超时")), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function renderGraphviz(source, engine = "dot") {
  const text = assertSafeSource(source);
  graphvizPromise ||= import("@viz-js/viz").then(({ instance }) => instance());
  const viz = await graphvizPromise;
  return withTimeout(viz.renderString(text, { engine, format: "svg" }), 15_000);
}

export async function renderMermaid(source, id = `mermaid-${Date.now()}`) {
  const text = assertSafeSource(source);
  mermaidPromise ||= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      ...MERMAID_RENDER_OPTIONS,
      theme:
        document.documentElement.dataset.theme === "dark" ? "dark" : "default",
    });
    return mermaid;
  });
  const mermaid = await mermaidPromise;
  const result = await withTimeout(
    mermaid.render(normalizeMermaidRenderId(id), text),
    15_000,
  );
  return normalizeBundledSvg(result.svg, "Mermaid");
}

export function normalizeBundledSvg(svg, renderer = "绘图") {
  const source = String(svg || "").trim();
  if (!/^<svg[\s>]/i.test(source)) {
    throw new Error(`${renderer} 未生成有效 SVG`);
  }
  if (/<(?:script|foreignObject|iframe|object|embed)\b/i.test(source)) {
    throw new Error(`${renderer} 生成了不支持的嵌入内容`);
  }
  // XHTML is an identifier rather than a fetched resource, but Core's
  // fail-closed URL scan intentionally only grants the SVG/XLink namespaces.
  // htmlLabels=false means Mermaid does not need this declaration, so remove
  // any inert declaration left by a renderer version before verification.
  return source
    .replace(
      /\s+xmlns(?::[\w.-]+)?=["']http:\/\/www\.w3\.org\/1999\/xhtml["']/gi,
      "",
    )
    .replace(/http:\/\/www\.w3\.org\/1999\/xhtml/gi, "");
}

function normalizeTikzSource(source) {
  const text = assertSafeSource(source);
  if (/[^\u0000-\u007f]/.test(text)) {
    throw new Error(
      "内置 TikZ/PGFPlots 运行时不包含 CJK/Unicode 数学字体；请将中文图例或节点改为 ASCII，并用 \\alpha、\\angle 等 LaTeX 命令输入数学符号",
    );
  }
  return /\\begin\s*\{tikzpicture\}/.test(text)
    ? text
    : `\\begin{tikzpicture}\n${text}\n\\end{tikzpicture}`;
}

async function loadTikzRuntime() {
  if (!tikzPromise) {
    const assetBaseUrl = new URL("./vendor/tikzjax/", document.baseURI).href;
    globalThis.TikzJaxOptions = {
      assetBaseUrl,
      workerUrl: `${assetBaseUrl}run-tex.js`,
      workerMode: "direct",
      renderTimeout: 30_000,
      maxRetries: 1,
      restartWorkerOnFail: true,
      workerPool: {
        enabled: true,
        maxWorkers: 2,
        reserveCpuCores: 1,
        useDeviceMemory: true,
        initializationRetries: 1,
      },
      theme: {
        selector: "html",
        attribute: "data-theme",
        darkValue: "dark",
        lightValue: "light",
        applyTargetStyles: false,
      },
    };
    tikzPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById("latexsnipper-tikzjax-loader");
      if (existing) existing.remove();
      const script = document.createElement("script");
      script.id = "latexsnipper-tikzjax-loader";
      script.src = `${assetBaseUrl}tikzjax.min.js`;
      script.async = true;
      script.onload = resolve;
      script.onerror = () =>
        reject(
          new Error(
            `TikZJax 本地运行时加载失败（${script.src}）；请检查安装资源完整性`,
          ),
        );
      document.head.appendChild(script);
    }).catch((error) => {
      tikzPromise = null;
      throw error;
    });
  }
  await tikzPromise;
}

export async function renderTikz(source, { packageProfiles = [], host } = {}) {
  if (!host) throw new Error("TikZ 预览容器不可用");
  const normalizedSource = normalizeTikzSource(source);
  await loadTikzRuntime();
  const script = document.createElement("script");
  script.type = "text/tikz";
  script.dataset.disableCache = "true";
  script.dataset.width = "320";
  script.dataset.height = "220";
  if (packageProfiles.includes("pgf_plots")) {
    // TikZJax normalizes this data attribute as JSON before it reaches the
    // worker.  Use the object form so package loading is deterministic across
    // the bundled and development runtimes.
    script.dataset.texPackages = JSON.stringify({ pgfplots: "" });
    script.dataset.addToPreamble = "\\pgfplotsset{compat=1.18}";
  }
  script.textContent = normalizedSource;

  const rendered = new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const errorNode = host.querySelector(
        ".tikzjax-error,.tikzjax-broken-wrapper",
      );
      if (errorNode) {
        observer.disconnect();
        const detail = String(errorNode.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 360);
        reject(
          new Error(
            detail
              ? `TikZ 编译失败：${detail}`
              : "TikZ 编译失败；本地 TeX 运行时未生成 DVI。请检查命令、括号与所需包",
          ),
        );
      }
    });
    observer.observe(host, { childList: true, subtree: true });
    host.addEventListener(
      "tikzjax-load-finished",
      (event) => {
        observer.disconnect();
        const svg = event.target?.closest?.("svg") || host.querySelector("svg");
        if (!svg) reject(new Error("TikZ 渲染未生成 SVG"));
        else resolve(normalizeBundledSvg(svg.outerHTML, "TikZ"));
      },
      { once: true },
    );
    host.replaceChildren(script);
  });
  return withTimeout(rendered);
}

async function renderTikzIsolated(source, packageProfiles, previewHost) {
  const documentRef = previewHost?.ownerDocument || globalThis.document;
  if (!documentRef?.body?.appendChild) {
    return renderTikz(source, { packageProfiles, host: previewHost });
  }
  const stagingHost = documentRef.createElement("div");
  stagingHost.setAttribute("aria-hidden", "true");
  stagingHost.style.position = "fixed";
  stagingHost.style.left = "-100000px";
  stagingHost.style.top = "0";
  stagingHost.style.width = "320px";
  stagingHost.style.height = "220px";
  // Keep the node fully laid out. TikZJax deprioritizes visibility:hidden
  // targets and WebView layout engines may report zero geometry for them.
  stagingHost.style.opacity = "0";
  stagingHost.style.pointerEvents = "none";
  documentRef.body.appendChild(stagingHost);
  try {
    return await renderTikz(source, {
      packageProfiles,
      host: stagingHost,
    });
  } finally {
    stagingHost.remove();
  }
}

export async function renderDrawingLocally({
  language,
  source,
  packageProfiles = [],
  graphvizEngine = "dot",
  previewHost,
  renderId,
}) {
  switch (language) {
    case "graphviz_dot":
      return renderGraphviz(source, graphvizEngine);
    case "mermaid":
      return renderMermaid(source, renderId);
    case "tikz":
      return renderTikzIsolated(source, packageProfiles, previewHost);
    case "svg_source":
      return assertSafeSource(source);
    default:
      throw new Error(`暂不支持的本地绘图语言：${language}`);
  }
}
