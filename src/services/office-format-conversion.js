import {
  prepareSelectionConversion,
  executeSelectionConversion,
} from "./office-selection-conversion.js";

const consumed = new WeakSet();
const preparedCommits = new WeakMap();
export const FORMAT_NAMES = {
  omml: "Word 原生公式（OMML）",
  ole: "LaTeXSnipper OLE",
  svg: "SVG 矢量图",
  png: "PNG 图片",
  latex: "LaTeX 源码",
  mathtype: "MathType（MTEF）",
};

export function conversionChoices(context, source) {
  const nativeWord =
    context.native && context.host === "word" && context.documentContext;
  const rawWord = context.host === "word" && context.connected;
  const sources = [
    {
      value: "selection",
      label: "Word 裸 LaTeX 选区",
      reason: rawWord ? "" : "需要已连接的 Word 文档",
    },
    {
      value: "managed",
      label: "已读取的本应用公式",
      reason:
        nativeWord && context.managed
          ? ""
          : "请先读取本应用公式；此路径需要原生 Word 加载项",
    },
    {
      value: "editor",
      label: "编辑器 LaTeX（导出副本）",
      reason: context.editor ? "" : "请先在编辑器输入公式",
    },
  ];
  const formats = Object.entries(FORMAT_NAMES).map(([value, label]) => {
    let reason = "";
    if (value === "mathtype")
      reason = "尚未实现 MTEF 读写，不能冒充 MathType 对象";
    else if (
      source === "selection" &&
      value !== "omml" &&
      !["latex", "svg", "png"].includes(value)
    )
      reason = "裸选区只支持行内 OMML 原位转换；LaTeX/SVG/PNG 可直接导出副本";
    else if (value === "ole" && source === "editor")
      reason = "新 OLE 公式请使用 Office 的 OLE 插入路线；本弹窗不覆盖光标选区";
    else if (value === "ole" && (!nativeWord || !context.ole))
      reason = "需要原生 Word 加载项和已安装的 OLE 组件";
    else if (value !== "latex" && !context.engine)
      reason = "需要可用的桌面转换/渲染引擎";
    return { value, label, reason };
  });
  return { sources, formats };
}

export async function prepareSelectionFormatExport(
  controller,
  format,
  convert,
) {
  if (!["latex", "svg", "png"].includes(format))
    throw new Error("SELECTION_EXPORT_FORMAT_UNSUPPORTED");
  try {
    const prepared = await controller.prepare();
    const content =
      format === "latex"
        ? prepared.latex
        : format === "svg"
          ? prepared.svg
          : (await convert("latex", "png", prepared.latex, "inline")).content;
    return {
      kind: "export",
      latex: prepared.latex,
      artifact: {
        content,
        filename: `formula.${format === "latex" ? "tex" : format}`,
        mime:
          format === "svg"
            ? "image/svg+xml"
            : format === "png"
              ? "image/png"
              : "text/plain;charset=utf-8",
        base64: format === "png",
      },
    };
  } finally {
    // A copy export must never retain a tracked range capable of later writes.
    await controller.cancel();
  }
}

export function conversionDocuments(context) {
  const documents =
    context.documents ??
    (context.connected
      ? [
          {
            sessionId: context.sessionId,
            host: context.host,
            documentContext: context.documentContext,
            documentTitle: context.documentTitle,
            managed: context.managed,
            ole: context.ole,
          },
        ]
      : []);
  const seen = new Set();
  return documents.map((document) => {
    const value = JSON.stringify([
      document.host,
      document.sessionId,
      document.documentContext,
    ]);
    if (seen.has(value)) throw new Error("目标文档会话重复，请刷新文档列表");
    seen.add(value);
    return { ...structuredClone(document), value };
  });
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}
function fingerprint(payload) {
  return JSON.stringify(stable(payload));
}
function requireFormula(result, id) {
  const payload = result?.formula;
  if (
    !result?.success ||
    payload?.formulaId !== id ||
    !payload.latex?.trim() ||
    !Number.isSafeInteger(payload.revision) ||
    payload.revision < 0
  )
    throw new Error(
      "公式缺少可校验的源数据或修订号，请重新读取；第三方对象不能按本应用公式转换",
    );
  if (payload.contentKind && payload.contentKind !== "formula")
    throw new Error(
      "绘图或自定义符号对象请在对应编辑器处理，不作为普通公式改写",
    );
  return payload;
}

export async function prepareManagedFormatConversion(
  target,
  formulaId,
  format,
  api,
) {
  if (
    target.host !== "word" ||
    !target.sessionId ||
    !target.documentContext ||
    !formulaId
  )
    throw new Error("缺少明确的 Word 文档与公式标识");
  if (!["omml", "ole", "latex", "svg", "png"].includes(format))
    throw new Error("不支持此目标格式");
  const boundTarget = structuredClone(target);
  const snapshot = structuredClone(
    requireFormula(await api.read(boundTarget, formulaId), formulaId),
  );
  if (
    ["omml", "ole"].includes(format) &&
    ["numbered", "displayNumbered"].includes(snapshot.display)
  )
    throw new Error(
      "编号公式的书签与交叉引用迁移尚未验收，暂不原位转换；可导出副本，原件未修改",
    );
  const plan = {
    kind: "managed",
    target: boundTarget,
    format,
    latex: snapshot.latex,
    snapshot,
    fingerprint: fingerprint(snapshot),
  };
  if (["latex", "svg", "png"].includes(format))
    return {
      ...plan,
      artifact: await prepareFormatArtifact(
        snapshot.latex,
        format,
        snapshot.display,
        api,
        snapshot.render,
      ),
    };
  const payload = structuredClone(snapshot);
  payload.storageMode = format === "omml" ? "native-omml" : "ole";
  if (format === "omml") payload.omml = await api.omml(snapshot.latex);
  else {
    if (!(await api.oleAvailable()))
      throw new Error("OLE 组件不可用，未修改原对象");
    if (!payload.render?.png)
      payload.render = await api.render(
        snapshot.latex,
        snapshot.display,
        snapshot.presentation,
      );
    if (
      !payload.render?.png ||
      !(payload.render.widthPt > 0) ||
      !(payload.render.heightPt > 0)
    )
      throw new Error("OLE 缺少有效的图片预览与尺寸，未修改原对象");
  }
  const prepared = { ...plan, payload };
  preparedCommits.set(
    prepared,
    fingerprint({ target: prepared.target, payload, format }),
  );
  return prepared;
}

export async function executeManagedFormatConversion(plan, confirmed, api) {
  if (confirmed !== true) return { cancelled: true };
  if (
    plan.kind !== "managed" ||
    plan.artifact ||
    !["omml", "ole"].includes(plan.format)
  )
    throw new Error("不是可执行的原位转换计划");
  if (consumed.has(plan))
    throw new Error("该计划已执行过，请读取文档状态后重新预览；不能自动重试");
  consumed.add(plan);
  if (
    preparedCommits.get(plan) !==
    fingerprint({
      target: plan.target,
      payload: plan.payload,
      format: plan.format,
    })
  )
    throw new Error("预览计划或目标文档已被改动，未替换；请重新生成预览");
  const actual = requireFormula(
    await api.read(plan.target, plan.snapshot.formulaId),
    plan.snapshot.formulaId,
  );
  if (fingerprint(actual) !== plan.fingerprint)
    throw new Error(
      "预览后公式源数据、样式或修订号已变化，未替换；请重新读取并预览",
    );
  const result = await api.replace(plan.target, plan.payload);
  if (!result?.success)
    throw new Error(result?.error || "宿主拒绝格式转换，原对象未通过替换确认");
  if (
    result.formulaId !== plan.snapshot.formulaId ||
    result.actualStorageMode !== plan.payload.storageMode
  )
    throw new Error("宿主结果与目标格式不符；请检查文档，不要重复提交");
  const readBack = requireFormula(
    await api.read(plan.target, plan.snapshot.formulaId),
    plan.snapshot.formulaId,
  );
  if (
    readBack.latex !== plan.snapshot.latex ||
    readBack.storageMode !== plan.payload.storageMode ||
    readBack.revision <= plan.snapshot.revision
  )
    throw new Error(
      "宿主已确认提交，但源数据回读未通过；请检查文档，不要重复提交",
    );
  return { ...result, verified: true, formula: readBack };
}

export async function prepareFormatArtifact(
  latex,
  format,
  display,
  api,
  storedRender,
) {
  if (!latex?.trim()) throw new Error("公式源码为空");
  if (format === "latex")
    return {
      content: latex,
      mime: "text/plain;charset=utf-8",
      filename: "formula.tex",
    };
  if (format === "omml")
    return {
      content: await api.omml(latex),
      mime: "application/xml;charset=utf-8",
      filename: "formula.omml",
    };
  if (!["svg", "png"].includes(format)) throw new Error("此目标不支持导出");
  const rendered = storedRender?.[format]
    ? storedRender
    : await api.render(latex, display);
  if (!rendered?.[format]) throw new Error("渲染没有返回目标图像");
  return {
    content: rendered[format],
    mime: `image/${format === "svg" ? "svg+xml" : "png"}`,
    filename: `formula.${format}`,
    base64: format === "png",
  };
}

export function downloadFormatArtifact(artifact, root = document) {
  const content = artifact.base64
    ? Uint8Array.from(
        atob(artifact.content.replace(/^data:image\/png;base64,/, "")),
        (char) => char.charCodeAt(0),
      )
    : artifact.content;
  const url = URL.createObjectURL(new Blob([content], { type: artifact.mime }));
  const link = root.createElement("a");
  link.href = url;
  link.download = artifact.filename;
  root.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Shared by desktop and Office.js. No document mutation takes place in this dialog.
export function openFormatConversionDialog({
  context,
  prepare,
  renderPreview,
  dispose = async () => {},
  root = document,
}) {
  const dialog = root.createElement("dialog");
  dialog.className = "office-format-dialog";
  const title = root.createElement("h2");
  title.id = "officeFormatTitle";
  title.textContent = "公式格式转换";
  dialog.setAttribute("aria-labelledby", title.id);
  const note = root.createElement("p");
  note.textContent =
    "选择来源和目标，再预览确认。VSTO 是加载项技术，不是公式格式。MathType 及无本应用源信息的对象暂不支持原位转换。";
  const destination = root.createElement("p");
  const documents = conversionDocuments(context);
  let selectedDocument =
    documents.find(
      (candidate) =>
        candidate.sessionId === context.sessionId &&
        candidate.documentContext === context.documentContext,
    ) || documents[0];
  const documentGroup = root.createElement("fieldset");
  documentGroup.className = "conversion-documents";
  const sourceGroup = root.createElement("fieldset");
  const targetGroup = root.createElement("fieldset");
  let source =
    context.managed && context.native
      ? "managed"
      : context.editor
        ? "editor"
        : "selection";
  let format = "omml";
  let pending = false;
  let closed = false;
  let prepared = null;
  let ready = false;
  const summary = root.createElement("p");
  summary.className = "conversion-operation";
  const code = root.createElement("pre");
  code.hidden = true;
  const preview = root.createElement("div");
  preview.className = "office-selection-preview";
  preview.hidden = true;
  const status = root.createElement("p");
  status.setAttribute("role", "status");
  const actions = root.createElement("div");
  actions.className = "conversion-actions";
  const prepareButton = root.createElement("button");
  prepareButton.type = "button";
  prepareButton.textContent = "生成预览";
  const confirm = root.createElement("button");
  confirm.type = "button";
  confirm.disabled = true;
  const cancel = root.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  actions.append(prepareButton, confirm, cancel);
  dialog.append(
    title,
    note,
    documentGroup,
    destination,
    sourceGroup,
    targetGroup,
    summary,
    code,
    preview,
    status,
    actions,
  );
  root.body.append(dialog);
  let resolveAnswer;
  const answer = new Promise((resolve) => {
    resolveAnswer = resolve;
  });
  const cleanup = async (value) => {
    try {
      if (value) await dispose(value);
    } catch (error) {
      console.warn("Selection preview cleanup failed", error);
    }
  };
  function group(element, legendText, choices, value, choose) {
    element.replaceChildren();
    const legend = root.createElement("legend");
    legend.textContent = legendText;
    element.append(legend);
    const rows = root.createElement("div");
    rows.className = "conversion-choices";
    rows.setAttribute("role", "radiogroup");
    rows.setAttribute("aria-label", legendText);
    choices.forEach((choice) => {
      const button = root.createElement("button");
      button.type = "button";
      button.dataset.value = choice.value;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(value === choice.value));
      button.disabled = pending || Boolean(choice.reason);
      button.tabIndex = value === choice.value ? 0 : -1;
      const label = root.createElement("strong");
      label.textContent = choice.label;
      button.append(label);
      if (choice.reason || choice.detail) {
        const detail = root.createElement("span");
        detail.textContent = choice.reason || choice.detail;
        button.append(detail);
      }
      button.addEventListener("click", () => {
        if (!pending) choose(choice.value);
      });
      rows.append(button);
    });
    rows.addEventListener("keydown", (event) => {
      if (
        pending ||
        ![
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ].includes(event.key)
      )
        return;
      const enabled = [...rows.querySelectorAll("button:not(:disabled)")];
      if (!enabled.length) return;
      event.preventDefault();
      const current = enabled.indexOf(event.target);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? enabled.length - 1
            : (current +
                (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
                enabled.length) %
              enabled.length;
      const selected = enabled[next].dataset.value;
      choose(selected);
      [...element.querySelectorAll("button[data-value]")]
        .find((button) => button.dataset.value === selected)
        ?.focus();
    });
    if (!rows.querySelector('button[tabindex="0"]:not(:disabled)'))
      rows
        .querySelector("button:not(:disabled)")
        ?.setAttribute("tabindex", "0");
    element.append(rows);
  }
  function reset() {
    const old = prepared;
    prepared = null;
    ready = false;
    code.hidden = preview.hidden = true;
    status.textContent = "";
    void cleanup(old);
    update();
  }
  function update() {
    const boundContext = {
      ...context,
      ...(selectedDocument || {
        host: undefined,
        documentContext: undefined,
        managed: false,
        ole: false,
      }),
      connected: Boolean(selectedDocument),
    };
    const choices = conversionChoices(boundContext, source);
    if (
      !choices.sources.some(
        (option) => option.value === source && !option.reason,
      )
    )
      source =
        choices.sources.find((option) => !option.reason)?.value || "editor";
    const formats = conversionChoices(boundContext, source).formats;
    if (!formats.some((option) => option.value === format && !option.reason))
      format = formats.find((option) => !option.reason)?.value || "omml";
    documentGroup.hidden = !documents.length;
    group(
      documentGroup,
      context.native ? "目标文档" : "当前任务窗格文档",
      documents.map((document) => ({
        value: document.value,
        label: `${document.host || "Office"} · ${document.documentTitle || document.documentContext || "当前文档"}`,
        detail: document.sessionId
          ? `会话：${document.sessionId}`
          : "Office.js 只能操作此任务窗格所属文档；其他文档请打开各自的加载项。",
      })),
      selectedDocument?.value,
      (value) => {
        selectedDocument = documents.find(
          (document) => document.value === value,
        );
        reset();
      },
    );
    destination.textContent = selectedDocument
      ? `目标文档：${selectedDocument.documentTitle || selectedDocument.documentContext || "当前 Office.js 文档"}。切换文档后须重新预览；提交时再次核对文档标识。`
      : "未连接 Office 文档，仅可导出可用的编辑器副本。";
    group(sourceGroup, "来源", choices.sources, source, (value) => {
      source = value;
      reset();
    });
    group(targetGroup, "目标格式", formats, format, (value) => {
      format = value;
      reset();
    });
    const exporting =
      source === "editor" || ["latex", "svg", "png"].includes(format);
    summary.textContent = exporting
      ? "操作：导出副本，不修改 Office 文档。"
      : source === "selection"
        ? "范围：预览时的一条裸 LaTeX 选区，替换为行内 OMML。"
        : "范围：已读取的公式 ID；保持原显示方式和样式。先校验目标对象，再删除原件。请先保存文档副本。";
    confirm.textContent = exporting ? "确认导出副本" : "确认原位转换";
    prepareButton.disabled =
      pending ||
      !choices.sources.some(
        (option) => option.value === source && !option.reason,
      ) ||
      !formats.some((option) => option.value === format && !option.reason);
    confirm.disabled = pending || !ready;
  }
  prepareButton.addEventListener("click", async () => {
    if (pending || prepareButton.disabled) return;
    const old = prepared;
    prepared = null;
    ready = false;
    pending = true;
    update();
    status.textContent = "正在准备和预览，尚未修改文档…";
    let value;
    try {
      await cleanup(old);
      value = await prepare({
        source,
        format,
        document: selectedDocument
          ? structuredClone(selectedDocument)
          : undefined,
      });
      if (closed) {
        await cleanup(value);
        return;
      }
      const node = await renderPreview(value);
      if (closed) {
        await cleanup(value);
        return;
      }
      prepared = value;
      code.textContent = value.latex;
      code.hidden = false;
      preview.replaceChildren(node);
      preview.hidden = false;
      ready = true;
      status.textContent =
        format === "omml"
          ? "源码语义预览已生成；实际 OMML 排版以 Word 为准。取消不会提交；确认后仍会核对文档与公式版本。"
          : "预览已生成。取消不会提交；确认后仍会核对文档与公式版本。";
    } catch (error) {
      await cleanup(value);
      if (!closed) {
        code.hidden = preview.hidden = true;
        status.textContent = `预览失败：${error?.message || error}`;
      }
    } finally {
      pending = false;
      if (!closed) update();
    }
  });
  confirm.addEventListener("click", () => {
    if (!pending && ready) dialog.close("confirmed");
  });
  cancel.addEventListener("click", () => dialog.close("cancelled"));
  dialog.addEventListener(
    "close",
    () => {
      closed = true;
      const result =
        dialog.returnValue === "confirmed" && ready
          ? { source, format, prepared }
          : null;
      if (!result) void cleanup(prepared);
      dialog.remove();
      resolveAnswer(result);
    },
    { once: true },
  );
  update();
  dialog.showModal();
  cancel.focus();
  return answer;
}

export { prepareSelectionConversion, executeSelectionConversion };
