export function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function pointerToPreview(clientX, clientY, bounds, previewSize) {
  return {
    x: Math.round(((clientX - bounds.left) / bounds.width) * previewSize.width),
    y: Math.round(
      ((clientY - bounds.top) / bounds.height) * previewSize.height,
    ),
  };
}

export function previewRectToPhysical(rect, previewSize, physicalSize) {
  const scaleX = physicalSize.width / previewSize.width;
  const scaleY = physicalSize.height / previewSize.height;
  const x = Math.round(rect.x * scaleX);
  const y = Math.round(rect.y * scaleY);
  const right = Math.round((rect.x + rect.width) * scaleX);
  const bottom = Math.round((rect.y + rect.height) * scaleY);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}
