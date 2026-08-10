export function normalizeHexColor(value, fallback = "#18212F") {
  const text = String(value || "")
    .trim()
    .toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : fallback;
}

export function hexToHsv(value) {
  const hex = normalizeHexColor(value).slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

export function hsvToHex({ hue, saturation, value }) {
  const normalizedHue = ((Number(hue) % 360) + 360) % 360;
  const s = Math.max(0, Math.min(1, Number(saturation)));
  const v = Math.max(0, Math.min(1, Number(value)));
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const match = v - chroma;
  const sectors = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [red, green, blue] = sectors[Math.floor(normalizedHue / 60) % 6];
  const byte = (channel) =>
    Math.round((channel + match) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${byte(red)}${byte(green)}${byte(blue)}`;
}

export function spectrumPoint(clientX, clientY, bounds) {
  return {
    saturation: Math.max(
      0,
      Math.min(1, (clientX - bounds.left) / Math.max(1, bounds.width)),
    ),
    value: Math.max(
      0,
      Math.min(1, 1 - (clientY - bounds.top) / Math.max(1, bounds.height)),
    ),
  };
}

export function spectrumPointInside(clientX, clientY, bounds) {
  if (
    clientX < bounds.left ||
    clientX > bounds.left + bounds.width ||
    clientY < bounds.top ||
    clientY > bounds.top + bounds.height
  ) {
    return null;
  }
  return spectrumPoint(clientX, clientY, bounds);
}
