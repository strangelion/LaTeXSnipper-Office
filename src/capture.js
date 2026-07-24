import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const currentWindow = getCurrentWebviewWindow();
const canvas = document.getElementById("captureCanvas");
const context = canvas.getContext("2d");

let init;
let screenshot;
let start = null;
let current = null;
let selection = null;
let dragging = false;

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);

  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function pointerToPhysical(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: Math.round(((event.clientX - rect.left) / rect.width) * canvas.width),
    y: Math.round(((event.clientY - rect.top) / rect.height) * canvas.height),
  };
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

  const text = `${selection.width} × ${selection.height}`;
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
  if (!selection || selection.width < 8 || selection.height < 8) {
    return;
  }

  await invoke("screenshot_commit", {
    request: {
      windowLabel: currentWindow.label,
      ...selection,
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
  start = pointerToPhysical(event);
  current = start;
  selection = null;
  dragging = true;
  draw();
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging || !start) return;

  current = pointerToPhysical(event);
  selection = normalizeRect(start, current);
  draw();
});

canvas.addEventListener("pointerup", (event) => {
  if (!dragging) return;

  current = pointerToPhysical(event);
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
  init = await invoke("screenshot_overlay_init", {
    windowLabel: currentWindow.label,
  });

  canvas.width = init.physicalWidth;
  canvas.height = init.physicalHeight;

  screenshot = new Image();
  screenshot.onload = draw;
  screenshot.src = init.previewDataUrl;
}

initialize().catch(async (error) => {
  console.error("Capture overlay initialization failed:", error);
  await cancel().catch(() => {});
});
