const MAX_SOURCE_BYTES = 256 * 1024;
const RENDER_TIMEOUT_MS = 35_000;

let graphvizPromise;
let mermaidPromise;
let tikzPromise;

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
      startOnLoad: false,
      securityLevel: "strict",
      deterministicIds: true,
      suppressErrorRendering: true,
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
  return result.svg;
}

function normalizeTikzSource(source) {
  const text = assertSafeSource(source);
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
      script.onerror = () => reject(new Error("TikZJax 本地运行时加载失败"));
      document.head.appendChild(script);
    });
  }
  await tikzPromise;
}

export async function renderTikz(source, { packageProfiles = [], host } = {}) {
  if (!host) throw new Error("TikZ 预览容器不可用");
  await loadTikzRuntime();
  const script = document.createElement("script");
  script.type = "text/tikz";
  script.dataset.disableCache = "false";
  script.dataset.width = "320";
  script.dataset.height = "220";
  if (packageProfiles.includes("pgf_plots")) {
    // TikZJax normalizes this data attribute as JSON before it reaches the
    // worker.  Use the object form so package loading is deterministic across
    // the bundled and development runtimes.
    script.dataset.texPackages = JSON.stringify({ pgfplots: "" });
    script.dataset.addToPreamble = "\\pgfplotsset{compat=1.18}";
  }
  script.textContent = normalizeTikzSource(source);

  const rendered = new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (host.querySelector(".tikzjax-broken-wrapper,.tikzjax-error")) {
        observer.disconnect();
        reject(new Error("TikZ 编译失败，请检查源码或包设置"));
      }
    });
    observer.observe(host, { childList: true, subtree: true });
    host.addEventListener(
      "tikzjax-load-finished",
      (event) => {
        observer.disconnect();
        const svg = event.target?.closest?.("svg") || host.querySelector("svg");
        if (!svg) reject(new Error("TikZ 渲染未生成 SVG"));
        else resolve(svg.outerHTML);
      },
      { once: true },
    );
    host.replaceChildren(script);
  });
  return withTimeout(rendered);
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
      return renderTikz(source, { packageProfiles, host: previewHost });
    case "svg_source":
      return assertSafeSource(source);
    default:
      throw new Error(`暂不支持的本地绘图语言：${language}`);
  }
}
