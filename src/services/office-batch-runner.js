import { mountOfficeDialog, showOfficeDialog } from "./office-dialog.js";

// Start scanning at the Office entry point; confirmation is the only write gate.
export async function startOfficeBatch(target, options = {}) {
  if (!target?.host || !target.sessionId || !target.documentContext)
    throw new Error("批量转换缺少明确的宿主和文档，未修改文档");
  const bound = { ...target };
  const api = options.api ?? (await import("../features/recognition/api.js"));
  options.onProgress?.("正在扫描当前文档（尚未修改）…");
  const candidates = await api.batchScanLatex(bound, "entireDocument");
  if (!candidates?.length)
    return { total: 0, converted: 0, skipped: 0, failed: 0 };
  options.onProgress?.(`找到 ${candidates.length} 条候选，正在验证转换…`);
  const plan = await api.batchConvertPlan(bound, candidates);
  if (
    !plan.id ||
    plan.target?.host !== bound.host ||
    plan.target?.sessionId !== bound.sessionId ||
    plan.target?.documentContext !== bound.documentContext
  )
    throw new Error("批量计划的目标文档不一致，未修改文档");
  const snapshot = JSON.parse(JSON.stringify(plan));
  if (!(await options.confirm?.(JSON.parse(JSON.stringify(snapshot)))))
    return { cancelled: true };
  options.onProgress?.("正在分批替换；失败项保留原文，不自动重试…");
  return api.batchExecute(snapshot);
}

export function confirmOfficeBatch(plan, root = document) {
  const items = plan.items || [];
  const ready = items.filter((item) => item.status === "converted").length;
  const dialog = root.createElement("dialog");
  dialog.className = "office-format-dialog office-batch-dialog";
  dialog.setAttribute("aria-label", "确认批量转换");
  const title = root.createElement("h2");
  title.textContent = "确认批量转换";
  const note = root.createElement("p");
  note.textContent = `当前文档${plan.target?.documentContext ? ` ${plan.target.documentContext}` : ""}：${ready}/${items.length} 条可转换为 OMML。仅修改已校验的范围，失败项保留原文。确认后逐批处理，不自动重试。`;
  const sources = root.createElement("pre");
  sources.textContent = items
    .slice(0, 10)
    .map((item) => `${item.status}: ${item.sourceText}`)
    .join("\n");
  const actions = root.createElement("div");
  actions.className = "conversion-actions";
  const cancel = root.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消，保留原文";
  const confirm = root.createElement("button");
  confirm.type = "button";
  confirm.textContent = `确认转换 ${ready} 条`;
  confirm.disabled = ready === 0;
  actions.append(cancel, confirm);
  mountOfficeDialog(dialog, title, [note, sources], actions);
  const answer = new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const approved = dialog.returnValue === "confirmed";
        dialog.remove();
        resolve(approved);
      },
      { once: true },
    );
    cancel.addEventListener("click", () => dialog.close("cancelled"));
    confirm.addEventListener("click", () => dialog.close("confirmed"));
  });
  showOfficeDialog(dialog, cancel);
  return answer;
}
