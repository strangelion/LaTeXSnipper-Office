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

  badge.classList.remove("is-ready", "is-busy", "is-error");
  if (running.length > 0) {
    badge.textContent = `处理中 ${running.length}`;
    badge.classList.add("is-busy");
  } else if (failed) {
    badge.textContent = "部分失败";
    badge.classList.add("is-error");
  } else {
    badge.textContent = "就绪";
    badge.classList.add("is-ready");
  }
}

function renderJobList(jobs, selectedJobId) {
  const root = document.getElementById("recognitionJobList");
  const count = document.getElementById("recognitionJobCount");
  if (!root) return;

  const ordered = [...jobs].sort((a, b) => b.id.localeCompare(a.id));
  if (count) count.textContent = String(ordered.length);

  if (ordered.length === 0) {
    root.innerHTML = '<div class="recognition-job-empty">暂无识别任务</div>';
    return;
  }

  root.innerHTML = ordered.map((job) => renderJob(job, selectedJobId)).join("");
}

function renderJob(job, selectedJobId) {
  const sel = job.id === selectedJobId;
  const status = String(job.status || "Unknown");
  const cancellable = ["Queued", "Running"].includes(status);
  const progress = normalizeProgress(job.progress);
  const message = esc(String(job.message || ""));

  return `<div class="recognition-job-item ${sel ? "selected" : ""}" data-job-id="${esc(job.id)}">
    <div class="recognition-job-main">
      <div class="recognition-job-title">
        <span>${esc(job.id)}</span>
        <span class="recognition-job-status status-${status.toLowerCase()}">${esc(status)}</span>
      </div>
      <div class="recognition-job-progress"><div style="width:${progress}%"></div></div>
      ${message ? `<div class="recognition-job-message">${message}</div>` : ""}
    </div>
    ${cancellable ? `<button class="btn recognition-job-cancel" data-cancel-job="${esc(job.id)}">取消</button>` : ""}
  </div>`;
}

function normalizeProgress(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)));
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
