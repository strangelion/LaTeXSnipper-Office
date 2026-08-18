import { open, save } from "@tauri-apps/plugin-dialog";

import * as api from "./api.js";
import { collectProviderValidations } from "./provider-validation.js";

const AUTO_INSERT_SETTING = "recognition.screenshotAutoInsert";
const REFRESH_DEBOUNCE_MS = 250;
let context = null;
let initialized = false;
let refreshTimer = null;

function operationId(prefix) {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function log(level, event, details = {}) {
  const logger = context?.logger;
  const payload = {
    operationId: details.operationId,
    stage: details.stage ?? event,
    host: "desktop",
    sessionId: null,
    documentContext: null,
    elapsedMs: details.elapsedMs,
    success: details.success,
    errorCode: details.errorCode,
    errorMessage: sanitizeLogMessage(details.errorMessage),
  };
  const method = logger?.[level] ?? logger?.info;
  method?.call(logger, `[RecognitionSettings] ${event}`, payload);
}

function sanitizeLogMessage(message) {
  if (!message) return message;
  return String(message)
    .replace(/[A-Za-z]:\\[^\s;]+/g, "<path>")
    .replace(/\/(?:Users|home)\/[^\s;]+/g, "<path>");
}

function errorDetails(error, fallbackCode) {
  const message = error?.message || String(error);
  const explicitCode =
    error?.code || message.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0];
  return { code: explicitCode || fallbackCode, message };
}

function withTimeout(promise, timeoutMs, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${code}: 操作超时，请重试`);
        error.code = code;
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.idleText = button.textContent;
    button.textContent = busyText;
  } else if (button.dataset.idleText) {
    button.textContent = button.dataset.idleText;
    delete button.dataset.idleText;
  }
  button.disabled = busy;
}

function toast(message) {
  context?.showToast?.(message);
}

export function initRecognitionSettings(nextContext) {
  context = nextContext;
  if (initialized) return;
  initialized = true;

  const autoInsert = document.getElementById("screenshotAutoInsertToggle");
  if (autoInsert) {
    autoInsert.checked =
      (context?.settingsManager?.getScoped?.(AUTO_INSERT_SETTING) ??
        context?.settingsManager?.get(AUTO_INSERT_SETTING)) === true;
    autoInsert.addEventListener("change", () => {
      if (context?.settingsManager?.setScoped) {
        context.settingsManager.setScoped(
          "global",
          AUTO_INSERT_SETTING,
          autoInsert.checked,
        );
      } else {
        context?.settingsManager?.set(AUTO_INSERT_SETTING, autoInsert.checked);
      }
      log("info", "auto-insert-setting", {
        operationId: operationId("ocr-auto-insert"),
        success: true,
      });
    });
  }

  document
    .getElementById("probeRuntimeBtn")
    ?.addEventListener("click", probeRuntimes);
  document
    .getElementById("openRuntimeDirectoryBtn")
    ?.addEventListener("click", openRuntimeDirectory);
  document
    .getElementById("importModelPackageBtn")
    ?.addEventListener("click", importModelPackage);
  document
    .getElementById("createModelPackageBtn")
    ?.addEventListener("click", createModelPackage);
  document
    .getElementById("refreshModelListBtn")
    ?.addEventListener("click", async () => {
      await api.refreshModels();
      await refreshRecognitionSettings({ areas: ["models", "readiness"] });
    });
  document
    .getElementById("installedModelList")
    ?.addEventListener("click", removeModel);
}

export function scheduleRecognitionSettingsRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshRecognitionSettings().catch(() => {});
  }, REFRESH_DEBOUNCE_MS);
}

export async function refreshRecognitionSettings(options = {}) {
  const id = options.operationId ?? operationId("recognition-refresh");
  const started = performance.now();
  const requested = new Set(
    options.areas ?? ["capabilities", "runtimes", "models", "readiness"],
  );
  const tasks = [];
  const areas = [];

  if (requested.has("capabilities")) {
    areas.push("capabilities");
    tasks.push(withTimeout(api.getCapabilities(), 5000, "CAPABILITY_TIMEOUT"));
  }
  if (requested.has("runtimes")) {
    areas.push("runtimes");
    tasks.push(withTimeout(api.listRuntimes(), 5000, "RUNTIME_LIST_TIMEOUT"));
  }
  if (requested.has("models")) {
    areas.push("models");
    tasks.push(withTimeout(api.listModels(), 5000, "MODEL_LIST_TIMEOUT"));
  }
  if (requested.has("readiness")) {
    const readiness = document.getElementById("recognitionReadinessStatus");
    if (readiness) readiness.textContent = "正在重新获取 Core 就绪状态...";
    areas.push("readiness");
    tasks.push(withTimeout(api.getReadiness(), 5000, "READINESS_TIMEOUT"));
  }

  log("info", "refresh-start", { operationId: id, stage: "start" });
  const results = await Promise.allSettled(tasks);
  results.forEach((result, index) => {
    const area = areas[index];
    if (result.status === "fulfilled") {
      renderArea(area, result.value);
      return;
    }
    renderAreaError(area, result.reason);
    const details = errorDetails(result.reason, `${area.toUpperCase()}_FAILED`);
    log("warn", "refresh-area-failed", {
      operationId: id,
      stage: area,
      success: false,
      errorCode: details.code,
      errorMessage: details.message,
    });
  });

  const failed = results.filter(
    (result) => result.status === "rejected",
  ).length;
  log(failed ? "warn" : "info", "refresh-complete", {
    operationId: id,
    stage: "complete",
    elapsedMs: Math.round(performance.now() - started),
    success: failed === 0,
    errorCode: failed ? "PARTIAL_REFRESH_FAILED" : undefined,
  });
  return results;
}

function renderArea(area, value) {
  if (area === "capabilities") {
    const element = document.getElementById("recognitionCapabilityStatus");
    if (element) {
      element.textContent = value.available
        ? "识别组件已包含"
        : "当前构建未包含识别组件（需安装 desktop-full 版本）";
    }
  } else if (area === "runtimes") {
    renderRuntimes(value);
  } else if (area === "models") {
    renderModels(document.getElementById("installedModelList"), value);
  } else if (area === "readiness") {
    renderReadiness(value);
  }
}

function renderAreaError(area, error) {
  const details = errorDetails(error, `${area.toUpperCase()}_FAILED`);
  const text = `${details.code}：${details.message}`;
  if (area === "capabilities") {
    const element = document.getElementById("recognitionCapabilityStatus");
    if (element) element.textContent = text;
  } else if (area === "readiness") {
    const element = document.getElementById("recognitionReadinessStatus");
    if (element) element.textContent = text;
  } else if (area === "runtimes") {
    const element = document.getElementById("recognitionRuntimeStatus");
    if (element) element.textContent = text;
  } else if (area === "models") {
    const element = document.getElementById("installedModelList");
    if (element) element.textContent = text;
  }
}

function renderReadiness(readiness) {
  const element = document.getElementById("recognitionReadinessStatus");
  if (!element) return;

  const formula = readiness.modes?.find(
    (mode) => mode.mode === "cropped-formula",
  );
  const status = !formula
    ? "Core 未返回 cropped-formula 能力"
    : formula.productionRecommended
      ? "技术、模型质量与生产基线均通过"
      : formula.technicalReady
        ? "技术就绪；结果仍需人工确认"
        : "技术未就绪";
  const tasks = (formula?.tasks || [])
    .map((task) => {
      const model = task.selectedModel || "未选择模型";
      return `${task.task}: ${task.technicalReady ? "技术就绪" : task.code || "未就绪"} / ${task.qualityReady ? "质量通过" : "质量未验证"} / ${model}`;
    })
    .join("\n");
  const providers = (readiness.runtimes || [])
    .flatMap((runtime) =>
      (runtime.providerValidations || []).map(
        (provider) =>
          `${runtime.id}/${provider.provider}: ${formatProviderValidationLevel(provider.validationLevel)}` +
          `${provider.stale ? "（stale）" : ""}`,
      ),
    )
    .join("\n");
  element.textContent = [
    `Core ${readiness.coreVersion || "unknown"}（schema ${readiness.schemaVersion || "?"}）：${status}`,
    tasks,
    providers,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatProviderValidationLevel(level) {
  const labels = {
    declared: "已声明",
    libraryDetected: "已检测运行库",
    probePassed: "探测通过",
    sessionCreated: "会话已创建",
    smokeInferencePassed: "冒烟推理通过",
    benchmarkMeasured: "基准已测量",
    benchmarkValidated: "基准已验证",
  };
  return labels[level] || `Unknown(${level || "missing"})`;
}

function renderRuntimes(runtimes, recommended = null, validations = []) {
  const element = document.getElementById("recognitionRuntimeStatus");
  if (!element) return;
  const available = runtimes.filter(
    (runtime) => runtime.libraryDetected || runtime.directoryDetected,
  );
  const summary =
    available.length > 0
      ? `安装线索：${available.map((runtime) => runtime.name || runtime.kind).join("、")}（不代表可运行）`
      : "未检测到运行时安装线索";
  const recommendation = recommended
    ? `；Core 推荐：${recommended}`
    : "；可运行状态以 Core 就绪状态为准";
  const diagnostics = runtimes
    .map((runtime) => {
      const name = runtime.name || runtime.kind;
      const evidence = [
        runtime.libraryDetected ? "libraryDetected" : null,
        runtime.directoryDetected ? "directoryDetected" : null,
      ]
        .filter(Boolean)
        .join(" + ");
      const detail = runtime.installationHint
        ? `（${runtime.installationHint}）`
        : "";
      return `${name}: ${evidence || "未检测"}${detail}`;
    })
    .join("\n");
  const validationDetails = validations
    .map(
      (report) =>
        `Core/${report.provider}: ${formatProviderValidationLevel(report.validationLevel)}` +
        `${report.stale ? "（stale）" : ""}` +
        `${report.diagnostics?.length ? `（${report.diagnostics.join("；")}）` : ""}`,
    )
    .join("\n");
  element.textContent =
    `${summary}${recommendation}${diagnostics ? `\n${diagnostics}` : ""}` +
    `${validationDetails ? `\n${validationDetails}` : ""}`;
}

async function probeRuntimes() {
  const button = document.getElementById("probeRuntimeBtn");
  const id = operationId("runtime-probe");
  const started = performance.now();
  setBusy(button, true, "探测中...");
  try {
    const [result, readiness] = await Promise.all([
      withTimeout(api.probeRuntimes(), 10000, "RUNTIME_PROBE_TIMEOUT"),
      withTimeout(api.getReadiness(), 10000, "READINESS_TIMEOUT"),
    ]);
    const providers = [
      ...new Set(
        (readiness.runtimes || [])
          .filter((runtime) => runtime.available)
          .flatMap((runtime) => runtime.providers || []),
      ),
    ];
    const policy =
      document.getElementById("providerValidationPolicy")?.value ||
      "smokeInference";
    const providerResults = await collectProviderValidations(
      providers,
      (provider) =>
        withTimeout(
          api.validateProvider(provider, policy),
          policy === "benchmark" ? 120000 : 60000,
          "PROVIDER_VALIDATION_TIMEOUT",
        ),
      policy,
    );
    const validations = providerResults.map((result) => result.report);
    renderRuntimes(result.runtimes, result.recommended, validations);
    await refreshRecognitionSettings({ areas: ["readiness"] });
    toast(
      providers.length
        ? `Core provider 验证完成（${policy}）：${providerResults
            .map((result) => `${result.provider} ${result.status}`)
            .join("，")}`
        : "未发现可由 Core 验证的 provider",
    );
    log("info", "runtime-probe", {
      operationId: id,
      elapsedMs: Math.round(performance.now() - started),
      success: true,
    });
  } catch (error) {
    const details = errorDetails(error, "RUNTIME_PROBE_FAILED");
    renderAreaError("runtimes", error);
    toast(`${details.code}：运行时探测失败`);
    log("error", "runtime-probe", {
      operationId: id,
      elapsedMs: Math.round(performance.now() - started),
      success: false,
      errorCode: details.code,
      errorMessage: details.message,
    });
  } finally {
    setBusy(button, false);
  }
}

async function openRuntimeDirectory() {
  const button = document.getElementById("openRuntimeDirectoryBtn");
  const id = operationId("runtime-open-directory");
  setBusy(button, true, "打开中...");
  try {
    await api.openRuntimeDirectory();
    toast("已打开运行时目录");
    log("info", "runtime-open-directory", {
      operationId: id,
      success: true,
    });
  } catch (error) {
    const details = errorDetails(error, "RUNTIME_OPEN_DIRECTORY_FAILED");
    toast(`${details.code}：${details.message}`);
    log("error", "runtime-open-directory", {
      operationId: id,
      success: false,
      errorCode: details.code,
      errorMessage: details.message,
    });
  } finally {
    setBusy(button, false);
  }
}

async function importModelPackage() {
  const button = document.getElementById("importModelPackageBtn");
  const id = operationId("model-import");
  setBusy(button, true, "检查中...");
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: "LaTeXSnipper Model", extensions: ["lsmodel"] }],
    });
    if (!selected) return;

    const inspected = await api.inspectModelPackage(selected);
    const summary = [
      `ID: ${inspected.id || "未知"}`,
      `任务: ${inspected.task || "未知"}`,
      `版本: ${inspected.version || "未知"}`,
      `适配器: ${inspected.adapter || "未知"}`,
      `运行时变体: ${inspected.runtimeVariants?.join("、") || "无"}`,
      ...(inspected.warnings || []).map((warning) => `警告: ${warning}`),
    ].join("\n");
    if (!inspected.compatible) {
      throw Object.assign(new Error(summary), {
        code: "MODEL_PACKAGE_INCOMPATIBLE",
      });
    }
    if (!globalThis.confirm(`确认导入此模型？\n\n${summary}`)) return;

    setBusy(button, true, "导入中...");
    await api.importModelPackage(selected);
    await refreshRecognitionSettings({ areas: ["models", "readiness"] });
    toast("模型已导入，识别就绪状态已更新");
    log("info", "model-import", { operationId: id, success: true });
  } catch (error) {
    const details = errorDetails(error, "MODEL_IMPORT_FAILED");
    toast(`${details.code}：${details.message}`);
    log("error", "model-import", {
      operationId: id,
      success: false,
      errorCode: details.code,
      errorMessage: details.message,
    });
  } finally {
    setBusy(button, false);
  }
}

async function createModelPackage() {
  const button = document.getElementById("createModelPackageBtn");
  const id = operationId("model-package-create");
  setBusy(button, true, "选择目录...");
  try {
    const sourceDirectory = await open({
      directory: true,
      multiple: false,
      title: "选择包含根目录 manifest.toml 的模型目录",
    });
    if (!sourceDirectory) return;
    const directoryName = String(sourceDirectory)
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop();
    const outputPath = await save({
      title: "生成 LaTeXSnipper 模型包",
      defaultPath: `${directoryName || "model"}.lsmodel`,
      filters: [{ name: "LaTeXSnipper Model", extensions: ["lsmodel"] }],
    });
    if (!outputPath) return;
    setBusy(button, true, "打包中...");
    await api.createModelPackage(sourceDirectory, outputPath);
    toast(".lsmodel 已生成；manifest.toml 位于压缩包根目录");
    log("info", "model-package-create", {
      operationId: id,
      success: true,
    });
  } catch (error) {
    const details = errorDetails(error, "MODEL_PACKAGE_CREATE_FAILED");
    toast(`${details.code}：${details.message}`);
    log("error", "model-package-create", {
      operationId: id,
      success: false,
      errorCode: details.code,
      errorMessage: details.message,
    });
  } finally {
    setBusy(button, false);
  }
}

async function removeModel(event) {
  const button = event.target.closest("[data-remove-model]");
  if (!button) return;
  const modelId = button.dataset.removeModel;
  if (!globalThis.confirm(`确认删除模型 ${modelId}？`)) return;
  const id = operationId("model-remove");
  setBusy(button, true, "删除中...");
  try {
    await api.removeModel(modelId);
    await refreshRecognitionSettings({ areas: ["models", "readiness"] });
    toast("模型已删除");
    log("info", "model-remove", { operationId: id, success: true });
  } catch (error) {
    const details = errorDetails(error, "MODEL_REMOVE_FAILED");
    toast(`${details.code}：${details.message}`);
    log("error", "model-remove", {
      operationId: id,
      success: false,
      errorCode: details.code,
      errorMessage: details.message,
    });
  } finally {
    setBusy(button, false);
  }
}

function renderModels(root, models) {
  if (!root) return;
  if (!models.length) {
    root.innerHTML =
      '<div class="recognition-job-empty">尚未安装识别模型；请导入经过校验的 .lsmodel 包</div>';
    return;
  }
  root.innerHTML = models
    .map(
      (model) => `
        <div class="settings-row recognition-model-row">
          <div style="flex:1;min-width:0">
            <strong>${escapeHtml(model.name || model.id)}</strong>
            <div class="settings-hint">
              ${escapeHtml(model.task)} · ${escapeHtml(model.version)} ·
              ${formatBytes(model.sizeBytes)}
            </div>
          </div>
          <button class="btn" data-remove-model="${escapeHtml(model.id)}">删除</button>
        </div>`,
    )
    .join("");
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function escapeHtml(text) {
  const node = document.createElement("div");
  node.textContent = String(text ?? "");
  return node.innerHTML;
}
