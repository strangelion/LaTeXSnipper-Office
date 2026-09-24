const ENHANCED = Symbol("latexsnipperEnhancedControl");
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const PALETTE = [
  "#2563EB",
  "#0EA5E9",
  "#06B6D4",
  "#10B981",
  "#84CC16",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#8B5CF6",
  "#0F172A",
  "#64748B",
  "#FFFFFF",
];

function closeOtherPopovers(current) {
  document
    .querySelectorAll(".native-control-shell.open, .color-control-shell.open")
    .forEach((element) => {
      if (element === current) return;
      element.classList.remove("open");
      element
        .querySelector("[aria-expanded]")
        ?.setAttribute("aria-expanded", "false");
    });
}

function placePopover(wrapper, trigger, popover) {
  wrapper.classList.remove("open-up");
  popover.style.removeProperty("--control-popover-space");
  const triggerBounds = trigger.getBoundingClientRect();
  const spaceBelow = Math.max(
    0,
    window.innerHeight - triggerBounds.bottom - 12,
  );
  const spaceAbove = Math.max(0, triggerBounds.top - 12);
  const desiredHeight = Math.min(popover.scrollHeight || 240, 420);
  const openUp =
    spaceBelow < Math.min(desiredHeight, 220) && spaceAbove > spaceBelow;
  wrapper.classList.toggle("open-up", openUp);
  const available = openUp ? spaceAbove : spaceBelow;
  popover.style.setProperty(
    "--control-popover-space",
    `${Math.max(112, available)}px`,
  );
}

function installDocumentDismissal() {
  if (document.documentElement.dataset.nativeControlDismissal === "true")
    return;
  document.documentElement.dataset.nativeControlDismissal = "true";
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".native-control-shell, .color-control-shell"))
      return;
    closeOtherPopovers(null);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeOtherPopovers(null);
  });
}

function enhanceSelect(select) {
  if (select[ENHANCED] || select.multiple || select.size > 1) return null;
  select[ENHANCED] = true;

  const wrapper = document.createElement("div");
  wrapper.className = "native-control-shell";
  wrapper.dataset.controlFor = select.id || "anonymous-select";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "native-control-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML =
    '<span class="native-control-label"></span><span class="native-control-chevron" aria-hidden="true"></span>';
  const menu = document.createElement("div");
  menu.className = "native-control-menu";
  menu.setAttribute("role", "listbox");

  select.before(wrapper);
  wrapper.append(select, trigger, menu);
  select.classList.add("native-control-input");
  select.tabIndex = -1;

  const valueDescriptor = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  );
  const getValue = () => valueDescriptor.get.call(select);
  const setNativeValue = (value) =>
    valueDescriptor.set.call(select, String(value));

  const sync = () => {
    const option =
      select.selectedOptions?.[0] || select.options[select.selectedIndex];
    trigger.querySelector(".native-control-label").textContent =
      option?.textContent?.trim() || "请选择";
    trigger.disabled = select.disabled;
    wrapper.classList.toggle("is-disabled", select.disabled);
    menu.querySelectorAll("[role=option]").forEach((button) => {
      const selected = button.dataset.value === getValue();
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });
  };

  const rebuild = () => {
    menu.replaceChildren();
    [...select.options].forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "native-control-option";
      button.dataset.value = option.value;
      button.textContent = option.textContent;
      button.disabled = option.disabled;
      button.setAttribute("role", "option");
      button.addEventListener("click", () => {
        if (button.disabled) return;
        setNativeValue(button.dataset.value);
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        wrapper.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
        sync();
      });
      menu.appendChild(button);
    });
    sync();
  };

  Object.defineProperty(select, "value", {
    configurable: true,
    enumerable: true,
    get: getValue,
    set(value) {
      setNativeValue(value);
      sync();
    },
  });

  trigger.addEventListener("click", () => {
    if (trigger.disabled) return;
    const opening = !wrapper.classList.contains("open");
    closeOtherPopovers(wrapper);
    wrapper.classList.toggle("open", opening);
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) {
      placePopover(wrapper, trigger, menu);
      (
        menu.querySelector(".selected") ||
        menu.querySelector("button:not(:disabled)")
      )?.focus();
    }
  });
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    if (!wrapper.classList.contains("open")) trigger.click();
  });
  menu.addEventListener("keydown", (event) => {
    const options = [...menu.querySelectorAll("button:not(:disabled)")];
    const current = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      options[(current + offset + options.length) % options.length]?.focus();
    } else if (event.key === "Escape") {
      wrapper.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus();
    }
  });
  select.addEventListener("change", sync);
  select.addEventListener("input", sync);
  new MutationObserver(rebuild).observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "label", "selected"],
  });
  rebuild();
  return wrapper;
}

function normalizeColor(value, fallback = "#000000") {
  const candidate = String(value || "").trim();
  return COLOR_PATTERN.test(candidate) ? candidate.toUpperCase() : fallback;
}

function rgbFromHex(value) {
  const color = normalizeColor(value);
  return [1, 3, 5].map((index) =>
    Number.parseInt(color.slice(index, index + 2), 16),
  );
}

function hexFromRgb(red, green, blue) {
  const byte = (value) =>
    Math.min(255, Math.max(0, Number(value) || 0))
      .toString(16)
      .padStart(2, "0");
  return `#${byte(red)}${byte(green)}${byte(blue)}`.toUpperCase();
}

function hslFromHex(value) {
  const [redByte, greenByte, blueByte] = rgbFromHex(value);
  const red = redByte / 255;
  const green = greenByte / 255;
  const blue = blueByte / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const lightness = (maximum + minimum) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return { hue, saturation: saturation * 100, lightness: lightness * 100 };
}

function hexFromHsl(hue, saturation, lightness) {
  const normalizedHue = ((Number(hue) % 360) + 360) % 360;
  const normalizedSaturation = Math.min(
    1,
    Math.max(0, Number(saturation) / 100),
  );
  const normalizedLightness = Math.min(1, Math.max(0, Number(lightness) / 100));
  const chroma =
    (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const segment = normalizedHue / 60;
  const intermediate = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] =
    segment < 1
      ? [chroma, intermediate, 0]
      : segment < 2
        ? [intermediate, chroma, 0]
        : segment < 3
          ? [0, chroma, intermediate]
          : segment < 4
            ? [0, intermediate, chroma]
            : segment < 5
              ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate];
  const match = normalizedLightness - chroma / 2;
  return hexFromRgb(
    Math.round((red + match) * 255),
    Math.round((green + match) * 255),
    Math.round((blue + match) * 255),
  );
}

function enhanceColorInput(input) {
  if (input[ENHANCED]) return null;
  input[ENHANCED] = true;

  const wrapper = document.createElement("div");
  wrapper.className = "color-control-shell";
  wrapper.dataset.controlFor = input.id || "anonymous-color";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "color-control-trigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML =
    '<span class="color-control-swatch" aria-hidden="true"></span><span class="color-control-value"></span><span class="native-control-chevron" aria-hidden="true"></span>';
  const panel = document.createElement("div");
  panel.className = "color-control-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "颜色选择器");
  const palette = document.createElement("div");
  palette.className = "color-control-palette";
  const visual = document.createElement("div");
  visual.className = "color-control-visual";
  visual.innerHTML = `
    <button type="button" class="color-control-wheel" aria-label="全色域色环">
      <span class="color-control-wheel-marker" aria-hidden="true"></span>
    </button>
    <div class="color-control-wheel-copy">
      <strong>更多颜色</strong>
      <span>在色环中点击或拖动</span>
      <span class="color-control-wheel-current" aria-hidden="true"></span>
    </div>`;
  const fields = document.createElement("div");
  fields.className = "color-control-fields";
  fields.innerHTML = `
    <label class="color-control-hex"><span>HEX</span><input type="text" maxlength="7" spellcheck="false" /></label>
    <label><span>R</span><input type="number" min="0" max="255" /></label>
    <label><span>G</span><input type="number" min="0" max="255" /></label>
    <label><span>B</span><input type="number" min="0" max="255" /></label>`;
  panel.append(palette, visual, fields);

  input.before(wrapper);
  wrapper.append(input, trigger, panel);
  input.classList.add("color-control-input");
  input.tabIndex = -1;

  const valueDescriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  const getValue = () => valueDescriptor.get.call(input);
  const setNativeValue = (value) => valueDescriptor.set.call(input, value);
  const [hexField, redField, greenField, blueField] =
    fields.querySelectorAll("input");
  const wheel = visual.querySelector(".color-control-wheel");
  const wheelMarker = visual.querySelector(".color-control-wheel-marker");
  const wheelCurrent = visual.querySelector(".color-control-wheel-current");

  const sync = () => {
    const color = normalizeColor(getValue());
    const [red, green, blue] = rgbFromHex(color);
    trigger.querySelector(".color-control-swatch").style.background = color;
    trigger.querySelector(".color-control-value").textContent = color;
    trigger.disabled = input.disabled;
    wrapper.classList.toggle("is-disabled", input.disabled);
    hexField.value = color;
    redField.value = String(red);
    greenField.value = String(green);
    blueField.value = String(blue);
    wheelCurrent.style.background = color;
    const { hue, saturation } = hslFromHex(color);
    const wheelRadius = wheel.clientWidth / 2 || 62;
    const markerRadius = Math.max(
      0,
      (wheelRadius - 7) * Math.min(1, saturation / 100),
    );
    const radians = ((hue - 180) * Math.PI) / 180;
    wheelMarker.style.left = `${wheelRadius + Math.cos(radians) * markerRadius}px`;
    wheelMarker.style.top = `${wheelRadius + Math.sin(radians) * markerRadius}px`;
    palette.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("selected", button.dataset.color === color);
    });
  };

  const commit = (value, final = true) => {
    const color = normalizeColor(value, normalizeColor(getValue()));
    setNativeValue(color.toLowerCase());
    sync();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (final) input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  Object.defineProperty(input, "value", {
    configurable: true,
    enumerable: true,
    get: getValue,
    set(value) {
      setNativeValue(normalizeColor(value).toLowerCase());
      sync();
    },
  });

  PALETTE.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-control-preset";
    button.dataset.color = color;
    button.style.background = color;
    button.setAttribute("aria-label", color);
    button.addEventListener("click", () => commit(color));
    palette.appendChild(button);
  });

  const commitWheelPosition = (event, final = false) => {
    const bounds = wheel.getBoundingClientRect();
    const radius = Math.max(1, Math.min(bounds.width, bounds.height) / 2);
    const deltaX = event.clientX - (bounds.left + bounds.width / 2);
    const deltaY = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.min(radius, Math.hypot(deltaX, deltaY));
    const hue =
      ((Math.atan2(deltaY, deltaX) * 180) / Math.PI + 180 + 360) % 360;
    const saturation = (distance / radius) * 100;
    const lightness = 96 - saturation * 0.46;
    commit(hexFromHsl(hue, saturation, lightness), final);
  };
  wheel.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    wheel.setPointerCapture(event.pointerId);
    commitWheelPosition(event, false);
  });
  wheel.addEventListener("pointermove", (event) => {
    if (wheel.hasPointerCapture(event.pointerId))
      commitWheelPosition(event, false);
  });
  wheel.addEventListener("pointerup", (event) => {
    if (!wheel.hasPointerCapture(event.pointerId)) return;
    commitWheelPosition(event, true);
    wheel.releasePointerCapture(event.pointerId);
  });

  trigger.addEventListener("click", () => {
    if (trigger.disabled) return;
    const opening = !wrapper.classList.contains("open");
    closeOtherPopovers(wrapper);
    wrapper.classList.toggle("open", opening);
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) {
      placePopover(wrapper, trigger, panel);
      hexField.focus();
    }
  });
  hexField.addEventListener("input", () => {
    if (COLOR_PATTERN.test(hexField.value.trim()))
      commit(hexField.value, false);
  });
  hexField.addEventListener("change", () => commit(hexField.value));
  [redField, greenField, blueField].forEach((field) => {
    field.addEventListener("input", () =>
      commit(
        hexFromRgb(redField.value, greenField.value, blueField.value),
        false,
      ),
    );
    field.addEventListener("change", () =>
      commit(hexFromRgb(redField.value, greenField.value, blueField.value)),
    );
  });
  input.addEventListener("input", sync);
  input.addEventListener("change", sync);
  new MutationObserver(sync).observe(input, {
    attributes: true,
    attributeFilter: ["disabled"],
  });
  sync();
  return wrapper;
}

export function initNativeControlSkins(root = document) {
  installDocumentDismissal();
  const enhanceWithin = (scope) => {
    if (scope.matches?.("select:not([multiple]):not([data-native-control])"))
      enhanceSelect(scope);
    if (scope.matches?.('input[type="color"]')) enhanceColorInput(scope);
    scope
      .querySelectorAll?.("select:not([multiple]):not([data-native-control])")
      .forEach(enhanceSelect);
    scope.querySelectorAll?.('input[type="color"]').forEach(enhanceColorInput);
  };
  enhanceWithin(root);
  if (root === document && !document.documentElement.dataset.controlSkinWatch) {
    document.documentElement.dataset.controlSkinWatch = "true";
    new MutationObserver((records) => {
      records.forEach((record) =>
        record.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) enhanceWithin(node);
        }),
      );
    }).observe(document.body, { childList: true, subtree: true });
  }
  return {
    selectCount: root.querySelectorAll(".native-control-shell").length,
    colorCount: root.querySelectorAll(".color-control-shell").length,
  };
}
