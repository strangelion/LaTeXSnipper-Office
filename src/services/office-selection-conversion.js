// Explicit single-selection conversion. Preparation never mutates Word.
export async function prepareSelectionConversion(target, api) {
  if (target?.host !== "word" || !target.sessionId || !target.documentContext) {
    throw new Error("请先选择已连接且有文档标识的 Word 宿主");
  }
  api ??= await import("../features/recognition/api.js");
  const snapshot = { ...target };
  const candidates = await api.batchScanLatex(snapshot, "selection-latex");
  if (candidates?.length !== 1) {
    throw new Error("请在 Word 中选中一条完整的 LaTeX 公式，之后重新预览");
  }
  const plan = await api.batchConvertPlan(snapshot, candidates);
  const item = plan.items?.[0];
  if (plan.items?.length !== 1 || item?.status !== "converted" || !item.omml) {
    throw new Error(item?.error || "此选区无法转换为 Word 公式，原文未修改");
  }
  if (
    !item.locator ||
    !item.sourceHash ||
    item.sourceText !== candidates[0].source
  ) {
    throw new Error("转换计划缺少可校验的选区，原文未修改");
  }
  if (
    plan.target?.host !== snapshot.host ||
    plan.target?.sessionId !== snapshot.sessionId ||
    plan.target?.documentContext !== snapshot.documentContext
  ) {
    throw new Error("转换计划的目标文档不一致，原文未修改");
  }
  return plan;
}

export async function executeSelectionConversion(plan, confirmed, api) {
  if (confirmed !== true) return { cancelled: true };
  api ??= await import("../features/recognition/api.js");
  // Host verifies document identity, story locator, original text and hash
  // again at commit time. Never retarget to a newly active selection.
  return api.batchExecute(plan);
}

export function confirmSelectionConversion(
  plan,
  renderPreview,
  root = document,
) {
  const dialog = root.createElement("dialog");
  dialog.className = "office-selection-dialog";
  dialog.setAttribute("aria-labelledby", "officeSelectionTitle");
  const title = root.createElement("h2");
  title.id = "officeSelectionTitle";
  title.textContent = "将选区作为 LaTeX";
  const note = root.createElement("p");
  note.textContent =
    "仅替换预览时选中的这条公式（行内 OMML）。确认前不修改文档；原文变化会拒绝替换。";
  const source = root.createElement("pre");
  source.textContent = plan.items[0].sourceText;
  const preview = root.createElement("div");
  preview.className = "office-selection-preview";
  preview.textContent = "正在生成预览…";
  const status = root.createElement("p");
  status.setAttribute("role", "status");
  const actions = root.createElement("div");
  actions.className = "workspace-actions";
  const cancel = root.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消，保留原文";
  const confirm = root.createElement("button");
  confirm.type = "button";
  confirm.textContent = "确认替换这一条";
  confirm.disabled = true;
  actions.append(cancel, confirm);
  dialog.append(title, note, source, preview, status, actions);
  root.body.append(dialog);
  const answer = new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const confirmed = dialog.returnValue === "confirmed";
        dialog.remove();
        resolve(confirmed);
      },
      { once: true },
    );
    cancel.addEventListener("click", () => dialog.close("cancelled"));
    confirm.addEventListener("click", () => dialog.close("confirmed"));
  });
  dialog.showModal();
  cancel.focus();
  Promise.resolve()
    .then(() => renderPreview(plan.items[0].normalizedLatex))
    .then((node) => {
      if (!dialog.isConnected) return;
      preview.replaceChildren(node);
      confirm.disabled = false;
      status.textContent =
        "公式预览已生成。Word 插入时还会验证实际 OMML；失败保留原文。";
    })
    .catch((error) => {
      if (!dialog.isConnected) return;
      preview.textContent = "预览失败，不能确认替换";
      status.textContent = String(error?.message || error);
    });
  return answer;
}
