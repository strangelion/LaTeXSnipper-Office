// Recognition view — real job list UI (replaces placeholder).

import * as api from "./api.js";
import * as store from "./store.js";

let bound = false;

export function hasRecognitionTab() {
  return Boolean(document.getElementById("ocrSection"));
}

export function bindRecognitionTab() {
  if (bound) return;
  bound = true;

  const list = document.getElementById("recognitionJobList");
  list?.addEventListener("click", async (event) => {
    const cancelBtn = event.target.closest("[data-cancel-job]");
    if (cancelBtn) {
      const jobId = cancelBtn.dataset.cancelJob;
      if (!jobId) return;
      cancelBtn.disabled = true;
      try {
        await api.cancelJob(jobId);
        store.markJobCancelRequested(jobId);
      } catch (error) {
        console.error("[Recognition] Cancel failed:", error);
        cancelBtn.disabled = false;
      }
      return;
    }
    const item = event.target.closest("[data-job-id]");
    if (item) store.selectJob(item.dataset.jobId);
  });

  store.subscribe(renderState);
  renderState(store.getState());
}

function renderState(state) {
  renderStatus(state);
  renderJobList(state.jobs, state.selectedJobId);
}

function renderStatus(state) {
  const badge = document.getElementById("recognitionStatusBadge");
  if (!badge) return;
  const jobs = state.jobs || [];
  const running = jobs.filter((j) =>
    ["Queued", "Running", "CancelRequested"].includes(j.status),
  );
  const failed = jobs.some((j) => j.status === "Failed");

  badge.classList.remove("is-ready", "is-busy", "is-error", "is-warning");
  if (running.length > 0) {
    badge.textContent = `处理中 ${running.length}`;
    badge.classList.add("is-busy");
    return;
  }
  if (failed) {
    badge.textContent = "部分失败";
    badge.classList.add("is-error");
    return;
  }

  // No active/failed jobs: the badge must still reflect whether the
  // backend can actually run — capabilities gate first, then engine
  // readiness (core / models / quality baseline).
  if (state.capabilities?.available === false) {
    badge.textContent = "不可用";
    badge.classList.add("is-error");
    return;
  }
  const readiness = state.readiness;
  if (!readiness) {
    badge.textContent = "检查中";
    return;
  }
  const technicalReady = (readiness.modes || []).some(
    (mode) => mode.technicalReady === true,
  );
  if (!technicalReady) {
    badge.textContent = "引擎不可用";
    badge.classList.add("is-error");
    return;
  }
  const models = readiness.models || [];
  if (models.length === 0) {
    badge.textContent = "模型缺失";
    badge.classList.add("is-error");
    return;
  }
  const quality = readiness.quality || [];
  const anyValidated = quality.some(
    (entry) => entry.status === "Validated" || entry.status === "Experimental",
  );
  if (quality.length > 0 && !anyValidated) {
    badge.textContent = "基线未验证";
    badge.classList.add("is-warning");
    return;
  }
  badge.textContent = "就绪";
  badge.classList.add("is-ready");
}

function renderJobList(jobs, selectedJobId) {
  const root = document.getElementById("recognitionJobList");
  const count = document.getElementById("recognitionJobCount");
  if (!root) return;

  const ordered = [...jobs].sort((a, b) => b.id.localeCompare(a.id));
  if (count) count.textContent = String(ordered.length);

  if (ordered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "recognition-job-empty";
    empty.textContent = "暂无识别任务";
    root.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const job of ordered) {
    fragment.append(renderJob(job, selectedJobId));
  }
  root.replaceChildren(fragment);
}

function renderJob(job, selectedJobId) {
  const sel = job.id === selectedJobId;
  const status = String(job.status || "Unknown");
  const cancellable = ["Queued", "Running"].includes(status);
  const progress = normalizeProgress(job.progress);
  const message = String(job.message || "");

  const item = document.createElement("div");
  item.className = `recognition-job-item${sel ? " selected" : ""}`;
  item.dataset.jobId = job.id;

  const main = document.createElement("div");
  main.className = "recognition-job-main";

  const title = document.createElement("div");
  title.className = "recognition-job-title";
  const idSpan = document.createElement("span");
  idSpan.textContent = job.id;
  const statusSpan = document.createElement("span");
  statusSpan.className = `recognition-job-status status-${status
    .toLowerCase()
    .replace(/[^a-z]/g, "")}`;
  statusSpan.textContent = status;
  title.append(idSpan);
  title.append(statusSpan);

  const progressWrap = document.createElement("div");
  progressWrap.className = "recognition-job-progress";
  const bar = document.createElement("div");
  bar.style.width = `${progress}%`;
  progressWrap.append(bar);

  main.append(title);
  main.append(progressWrap);
  if (message) {
    const messageEl = document.createElement("div");
    messageEl.className = "recognition-job-message";
    messageEl.textContent = message;
    main.append(messageEl);
  }
  item.append(main);

  if (cancellable) {
    const cancel = document.createElement("button");
    cancel.className = "btn recognition-job-cancel";
    cancel.dataset.cancelJob = job.id;
    cancel.textContent = "取消";
    item.append(cancel);
  }
  return item;
}

function normalizeProgress(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)));
}
