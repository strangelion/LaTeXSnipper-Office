import { FormulaStyleStore, normalizeFormulaStyleProfile } from "./profile.js";

const byId = (id) => document.getElementById(id);

function downloadBundle(contents) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "latexsnipper-formula-styles.lsstyle.json";
  link.click();
  URL.revokeObjectURL(url);
}

export function initFormulaStyleCenter({ onChange } = {}) {
  const preset = byId("formulaStylePreset");
  if (!preset) return null;

  const store = new FormulaStyleStore();
  let current = store.active();
  const controls = {
    name: byId("formulaStyleName"),
    officeFont: byId("formulaStyleOfficeFont"),
    textFont: byId("formulaStyleTextFont"),
    fontSizePt: byId("formulaStyleFontSize"),
    fontWeight: byId("formulaStyleWeight"),
    mathVariant: byId("formulaStyleMathVariant"),
    color: byId("formulaStyleColor"),
    displayMode: byId("formulaStyleDisplayMode"),
    alignment: byId("formulaStyleAlignment"),
    paragraphBeforePt: byId("formulaStyleBefore"),
    paragraphAfterPt: byId("formulaStyleAfter"),
    baselineShiftPt: byId("formulaStyleBaselineShift"),
    maxWidthPt: byId("formulaStyleMaxWidth"),
    strategy: byId("formulaStyleStrategy"),
  };
  const status = byId("formulaStyleStatus");

  const announce = (message, state = "") => {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  };

  const renderPresetList = () => {
    preset.replaceChildren();
    const profiles = store.list();
    for (const item of profiles) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.builtIn ? item.name : `${item.name} · 自定义`;
      preset.appendChild(option);
    }
    if (!profiles.some((item) => item.id === current.id)) {
      const option = document.createElement("option");
      option.value = current.id;
      option.textContent = `${current.name} · 公式快照`;
      preset.appendChild(option);
    }
    preset.value = current.id;
  };

  const renderControls = () => {
    renderPresetList();
    controls.name.value = current.name;
    controls.officeFont.value = current.math.officeFont;
    controls.textFont.value = current.math.textFont;
    controls.fontSizePt.value = String(current.math.fontSizePt);
    controls.fontWeight.value = current.math.fontWeight;
    controls.mathVariant.value = current.math.mathVariant;
    controls.color.value = current.math.color;
    controls.displayMode.value = current.layout.displayMode;
    controls.alignment.value = current.layout.alignment;
    controls.paragraphBeforePt.value = String(current.layout.paragraphBeforePt);
    controls.paragraphAfterPt.value = String(current.layout.paragraphAfterPt);
    controls.baselineShiftPt.value = String(current.layout.baselineShiftPt);
    controls.maxWidthPt.value = String(current.layout.maxWidthPt);
    controls.strategy.value = current.output.strategy;
    byId("formulaStyleDelete").disabled = current.builtIn;
  };

  const emit = (message = "样式已应用到预览及图片输出", source = "edit") => {
    current = normalizeFormulaStyleProfile(current);
    onChange?.(structuredClone(current), { source });
    announce(message, "success");
  };

  const readControls = () => {
    current = normalizeFormulaStyleProfile(
      {
        ...current,
        name: controls.name.value,
        math: {
          ...current.math,
          officeFont: controls.officeFont.value,
          textFont: controls.textFont.value,
          fontSizePt: controls.fontSizePt.value,
          fontWeight: controls.fontWeight.value,
          mathVariant: controls.mathVariant.value,
          color: controls.color.value,
        },
        layout: {
          ...current.layout,
          displayMode: controls.displayMode.value,
          alignment: controls.alignment.value,
          paragraphBeforePt: controls.paragraphBeforePt.value,
          paragraphAfterPt: controls.paragraphAfterPt.value,
          baselineShiftPt: controls.baselineShiftPt.value,
          maxWidthPt: controls.maxWidthPt.value,
        },
        output: { ...current.output, strategy: controls.strategy.value },
      },
      current,
    );
    renderControls();
    emit();
  };

  preset.addEventListener("change", () => {
    current = store.select(preset.value);
    renderControls();
    emit(`已加载“${current.name}”；历史公式仍保留自己的样式快照`, "preset");
  });
  for (const control of Object.values(controls)) {
    control?.addEventListener("change", readControls);
  }

  byId("formulaStyleSaveAs")?.addEventListener("click", () => {
    current = store.saveAs(controls.name.value || "自定义样式", current);
    renderControls();
    emit(`已另存为“${current.name}”`);
  });
  byId("formulaStyleSetDefault")?.addEventListener("click", () => {
    if (current.builtIn) {
      current = store.saveAs(`${current.name} 自定义`, current);
    } else {
      current = store.update(current.id, current) || current;
    }
    store.select(current.id);
    renderControls();
    emit(`“${current.name}”已保存并设为新公式默认样式`, "preset");
  });
  byId("formulaStyleDelete")?.addEventListener("click", () => {
    if (!store.remove(current.id)) return;
    current = store.active();
    renderControls();
    emit("自定义样式已删除，已恢复正文行内样式");
  });
  byId("formulaStyleExport")?.addEventListener("click", () => {
    downloadBundle(store.exportBundle());
    announce("已导出 LaTeXSnipper 样式包", "success");
  });
  byId("formulaStyleImport")?.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    try {
      const imported = store.importBundle(await file.text());
      current = store.active();
      renderControls();
      emit(`已导入 ${imported.length} 个经过校验的样式`);
    } catch (error) {
      announce(`导入失败：${error?.message || error}`, "error");
    } finally {
      event.target.value = "";
    }
  });

  renderControls();
  emit(`已加载“${current.name}”`);
  return {
    getCurrent: () => structuredClone(current),
    patch(patch) {
      current = normalizeFormulaStyleProfile(
        {
          ...current,
          ...patch,
          math: { ...current.math, ...(patch.math || {}) },
          layout: { ...current.layout, ...(patch.layout || {}) },
          output: { ...current.output, ...(patch.output || {}) },
        },
        current,
      );
      renderControls();
      emit();
    },
    loadSnapshot(snapshot) {
      current = normalizeFormulaStyleProfile(snapshot);
      renderControls();
      emit(`已从 Office 公式恢复样式“${current.name}”`, "snapshot");
    },
  };
}
