import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  normalizeRect,
  pointerToPreview as mapPointerToPreview,
  previewRectToPhysical as mapPreviewRectToPhysical,
} from "./features/screenshot/coordinates.js";

const currentWindow = getCurrentWebviewWindow();
const canvas = document.getElementById("captureCanvas");
const context = canvas.getContext("2d");

let init;
let screenshot;
let start = null;
let current = null;
let selection = null;
let dragging = false;

function pointerToPreview(event) {
  return mapPointerToPreview(
    event.clientX,
    event.clientY,
    canvas.getBoundingClientRect(),
    { width: canvas.width, height: canvas.height },
  );
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(screenshot, 0, 0, canvas.width, canvas.height);

  context.fillStyle = "rgba(0, 0, 0, 0.42)";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (!selection) return;

  context.save();

  context.beginPath();
  context.rect(selection.x, selection.y, selection.width, selection.height);
  context.clip();

  context.drawImage(screenshot, 0, 0, canvas.width, canvas.height);
  context.restore();

  context.strokeStyle = "#3b82f6";
  context.lineWidth = Math.max(2, init.scaleFactor * 1.5);
  context.strokeRect(
    selection.x,
    selection.y,
    selection.width,
    selection.height,
  );

  const physical = previewRectToPhysical(selection);
  const text = `${physical.width} × ${physical.height}`;
  context.font = `${Math.round(13 * init.scaleFactor)}px Segoe UI`;
  const metrics = context.measureText(text);

  const labelX = selection.x;
  const labelY = Math.max(0, selection.y - 28 * init.scaleFactor);

  context.fillStyle = "rgba(15, 23, 42, 0.9)";
  context.fillRect(
    labelX,
    labelY,
    metrics.width + 16 * init.scaleFactor,
    24 * init.scaleFactor,
  );

  context.fillStyle = "#fff";
  context.fillText(
    text,
    labelX + 8 * init.scaleFactor,
    labelY + 17 * init.scaleFactor,
  );
}

async function confirmSelection() {
  const physical = selection ? previewRectToPhysical(selection) : null;
  if (!physical || physical.width < 8 || physical.height < 8) {
    return;
  }

  await invoke("screenshot_commit", {
    request: {
      windowLabel: currentWindow.label,
      ...physical,
    },
  });
}

async function cancel() {
  await invoke("screenshot_cancel", {
    windowLabel: currentWindow.label,
  });
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  start = pointerToPreview(event);
  current = start;
  selection = null;
  dragging = true;
  draw();
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging || !start) return;

  current = pointerToPreview(event);
  selection = normalizeRect(start, current);
  draw();
});

canvas.addEventListener("pointerup", (event) => {
  if (!dragging) return;

  current = pointerToPreview(event);
  selection = normalizeRect(start, current);
  dragging = false;
  draw();
});

document.addEventListener("keydown", async (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    await cancel();
  }

  if (event.key === "Enter") {
    event.preventDefault();
    await confirmSelection();
  }
});

canvas.addEventListener("dblclick", confirmSelection);

async function initialize() {
  init = await initializeOverlayWithRetry();

  canvas.width = init.previewWidth;
  canvas.height = init.previewHeight;

  screenshot = new Image();
  const decodeStarted = performance.now();
  await new Promise((resolve, reject) => {
    screenshot.onload = resolve;
    screenshot.onerror = () =>
      reject(new Error("SCREENSHOT_PREVIEW_DECODE_FAILED"));
    screenshot.src = convertFileSrc(init.previewPath);
  });
  draw();
  await invoke("screenshot_overlay_ready", {
    windowLabel: currentWindow.label,
    previewDecodeMs: Math.round(performance.now() - decodeStarted),
  });
}

function previewRectToPhysical(rect) {
  return mapPreviewRectToPhysical(
    rect,
    { width: init.previewWidth, height: init.previewHeight },
    { width: init.physicalWidth, height: init.physicalHeight },
  );
}

async function initializeOverlayWithRetry() {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await invoke("screenshot_overlay_init", {
        windowLabel: currentWindow.label,
      });
    } catch (error) {
      lastError = error;
      if (!String(error).includes("SESSION_NOT_READY") || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 + attempt * 10));
    }
  }
  throw lastError;
}

initialize().catch(async (error) => {
  console.error("Capture overlay initialization failed:", error);
  await cancel().catch(() => {});
});
