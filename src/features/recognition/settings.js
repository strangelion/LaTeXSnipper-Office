import * as api from "./api.js";

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export async function refreshRecognitionSettings() {
  const capabilityEl = document.getElementById("recognitionCapabilityStatus");
  const runtimeEl = document.getElementById("recognitionRuntimeStatus");
  const modelList = document.getElementById("installedModelList");

  try {
    const [capabilities, runtimes, models] = await Promise.all([
      api.getCapabilities(),
      api.listRuntimes(),
      api.listModels(),
    ]);

    if (capabilityEl) {
      capabilityEl.textContent = capabilities.available
        ? "识别组件已启用"
        : "当前构建未包含识别组件";
    }

    const availableRuntimes = runtimes.filter(
      (runtime) => runtime.available !== false,
    );

    if (runtimeEl) {
      runtimeEl.textContent =
        availableRuntimes.length > 0
          ? `可用：${availableRuntimes.map((r) => r.name || r.id).join("、")}`
          : "未检测到可用运行时";
    }

    renderModels(modelList, models);
  } catch (error) {
    if (capabilityEl) capabilityEl.textContent = "检测失败";
    if (runtimeEl) runtimeEl.textContent = error.message || String(error);
  }
}

function renderModels(root, models) {
  if (!root) return;

  if (!models.length) {
    root.innerHTML =
      '<div class="recognition-job-empty">尚未安装识别模型</div>';
    return;
  }

  root.innerHTML = models
    .map(
      (model) => `
        <div class="settings-row recognition-model-row">
          <div style="flex:1;min-width:0">
            <strong>${escapeHtml(model.name || model.id)}</strong>
            <div class="settings-hint">
              ${escapeHtml(model.task)} ·
              ${escapeHtml(model.version)} ·
              ${formatBytes(model.sizeBytes)}
            </div>
          </div>
          <button class="btn"
                  data-remove-model="${escapeHtml(model.id)}">
            删除
          </button>
        </div>
      `,
    )
    .join("");
}

function escapeHtml(text) {
  const node = document.createElement("div");
  node.textContent = String(text ?? "");
  return node.innerHTML;
}
