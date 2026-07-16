// LaTeXSnipper Office - Main JavaScript

import { t, applyTranslations, setLocale, getResolvedLocale } from "./i18n.js";
import { FormulaSvgRenderer } from "./services/formula-svg-renderer.js";
import {
  FORMULA_INSERT_MODES,
  normalizeOfficeInsertMode,
  officeInsertModeIsDisplay,
} from "./services/office-insert-mode.js";

// ═══════════════════════════════════════════
// Logging System
// ═══════════════════════════════════════════
const Logger = {
  _prefix: "[LaTeXSnipper]",

  log(message, ...args) {
    console.log(`${this._prefix} ${message}`, ...args);
  },

  info(message, ...args) {
    console.info(`${this._prefix} [INFO] ${message}`, ...args);
  },

  warn(message, ...args) {
    console.warn(`${this._prefix} [WARN] ${message}`, ...args);
  },

  error(message, ...args) {
    console.error(`${this._prefix} [ERROR] ${message}`, ...args);
  },

  debug(message, ...args) {
    console.debug(`${this._prefix} [DEBUG] ${message}`, ...args);
  },
};

Logger.info("Application starting...");

function selectedFormulaInsertMode() {
  const selected = document.querySelector(
    'input[name="formulaInsertMode"]:checked',
  );
  return normalizeOfficeInsertMode(selected?.value);
}

function matchesOfficeEditAction(action) {
  return action === "insert" || action === "edit";
}

// ═══════════════════════════════════════════
// MathLive Chinese Translation
// ═══════════════════════════════════════════
const MATHLIVE_I18N = {
  "keyboard.tooltip.symbols": "符号",
  "keyboard.tooltip.greek": "希腊字母",
  "keyboard.tooltip.numeric": "数字",
  "keyboard.tooltip.alphabetic": "罗马字母",
  "tooltip.copy to clipboard": "复制到剪贴板",
  "tooltip.cut to clipboard": "剪切到剪贴板",
  "tooltip.paste from clipboard": "从剪贴板粘贴",
  "tooltip.redo": "重做",
  "tooltip.toggle virtual keyboard": "切换虚拟键盘",
  "tooltip.menu": "菜单",
  "tooltip.undo": "撤销",
  "menu.borders": "矩阵边框",
  "menu.insert matrix": "插入矩阵",
  "menu.array.add row above": "上方添加行",
  "menu.array.add row below": "下方添加行",
  "menu.array.add column after": "右侧添加列",
  "menu.array.add column before": "左侧添加列",
  "menu.array.delete row": "删除行",
  "menu.array.delete rows": "删除选中行",
  "menu.array.delete column": "删除列",
  "menu.array.delete columns": "删除选中列",
  "menu.mode": "模式",
  "menu.mode-math": "数学",
  "menu.mode-text": "文本",
  "menu.mode-latex": "LaTeX",
  "menu.insert": "插入",
  "menu.insert.abs": "绝对值",
  "menu.insert.nth-root": "n 次根号",
  "menu.insert.log-base": "对数 (log)",
  "menu.insert.heading-calculus": "微积分",
  "menu.insert.derivative": "导数",
  "menu.insert.nth-derivative": "n 阶导数",
  "menu.insert.integral": "积分",
  "menu.insert.sum": "求和",
  "menu.insert.product": "乘积",
  "menu.insert.heading-complex-numbers": "复数",
  "menu.insert.modulus": "模",
  "menu.insert.argument": "辐角",
  "menu.insert.real-part": "实部",
  "menu.insert.imaginary-part": "虚部",
  "menu.insert.conjugate": "共轭",
  "tooltip.blackboard": "黑板粗体",
  "tooltip.bold": "粗体",
  "tooltip.italic": "斜体",
  "tooltip.fraktur": "哥特体",
  "tooltip.script": "手写体",
  "tooltip.caligraphic": "书法体",
  "tooltip.typewriter": "等宽",
  "tooltip.roman-upright": "罗马正体",
  "tooltip.row-by-col": "%@ × %@",
  "menu.font-style": "字体风格",
  "menu.accent": "重音/修饰",
  "menu.decoration": "装饰",
  "menu.color": "颜色",
  "menu.background-color": "背景",
  "menu.evaluate": "计算",
  "menu.simplify": "化简",
  "menu.solve": "求解",
  "menu.solve-for": "求解 %@",
  "menu.cut": "剪切",
  "menu.copy": "复制",
  "menu.copy-as-latex": "复制为 LaTeX",
  "menu.copy-as-typst": "复制为 Typst",
  "menu.copy-as-ascii-math": "复制为 ASCII Math",
  "menu.copy-as-mathml": "复制为 MathML",
  "menu.paste": "粘贴",
  "menu.select-all": "全选",
  "color.red": "红色",
  "color.orange": "橙色",
  "color.yellow": "黄色",
  "color.lime": "青柠色",
  "color.green": "绿色",
  "color.teal": "蓝绿色",
  "color.cyan": "青色",
  "color.blue": "蓝色",
  "color.indigo": "靛蓝色",
  "color.purple": "紫色",
  "color.magenta": "品红色",
  "color.black": "黑色",
  "color.dark-grey": "深灰色",
  "color.grey": "灰色",
  "color.light-grey": "浅灰色",
  "color.white": "白色",
};

// ═══════════════════════════════════════════
// Temml Renderer
// ═══════════════════════════════════════════
class TemmlRenderer {
  constructor() {
    Logger.info("TemmlRenderer initializing...");
    this.loaded = false;
  }

  async init() {
    if (this.loaded) return true;
    try {
      const Temml = await import("temml/dist/temml.mjs");
      this.temml = Temml.default || Temml;

      // Register unsupported LaTeX macros
      this.macros = {
        "\\bm": "\\mathbf",
        "\\boldsymbol": "\\mathbf",
        "\\operatorname": "\\mathrm",
      };

      this.loaded = true;
      Logger.info("Temml loaded");
      return true;
    } catch (e) {
      Logger.error("Failed to load Temml:", e);
      return false;
    }
  }

  async render(latex, display = false) {
    if (!this.loaded) {
      const ok = await this.init();
      if (!ok) return `<span>${latex}</span>`;
    }

    try {
      const html = this.temml.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
      });
      return html;
    } catch (e) {
      Logger.error("Temml render error:", e);
      return `<span>${latex}</span>`;
    }
  }

  // LaTeX → MathML
  toMathML(latex) {
    if (!this.loaded) return "";
    try {
      // Register unsupported macros before converting
      const macros = {
        "\\bm": "\\mathbf",
        "\\boldsymbol": "\\mathbf",
        "\\operatorname": "\\mathrm",
      };
      return this.temml.renderToString(latex, {
        xml: true,
        macros: macros,
        throwOnError: false,
      });
    } catch (e) {
      Logger.error("Temml toMathML error:", e);
      // Fallback to basic parser
      return this._latexToMathMLFallback(latex);
    }
  }

  _latexToMathMLFallback(latex) {
    const result = this._parseLatex(latex, 0);
    return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow>${result.xml}</mrow></math>`;
  }
}

// ═══════════════════════════════════════════
// Custom Select Component
// ═══════════════════════════════════════════
class CustomSelect {
  constructor(element) {
    this.element = element;
    this.trigger = element.querySelector(".custom-select-trigger");
    this.dropdown = element.querySelector(".custom-select-dropdown");
    this.options = element.querySelectorAll(".custom-select-option");
    this.value = this.trigger.dataset.value || "";

    this.init();
  }

  init() {
    this.trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.options.forEach((option) => {
      option.addEventListener("click", (e) => {
        e.stopPropagation();
        this.select(option);
      });
    });

    document.addEventListener("click", () => {
      this.close();
    });
  }

  toggle() {
    this.element.classList.contains("open") ? this.close() : this.open();
  }

  open() {
    document
      .querySelectorAll(".custom-select.open")
      .forEach((s) => s.classList.remove("open"));
    this.element.classList.add("open");
  }

  close() {
    this.element.classList.remove("open");
  }

  select(option) {
    this.options.forEach((opt) => opt.classList.remove("selected"));
    option.classList.add("selected");
    this.value = option.dataset.value;
    this.trigger.querySelector("span").textContent = option.textContent;
    this.trigger.dataset.value = this.value;
    this.close();

    Logger.debug(`CustomSelect: ${this.value}`);

    this.element.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: this.value },
      }),
    );
  }

  getValue() {
    return this.value;
  }

  setValue(value) {
    const option = this.element.querySelector(`[data-value="${value}"]`);
    if (option) this.select(option);
  }
}

// ═══════════════════════════════════════════
// Formula Editor
// ═══════════════════════════════════════════
class FormulaEditor {
  constructor() {
    Logger.info("FormulaEditor initializing...");
    this.mathfield = null;
    this.renderer = new TemmlRenderer();
    this.init();
  }

  async init() {
    Logger.debug("FormulaEditor init");

    try {
      const { MathfieldElement } = await import("mathlive");

      const container = document.getElementById("mathfieldHost");
      if (container) {
        this.mathfield = new MathfieldElement();
        this.mathfield.setAttribute("virtual-keyboard-mode", "manual");
        container.appendChild(this.mathfield);

        this.mathfield.addEventListener("input", () => {
          const latex = this.mathfield.getValue("latex");
          Logger.debug(`MathLive input: ${latex.substring(0, 30)}...`);

          const source = document.getElementById("latexSource");
          if (source) {
            source.value = latex;
          }

          this.updatePreview(latex);
        });

        this.mathfield.addEventListener("keystroke", (e) => {
          Logger.debug(`MathLive keystroke: ${e.key}`);
        });

        Logger.info("MathLive editor initialized");
      }

      this.renderer.init().then(() => {
        Logger.info("Temml preloaded");
      });
    } catch (e) {
      Logger.error("Failed to initialize FormulaEditor:", e);
    }
  }

  async updatePreview(latex) {
    const previewHost = document.getElementById("previewHost");
    if (!previewHost) return;

    if (!latex) {
      previewHost.innerHTML =
        '<span style="color: var(--muted);">输入公式后预览</span>';
      return;
    }

    const display = officeInsertModeIsDisplay(selectedFormulaInsertMode());
    Logger.debug(`updatePreview: display=${display}`);

    if (!this.renderer.loaded) {
      Logger.debug("Waiting for Temml to load...");
      await this.renderer.init();
    }

    const svg = await this.renderer.render(latex, display);
    previewHost.innerHTML = svg;
  }

  setLatex(latex) {
    Logger.debug(`setLatex: ${latex.substring(0, 30)}...`);
    if (this.mathfield) {
      this.mathfield.setValue(latex);
    }
    const source = document.getElementById("latexSource");
    if (source) {
      source.value = latex;
    }
    this.updatePreview(latex);
  }

  getLatex() {
    if (this.mathfield) {
      return this.mathfield.getValue("latex");
    }
    return document.getElementById("latexSource")?.value || "";
  }

  async copyToClipboard(text) {
    Logger.info("copyToClipboard");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke("copy_to_clipboard", { text });
      Logger.debug("Tauri copy successful");
      return result;
    } catch (e) {
      Logger.warn("Tauri failed, using browser clipboard");
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e2) {
        Logger.error("Copy failed:", e2.message);
        return false;
      }
    }
  }
}

// ═══════════════════════════════════════════
// formula library
// ═══════════════════════════════════════════
class FormulaLibrary {
  constructor() {
    Logger.info("FormulaLibrary initializing...");
    this.categories = [];
    this.formulas = {};
    this.loaded = false;
  }

  async load() {
    Logger.debug("Loading formula data...");

    try {
      const indexResponse = await fetch("/formulas/_index.json");
      const indexData = await indexResponse.json();

      for (const categoryId of indexData.order) {
        try {
          const response = await fetch(`/formulas/${categoryId}.json`);
          const data = await response.json();

          this.categories.push({
            id: categoryId,
            name: this._getCategoryName(categoryId),
          });

          this.formulas[categoryId] = (data.items || [])
            .filter((item) => Array.isArray(item))
            .map((item) => ({
              label: item[0],
              latex: item[1],
            }));

          Logger.debug(
            `Loaded ${this.formulas[categoryId].length} formulas for ${categoryId}`,
          );
        } catch (e) {
          Logger.warn(`Failed to load category ${categoryId}:`, e.message);
        }
      }

      this.loaded = true;
      Logger.info(`Loaded ${this.categories.length} categories`);
    } catch (e) {
      Logger.error("Failed to load formula data:", e);
      this._loadFallbackData();
    }
  }

  _getCategoryName(id) {
    const names = {
      greek: "希腊字母",
      structures: "结构",
      delimiters: "定界符",
      analysis: "分析",
      algebra: "代数",
      geometry: "几何",
      topology: "拓扑",
      numberTheory: "数论",
      relations: "关系",
      operators: "运算符",
      bigops: "大运算符",
      arrows: "箭头",
      sets: "集合",
      functions: "函数",
      probability: "概率",
      physics: "物理",
      chemistry: "化学",
      misc: "其他",
    };
    return names[id] || id;
  }

  _loadFallbackData() {
    Logger.info("Loading fallback formula data...");
    this.categories = [
      { id: "greek", name: "希腊字母" },
      { id: "structures", name: "结构" },
      { id: "operators", name: "运算符" },
      { id: "relations", name: "关系" },
      { id: "misc", name: "其他" },
    ];
    this.formulas = {
      greek: [
        { latex: "\\alpha", label: "α" },
        { latex: "\\beta", label: "β" },
        { latex: "\\gamma", label: "γ" },
        { latex: "\\delta", label: "δ" },
        { latex: "\\pi", label: "π" },
        { latex: "\\sigma", label: "σ" },
        { latex: "\\omega", label: "ω" },
      ],
      structures: [
        { latex: "\\frac{a}{b}", label: "分数" },
        { latex: "\\sqrt{x}", label: "根号" },
        { latex: "x^{n}", label: "上标" },
        { latex: "x_{n}", label: "下标" },
        { latex: "\\int_{a}^{b}", label: "积分" },
        { latex: "\\sum_{i=1}^{n}", label: "求和" },
      ],
      operators: [
        { latex: "+", label: "加" },
        { latex: "-", label: "减" },
        { latex: "\\times", label: "乘" },
        { latex: "\\div", label: "除" },
        { latex: "\\pm", label: "±" },
        { latex: "\\infty", label: "无穷" },
      ],
      relations: [
        { latex: "=", label: "等于" },
        { latex: "\\neq", label: "不等于" },
        { latex: "<", label: "小于" },
        { latex: ">", label: "大于" },
        { latex: "\\leq", label: "≤" },
        { latex: "\\geq", label: "≥" },
        { latex: "\\in", label: "∈" },
        { latex: "\\subset", label: "⊂" },
      ],
      misc: [
        { latex: "\\forall", label: "∀" },
        { latex: "\\exists", label: "∃" },
        { latex: "\\ldots", label: "…" },
        { latex: "\\angle", label: "∠" },
      ],
    };
    this.loaded = true;
    Logger.info("Fallback data loaded");
  }

  getCategories() {
    return this.categories;
  }
  getFormulas(category) {
    return this.formulas[category] || [];
  }

  search(query) {
    Logger.debug(`search: "${query}"`);
    const results = [];
    const q = query.toLowerCase().trim();
    if (!q) return results;

    for (const category of this.categories) {
      for (const formula of this.getFormulas(category.id)) {
        if (this._smartMatch(q, formula)) {
          results.push({ formula, category: category.name });
        }
      }
    }
    Logger.debug(`search: ${results.length} results`);
    return results;
  }

  _smartMatch(query, formula) {
    const q = query.toLowerCase();
    const label = (formula.label || "").toLowerCase();
    const latex = (formula.latex || "").toLowerCase();

    if (label.includes(q) || latex.includes(q)) return true;

    const py = this._pinyinInitials(query);
    if (py.length >= 2 && (label.includes(py) || latex.includes(py)))
      return true;

    const aliases = this._getSearchAliases();
    for (const [cmd, aliasList] of Object.entries(aliases)) {
      if (q.includes(cmd) || cmd.includes(q)) {
        for (const alias of aliasList) {
          if (
            label.includes(alias.toLowerCase()) ||
            latex.includes("\\" + cmd)
          ) {
            return true;
          }
        }
      }
    }

    return false;
  }

  _pinyinInitials(str) {
    const map = {
      分: "f",
      数: "s",
      极: "j",
      限: "x",
      积: "j",
      求: "q",
      和: "h",
      矩: "j",
      阵: "z",
      向: "x",
      量: "l",
      特: "t",
      征: "z",
      值: "z",
      行: "h",
      列: "l",
      式: "s",
      秩: "z",
      逆: "n",
      转: "z",
      置: "z",
      梯: "t",
      度: "d",
      散: "s",
      旋: "x",
      拉: "l",
      普: "p",
      斯: "s",
      无: "w",
      穷: "q",
      空: "k",
      集: "j",
      属: "s",
      于: "y",
      并: "b",
      交: "j",
      子: "z",
      超: "c",
      非: "f",
      对: "d",
      数: "s",
      指: "z",
      正: "z",
      余: "y",
      切: "q",
      双: "s",
      曲: "q",
      反: "f",
      自: "z",
      然: "r",
      最: "z",
      大: "d",
      上: "s",
      确: "q",
      界: "j",
      分: "f",
      段: "d",
      行: "h",
      列: "l",
      迹: "j",
      共: "g",
      轭: "e",
      偏: "p",
      导: "d",
      欧: "o",
      米: "m",
      伽: "j",
      马: "m",
      阿: "a",
      尔: "e",
      贝: "b",
      塔: "t",
      德: "d",
      西: "x",
      斐: "f",
      陶: "t",
      卡: "k",
      克: "k",
      艾: "a",
      泽: "z",
      普: "p",
      柔: "r",
      派: "p",
      格: "g",
      推: "t",
      出: "c",
      等: "d",
      价: "j",
      负: "f",
      约: "y",
      恒: "h",
      属: "s",
      包: "b",
      含: "h",
      左: "z",
      右: "y",
      箭: "j",
      头: "t",
      逻: "l",
      辑: "j",
      与: "y",
      或: "h",
      不: "b",
      粗: "c",
      黑: "h",
      板: "b",
      书: "s",
      法: "f",
      哥: "g",
      特: "t",
      组: "z",
      合: "h",
      文: "w",
      本: "b",
      运: "y",
      算: "s",
      符: "f",
      点: "d",
      乘: "c",
      叉: "c",
      除: "c",
      微: "w",
      三: "s",
      角: "j",
      函: "h",
      几: "j",
      何: "h",
      代: "d",
      概: "g",
      率: "l",
      物: "w",
      理: "l",
      化: "h",
      学: "x",
    };
    let r = "";
    for (const ch of str) {
      if (map[ch]) r += map[ch];
    }
    return r;
  }

  _getSearchAliases() {
    return {
      frac: ["分数", "fraction"],
      sqrt: ["根号", "平方根", "square root"],
      lim: ["极限", "limit"],
      int: ["积分", "integral"],
      sum: ["求和", "summation"],
      prod: ["求积", "product"],
      vec: ["向量", "vector"],
      dot: ["点乘", "dot"],
      sin: ["正弦", "sine"],
      cos: ["余弦", "cosine"],
      tan: ["正切", "tangent"],
      log: ["对数", "logarithm"],
      ln: ["自然对数"],
      exp: ["指数", "exponential"],
      max: ["最大值", "maximum"],
      min: ["最小值", "minimum"],
      alpha: ["阿尔法"],
      beta: ["贝塔"],
      gamma: ["伽马"],
      delta: ["德尔塔"],
      epsilon: ["艾普西隆"],
      theta: ["西塔"],
      lambda: ["拉姆达"],
      mu: ["缪"],
      pi: ["派"],
      sigma: ["西格玛"],
      phi: ["斐"],
      omega: ["欧米伽"],
      matrix: ["矩阵", "matrix"],
      det: ["行列式", "determinant"],
      infty: ["无穷", "infinity"],
      emptyset: ["空集", "empty set"],
      forall: ["任意", "for all"],
      exists: ["存在", "exists"],
      subset: ["子集", "subset"],
      cup: ["并集", "union"],
      cap: ["交集", "intersection"],
      in: ["属于", "element of"],
      leq: ["小于等于"],
      geq: ["大于等于"],
      neq: ["不等于"],
      approx: ["约等于", "approximately"],
    };
  }
}

// ═══════════════════════════════════════════
// Settings Manager
// ═══════════════════════════════════════════
class SettingsManager {
  constructor() {
    this.defaults = {
      displayMode: "inline",
      fontStyle: "tex",
      fontColor: "#000000",
      bridgeUrl: "http://127.0.0.1:19877",
      theme: "light",
      officeEnabled: true,
      officeIntegrationMode: "auto",
      ocrEnabled: true,
    };
    this.settings = this.load();
    Logger.info("Settings loaded");
  }

  load() {
    try {
      const saved = localStorage.getItem("settings");
      return saved
        ? { ...this.defaults, ...JSON.parse(saved) }
        : { ...this.defaults };
    } catch {
      return { ...this.defaults };
    }
  }

  save() {
    localStorage.setItem("settings", JSON.stringify(this.settings));
    Logger.debug("Settings saved");
  }

  get(key) {
    return this.settings[key];
  }

  set(key, value) {
    this.settings[key] = value;
    this.save();
    Logger.debug(`Setting ${key} = ${value}`);
  }
}

// ═══════════════════════════════════════════
// Export Helper
// ═══════════════════════════════════════════
class ExportHelper {
  static downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Logger.info(`Downloaded: ${filename}`);
  }

  static exportToTex(latex) {
    const content = `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\begin{document}

${latex}

\\end{document}`;
    this.downloadFile(content, "formula.tex", "application/x-tex");
  }

  static exportToSvg(svgContent) {
    this.downloadFile(svgContent, "formula.svg", "image/svg+xml");
  }
}

// ═══════════════════════════════════════════
// Theme Manager
// ═══════════════════════════════════════════
class ThemeManager {
  constructor() {
    this.currentTheme = localStorage.getItem("theme") || "light";
    Logger.info(`Theme: ${this.currentTheme}`);
    this.apply();
  }

  toggle() {
    this.currentTheme = this.currentTheme === "light" ? "dark" : "light";
    localStorage.setItem("theme", this.currentTheme);
    this.apply();
    this.updateButton();
    Logger.info(`Theme → ${this.currentTheme}`);
  }

  apply() {
    document.documentElement.setAttribute("data-theme", this.currentTheme);
  }

  updateButton() {
    const btn = document.getElementById("themeToggle");
    if (btn) {
      if (this.currentTheme === "light") {
        btn.innerHTML = `<svg class="theme-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
      } else {
        btn.innerHTML = `<svg class="theme-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
      }
    }
  }
}

// ═══════════════════════════════════════════
// UnicodeMath → LaTeX
// ═══════════════════════════════════════════
function unicodeMathToLatex(s) {
  if (!s) return "";
  const mathItalicA = 0x1d434;
  const mathBoldA = 0x1d400;
  const mathScriptA = 0x1d49c;
  const mathFrakturA = 0x1d504;
  const mathDoubleA = 0x1d538;
  const mathMonoA = 0x1d670;

  let result = "";
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    const isSup = cp >= 0x2070 && cp <= 0x2079;
    const isSub = cp >= 0x2080 && cp <= 0x2089;

    if (cp >= mathBoldA && cp < mathBoldA + 52) {
      const idx = cp - mathBoldA;
      const ch =
        idx < 26
          ? String.fromCharCode(65 + idx)
          : String.fromCharCode(97 + idx - 26);
      result += `\\mathbf{${ch}}`;
    } else if (cp >= mathItalicA && cp < mathItalicA + 52) {
      const idx = cp - mathItalicA;
      const ch =
        idx < 26
          ? String.fromCharCode(65 + idx)
          : String.fromCharCode(97 + idx - 26);
      result += ch;
    } else if (cp >= mathScriptA && cp < mathScriptA + 52) {
      const idx = cp - mathScriptA;
      const ch =
        idx < 26
          ? String.fromCharCode(65 + idx)
          : String.fromCharCode(97 + idx - 26);
      result += `\\mathcal{${ch}}`;
    } else if (cp >= mathFrakturA && cp < mathFrakturA + 52) {
      const idx = cp - mathFrakturA;
      const ch =
        idx < 26
          ? String.fromCharCode(65 + idx)
          : String.fromCharCode(97 + idx - 26);
      result += `\\mathfrak{${ch}}`;
    } else if (cp >= mathDoubleA && cp < mathDoubleA + 52) {
      const idx = cp - mathDoubleA;
      const ch =
        idx < 26
          ? String.fromCharCode(65 + idx)
          : String.fromCharCode(97 + idx - 26);
      result += `\\mathbb{${ch}}`;
    } else if (cp >= mathMonoA && cp < mathMonoA + 52) {
      const idx = cp - mathMonoA;
      const ch =
        idx < 26
          ? String.fromCharCode(65 + idx)
          : String.fromCharCode(97 + idx - 26);
      result += `\\mathtt{${ch}}`;
    } else if (isSup) {
      const digit = String(cp - 0x2070);
      if (cp === 0x2070) result += "^{0}";
      else if (cp === 0x00b9) result += "^{1}";
      else if (cp === 0x00b2) result += "^{2}";
      else if (cp === 0x00b3) result += "^{3}";
      else result += `^{${digit}}`;
    } else if (isSub) {
      const digit = String(cp - 0x2080);
      result += `_{${digit}}`;
    } else {
      const special = {
        0x2211: "\\sum",
        0x220f: "\\prod",
        0x222b: "\\int",
        0x222c: "\\iint",
        0x222e: "\\oint",
        0x2210: "\\coprod",
        0x2202: "\\partial",
        0x2207: "\\nabla",
        0x221e: "\\infty",
        0x2205: "\\emptyset",
        0x2200: "\\forall",
        0x2203: "\\exists",
        0x2208: "\\in",
        0x2209: "\\notin",
        0x2282: "\\subset",
        0x2283: "\\supset",
        0x2286: "\\subseteq",
        0x2287: "\\supseteq",
        0x2229: "\\cap",
        0x222a: "\\cup",
        0x2261: "\\equiv",
        0x2248: "\\approx",
        0x223c: "\\sim",
        0x2264: "\\leq",
        0x2265: "\\geq",
        0x2260: "\\neq",
        0x00d7: "\\times",
        0x00b1: "\\pm",
        0x2213: "\\mp",
        0x22c5: "\\cdot",
        0x2192: "\\rightarrow",
        0x2190: "\\leftarrow",
        0x2194: "\\leftrightarrow",
        0x21d2: "\\Rightarrow",
        0x21d0: "\\Leftarrow",
        0x00ac: "\\neg",
        0x2227: "\\wedge",
        0x2228: "\\vee",
        0x2234: "\\therefore",
        0x2235: "\\because",
        0x2026: "\\ldots",
        0x22ef: "\\cdots",
        0x22ee: "\\vdots",
        0x22f1: "\\ddots",
        0x2262: "\\not\\equiv",
        0x223d: "\\backsim",
        0x27e8: "\\langle",
        0x27e9: "\\rangle",
        0x230a: "\\lfloor",
        0x230b: "\\rfloor",
        0x2308: "\\lceil",
        0x2309: "\\rceil",
        0x221d: "\\propto",
        0x2223: "\\mid",
        0x2225: "\\parallel",
        0x2216: "\\setminus",
        0x00b0: "\\degree",
        0x2135: "\\aleph",
        0x210f: "\\hbar",
        0x211c: "\\Re",
        0x2111: "\\Im",
        0x2133: "\\mathcal{M}",
      };
      if (special[cp]) {
        result += special[cp];
      } else if (cp === 0x2032) {
        result += "'";
      } else if (cp === 0x2033) {
        result += "''";
      } else if (cp <= 0x7f || (cp >= 0xa0 && cp < 0x10000)) {
        result += s[i];
      }
    }
    i += cp > 0xffff ? 2 : 1;
  }

  // Post-process: group consecutive superscripts/subscripts
  result = result.replace(/\^\{(\d+)\}\^\{(\d+)\}/g, "^{$1$2}");
  result = result.replace(/_\{(\d+)\}_\{(\d+)\}/g, "_{$1$2}");

  return result;
}

// ═══════════════════════════════════════════
// Extract OMML math element from Word document XML
// ═══════════════════════════════════════════
function extractMathElement(xml) {
  let decoded = xml;
  if (
    xml.indexOf("&lt;") !== -1 ||
    xml.indexOf("&#") !== -1 ||
    xml.indexOf("&amp;") !== -1
  ) {
    decoded = xml
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    Logger.info(
      `[extractMath] Decoded HTML entities, new length: ${decoded.length}`,
    );
  }

  const patterns = [
    /<m:oMathPara[\s>]/,
    /<m:oMath[\s>]/,
    /<\w+:oMathPara[\s>]/,
    /<\w+:oMath[\s>]/,
    /<oMathPara[\s>]/,
    /<oMath[\s>]/,
  ];

  for (const pat of patterns) {
    const m = decoded.match(pat);
    if (m) {
      const start = m.index;
      const rawTag = m[0].trim().replace(/[\s>]$/, "");
      const closeTag = rawTag.replace(/^</, "</") + ">";
      const end = decoded.indexOf(closeTag, start);
      if (end > start) {
        let result = decoded.substring(start, end + closeTag.length);
        if (!result.includes("xmlns:m=")) {
          const ns =
            ' xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
          const gtIdx = result.indexOf(">");
          if (gtIdx > 0) {
            result = result.substring(0, gtIdx) + ns + result.substring(gtIdx);
          }
        }
        if (!result.includes("xmlns:w=")) {
          const ns =
            ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
          const gtIdx = result.indexOf(">");
          if (gtIdx > 0) {
            result = result.substring(0, gtIdx) + ns + result.substring(gtIdx);
          }
        }
        Logger.info(
          `[extractMath] Extracted: ${rawTag} at ${start}..${end} (${result.length}b)`,
        );
        return result;
      }
    }
  }

  Logger.warn("[extractMath] No oMath tag found, returning decoded XML");
  return decoded;
}

// ═══════════════════════════════════════════
// OMML → LaTeX
// ═══════════════════════════════════════════
const OMML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function ommlToLatex(omml) {
  if (!omml) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(omml, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    Logger.error("OMML parse error:", err.textContent);
    return omml;
  }
  const root = doc.documentElement;
  return _walkOmml(root);
}

function _ommlEl(node, localName) {
  return node.getElementsByTagNameNS(OMML_NS, localName)[0] || null;
}

function _ommlChildren(node, localName) {
  return Array.from(node.getElementsByTagNameNS(OMML_NS, localName));
}

function _walkOmml(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.textContent || "";
  if (node.nodeType !== 1) return "";

  const tag = node.localName;

  // Top-level containers
  if (tag === "oMathPara" || tag === "oMath") {
    const children = Array.from(node.childNodes).filter(
      (n) => n.nodeType === 1,
    );
    return children.map(_walkOmml).join("");
  }

  // Text run
  if (tag === "r") {
    const t = _ommlEl(node, "t");
    return t ? t.textContent : "";
  }

  // Superscript
  if (tag === "sSup") {
    const e = _ommlEl(node, "e");
    const sup = _ommlEl(node, "sup");
    const base = _walkOmml(e);
    const s = _walkOmml(sup);
    return `${base}^{${s}}`;
  }

  // Subscript
  if (tag === "sSub") {
    const e = _ommlEl(node, "e");
    const sub = _ommlEl(node, "sub");
    const base = _walkOmml(e);
    const s = _walkOmml(sub);
    return `${base}_{${s}}`;
  }

  // Sub-superscript
  if (tag === "sSubSup") {
    const e = _ommlEl(node, "e");
    const sub = _ommlEl(node, "sub");
    const sup = _ommlEl(node, "sup");
    const base = _walkOmml(e);
    return `${base}_{${_walkOmml(sub)}}^{${_walkOmml(sup)}}`;
  }

  // Pre-sub-superscript
  if (tag === "sPre") {
    const e = _ommlEl(node, "e");
    const sub = _ommlEl(node, "sub");
    const sup = _ommlEl(node, "sup");
    return `_{${_walkOmml(sub)}}^{${_walkOmml(sup)}}${_walkOmml(e)}`;
  }

  // Fraction
  if (tag === "f") {
    const num = _ommlEl(node, "num");
    const den = _ommlEl(node, "den");
    return `\\frac{${_walkOmml(num)}}{${_walkOmml(den)}}`;
  }

  // Radical
  if (tag === "rad") {
    const deg = _ommlEl(node, "deg");
    const e = _ommlEl(node, "e");
    const degText = deg ? _walkOmml(deg).trim() : "";
    if (degText && degText !== "2") {
      return `\\sqrt[${degText}]{${_walkOmml(e)}}`;
    }
    return `\\sqrt{${_walkOmml(e)}}`;
  }

  // N-ary (sum, integral, product, etc.)
  if (tag === "nary") {
    const chr = _ommlEl(node, "chr");
    const sub = _ommlEl(node, "sub");
    const sup = _ommlEl(node, "sup");
    const e = _ommlEl(node, "e");
    const charAttr = node.getElementsByTagNameNS(OMML_NS, "chr")[0];
    let op = "\u222B"; // default integral
    if (charAttr) {
      const val =
        charAttr.getAttribute("m:val") || charAttr.getAttribute("val");
      if (val)
        op = String.fromCodePoint(
          parseInt(val.replace("0x", ""), 16) || val.charCodeAt(0),
        );
    }
    const opMap = {
      "\u222B": "\\int",
      "\u222C": "\\iint",
      "\u222D": "\\iiint",
      "\u222E": "\\oint",
      "\u2211": "\\sum",
      "\u220F": "\\prod",
      "\u2210": "\\coprod",
      "\u222F": "\\oiint",
      "\u2230": "\\oiiint",
    };
    const opCmd = opMap[op] || op;
    let result = opCmd;
    if (sub) result += `_{${_walkOmml(sub)}}`;
    if (sup) result += `^{${_walkOmml(sup)}}`;
    result += ` ${_walkOmml(e)}`;
    return result;
  }

  // Delimiter (parentheses, brackets, etc.)
  if (tag === "d") {
    const dPr = _ommlEl(node, "dPr");
    let beg = "(",
      end = ")";
    if (dPr) {
      const bCh = _ommlEl(dPr, "begChr");
      const eCh = _ommlEl(dPr, "endChr");
      if (bCh) {
        const v = bCh.getAttribute("m:val") || bCh.getAttribute("val");
        if (v)
          beg = String.fromCharCode(
            parseInt(v.replace("0x", ""), 16) || v.charCodeAt(0),
          );
      }
      if (eCh) {
        const v = eCh.getAttribute("m:val") || eCh.getAttribute("val");
        if (v)
          end = String.fromCharCode(
            parseInt(v.replace("0x", ""), 16) || v.charCodeAt(0),
          );
      }
    }
    const elems = _ommlChildren(node, "e");
    const inner = elems.map(_walkOmml).join(", ");
    const delimMap = {
      "(": ")",
      "[": "]",
      "{": "}",
      "|": "|",
      "\u27E8": "\u27E9",
      "\u230A": "\u230B",
      "\u2308": "\u2309",
    };
    const close = delimMap[beg] || end;
    return `${beg}${inner}${close}`;
  }

  // Function
  if (tag === "func") {
    const fName = _ommlEl(node, "fName");
    const e = _ommlEl(node, "e");
    const name = _walkOmml(fName).trim();
    const funcMap = {
      sin: "\\sin",
      cos: "\\cos",
      tan: "\\tan",
      sec: "\\sec",
      csc: "\\csc",
      cot: "\\cot",
      arcsin: "\\arcsin",
      arccos: "\\arccos",
      arctan: "\\arctan",
      sinh: "\\sinh",
      cosh: "\\cosh",
      tanh: "\\tanh",
      log: "\\log",
      ln: "\\ln",
      exp: "\\exp",
      lim: "\\lim",
      max: "\\max",
      min: "\\min",
      det: "\\det",
      gcd: "\\gcd",
      Pr: "\\Pr",
    };
    const cmd = funcMap[name.toLowerCase()] || `\\mathrm{${name}}`;
    return `${cmd}\\left(${_walkOmml(e)}\\right)`;
  }

  // Bar (overline, underline)
  if (tag === "bar") {
    const barPr = _ommlEl(node, "barPr");
    const e = _ommlEl(node, "e");
    let pos = "top";
    if (barPr) {
      const posEl = _ommlEl(barPr, "pos");
      if (posEl)
        pos = posEl.getAttribute("m:val") || posEl.getAttribute("val") || "top";
    }
    if (pos === "bot") return `\\underline{${_walkOmml(e)}}`;
    return `\\overline{${_walkOmml(e)}}`;
  }

  // Accent
  if (tag === "acc") {
    const accPr = _ommlEl(node, "accPr");
    const e = _ommlEl(node, "e");
    let chr = "\u0302"; // default hat
    if (accPr) {
      const chrEl = _ommlEl(accPr, "chr");
      if (chrEl) {
        const v = chrEl.getAttribute("m:val") || chrEl.getAttribute("val");
        if (v)
          chr = String.fromCharCode(
            parseInt(v.replace("0x", ""), 16) || v.charCodeAt(0),
          );
      }
    }
    const accentMap = {
      "\u0302": "\\hat",
      "\u0303": "\\tilde",
      "\u0304": "\\bar",
      "\u0305": "\\overrightarrow",
      "\u0307": "\\dot",
      "\u0308": "\\ddot",
      "\u20D7": "\\vec",
      "\u030C": "\\check",
      "\u0060": "\\grave",
      "\u00B4": "\\acute",
    };
    const cmd = accentMap[chr];
    if (cmd) return `${cmd}{${_walkOmml(e)}}`;
    return `\\accentset{${chr}}{${_walkOmml(e)}}`;
  }

  // Equation array
  if (tag === "eqArr") {
    const elems = _ommlChildren(node, "e");
    const rows = elems.map(_walkOmml);
    return `\\begin{aligned}${rows.join("\\\\")}\\end{aligned}`;
  }

  // Matrix
  if (tag === "m") {
    const rows = _ommlChildren(node, "mr");
    const mRows = rows.map((mr) => {
      const cells = _ommlChildren(mr, "e");
      return cells.map(_walkOmml).join(" & ");
    });
    return `\\begin{matrix}${mRows.join("\\\\")}\\end{matrix}`;
  }

  // Limit below
  if (tag === "limLow") {
    const e = _ommlEl(node, "e");
    const lim = _ommlEl(node, "lim");
    return `\\lim_{${_walkOmml(lim)}}{${_walkOmml(e)}}`;
  }

  // Limit above
  if (tag === "limUpp") {
    const e = _ommlEl(node, "e");
    const lim = _ommlEl(node, "lim");
    return `\\overset{${_walkOmml(lim)}}{${_walkOmml(e)}}`;
  }

  // Group character
  if (tag === "groupChr") {
    const e = _ommlEl(node, "e");
    return _walkOmml(e);
  }

  // Box
  if (
    tag === "box" ||
    tag === "borderBox" ||
    tag === "phantom" ||
    tag === "sPre"
  ) {
    const e = _ommlEl(node, "e");
    return _walkOmml(e);
  }

  // Control properties - skip
  if (
    tag === "ctrlPr" ||
    tag === "rPr" ||
    tag === "dPr" ||
    tag === "fPr" ||
    tag === "radPr" ||
    tag === "naryPr" ||
    tag === "funcPr" ||
    tag === "limLowPr" ||
    tag === "limUppPr" ||
    tag === "accPr" ||
    tag === "barPr" ||
    tag === "groupChrPr"
  ) {
    return "";
  }

  // Default: recurse into children
  return Array.from(node.childNodes).map(_walkOmml).join("");
}

// ═══════════════════════════════════════════
// MathML → LaTeX
// ═══════════════════════════════════════════
function mathmlToLatex(mathml) {
  if (!mathml) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<math xmlns="http://www.w3.org/1998/Math/MathML">${mathml}</math>`,
    "application/xml",
  );
  const root = doc.querySelector("math");
  if (!root) return mathml;
  return _walkMathml(root);
}

function _walkMathml(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return "";

  const tag = node.localName;

  if (tag === "mi") {
    const t = node.textContent.trim();
    const greek = {
      "\u03B1": "\\alpha",
      "\u03B2": "\\beta",
      "\u03B3": "\\gamma",
      "\u03B4": "\\delta",
      "\u03B5": "\\epsilon",
      "\u03B6": "\\zeta",
      "\u03B7": "\\eta",
      "\u03B8": "\\theta",
      "\u03B9": "\\iota",
      "\u03BA": "\\kappa",
      "\u03BB": "\\lambda",
      "\u03BC": "\\mu",
      "\u03BD": "\\nu",
      "\u03BE": "\\xi",
      "\u03C0": "\\pi",
      "\u03C1": "\\rho",
      "\u03C3": "\\sigma",
      "\u03C4": "\\tau",
      "\u03C5": "\\upsilon",
      "\u03C6": "\\phi",
      "\u03C7": "\\chi",
      "\u03C8": "\\psi",
      "\u03C9": "\\omega",
      "\u0393": "\\Gamma",
      "\u0394": "\\Delta",
      "\u0398": "\\Theta",
      "\u039B": "\\Lambda",
      "\u039E": "\\Xi",
      "\u03A0": "\\Pi",
      "\u03A3": "\\Sigma",
      "\u03A6": "\\Phi",
      "\u03A8": "\\Psi",
      "\u03A9": "\\Omega",
      "\u221E": "\\infty",
      "\u2202": "\\partial",
      "\u2207": "\\nabla",
      "\u2205": "\\emptyset",
      "\u2200": "\\forall",
      "\u2203": "\\exists",
      "\u2208": "\\in",
      "\u2209": "\\notin",
    };
    if (greek[t]) return greek[t];
    if (t.length === 1 && node.getAttribute("mathvariant") === "bold")
      return `\\mathbf{${t}}`;
    if (t.length === 1 && node.getAttribute("mathvariant") === "italic")
      return t;
    if (/^[A-Z]$/.test(t) && node.getAttribute("mathvariant") === "normal")
      return `\\mathrm{${t}}`;
    return t;
  }

  if (tag === "mo") {
    const t = node.textContent.trim();
    const ops = {
      "\u00D7": "\\times",
      "\u00B1": "\\pm",
      "\u2213": "\\mp",
      "\u22C5": "\\cdot",
      "\u2264": "\\leq",
      "\u2265": "\\geq",
      "\u2260": "\\neq",
      "\u2248": "\\approx",
      "\u2261": "\\equiv",
      "\u223C": "\\sim",
      "\u221D": "\\propto",
      "\u2192": "\\rightarrow",
      "\u2190": "\\leftarrow",
      "\u2194": "\\leftrightarrow",
      "\u21D2": "\\Rightarrow",
      "\u21D0": "\\Leftarrow",
      "\u222B": "\\int",
      "\u222C": "\\iint",
      "\u222E": "\\oint",
      "\u2211": "\\sum",
      "\u220F": "\\prod",
      "\u2210": "\\coprod",
      "\u2227": "\\wedge",
      "\u2228": "\\vee",
      "\u00AC": "\\neg",
      "\u2229": "\\cap",
      "\u222A": "\\cup",
      "\u2216": "\\setminus",
      "\u2282": "\\subset",
      "\u2283": "\\supset",
      "\u2286": "\\subseteq",
      "\u2287": "\\supseteq",
      "\u2234": "\\therefore",
      "\u2235": "\\because",
      "\u27E8": "\\langle",
      "\u27E9": "\\rangle",
      "\u230A": "\\lfloor",
      "\u230B": "\\rfloor",
      "\u2308": "\\lceil",
      "\u2309": "\\rceil",
      "\u00AF": "\\overline",
      "\u0307": "\\dot",
      "\u0308": "\\ddot",
      "\u20D7": "\\vec",
      "\u005E": "\\hat",
      "\u2026": "\\ldots",
      "\u22EF": "\\cdots",
      "\u22EE": "\\vdots",
      "\u22F1": "\\ddots",
      "\u2223": "\\mid",
      "\u2225": "\\parallel",
    };
    if (ops[t]) return ops[t];
    if (t === "\u00B2") return "^{2}";
    if (t === "\u00B3") return "^{3}";
    if (t === "\u00B9") return "^{1}";
    return t;
  }

  if (tag === "mn") return node.textContent.trim();
  if (tag === "mtext") return `\\text{${node.textContent}}`;
  if (tag === "ms") return `\\text{${node.textContent}}`;

  if (tag === "mfrac") {
    const children = _getMathmlChildren(node);
    const num = children[0] ? _walkMathml(children[0]) : "";
    const den = children[1] ? _walkMathml(children[1]) : "";
    return `\\frac{${num}}{${den}}`;
  }

  if (tag === "msup") {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : "";
    const sup = children[1] ? _walkMathml(children[1]) : "";
    return `${base}^{${sup}}`;
  }

  if (tag === "msub") {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : "";
    const sub = children[1] ? _walkMathml(children[1]) : "";
    return `${base}_{${sub}}`;
  }

  if (tag === "msubsup") {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : "";
    const sub = children[1] ? _walkMathml(children[1]) : "";
    const sup = children[2] ? _walkMathml(children[2]) : "";
    return `${base}_{${sub}}^{${sup}}`;
  }

  if (tag === "munder") {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : "";
    const under = children[1] ? _walkMathml(children[1]) : "";
    return `\\underbrace{${base}}_{${under}}`;
  }

  if (tag === "mover") {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : "";
    const over = children[1] ? _walkMathml(children[1]) : "";
    const overText = over.trim();
    if (overText === "\\overline") return `\\overline{${base}}`;
    if (overText === "\\hat") return `\\hat{${base}}`;
    if (overText === "\\vec") return `\\vec{${base}}`;
    if (overText === "\\dot") return `\\dot{${base}}`;
    if (overText === "\\ddot") return `\\ddot{${base}}`;
    return `\\overbrace{${base}}^{${over}}`;
  }

  if (tag === "munderover") {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : "";
    const under = children[1] ? _walkMathml(children[1]) : "";
    const over = children[2] ? _walkMathml(children[2]) : "";
    return `\\underset{${under}}{\\overset{${over}}{${base}}}`;
  }

  if (tag === "msqrt") {
    const children = _getMathmlChildren(node);
    const inner = children[0] ? _walkMathml(children[0]) : "";
    return `\\sqrt{${inner}}`;
  }

  if (tag === "mroot") {
    const children = _getMathmlChildren(node);
    const inner = children[0] ? _walkMathml(children[0]) : "";
    const deg = children[1] ? _walkMathml(children[1]) : "";
    return `\\sqrt[${deg}]{${inner}}`;
  }

  if (tag === "mtable") {
    const rows = [];
    for (const tr of node.children) {
      if (tr.localName === "mtr") {
        const cells = [];
        for (const td of tr.children) {
          if (td.localName === "mtd") {
            cells.push(_walkMathml(td));
          }
        }
        rows.push(cells.join(" & "));
      }
    }
    return `\\begin{matrix}\n${rows.join(" \\\\\n")}\n\\end{matrix}`;
  }

  if (tag === "menclose") {
    const children = _getMathmlChildren(node);
    const inner = children[0] ? _walkMathml(children[0]) : "";
    const notation = node.getAttribute("notation") || "";
    if (notation.includes("roundedbox")) return `\\boxed{${inner}}`;
    if (notation.includes("actuarial"))
      return `\\overline{${inner}}\\rule{0.5pt}{1em}`;
    return inner;
  }

  if (tag === "mstyle") {
    const children = _getMathmlChildren(node);
    if (children.length === 1) return _walkMathml(children[0]);
    return children.map(_walkMathml).join("");
  }

  if (
    tag === "mpadded" ||
    tag === "mphantom" ||
    tag === "merror" ||
    tag === "maction"
  ) {
    const children = _getMathmlChildren(node);
    if (children.length === 1) return _walkMathml(children[0]);
    return children.map(_walkMathml).join("");
  }

  if (tag === "mlabeledtr") {
    const children = _getMathmlChildren(node);
    return children.map(_walkMathml).join("");
  }

  // mrow, math, etc: recurse into children
  if (node.children) {
    return Array.from(node.children).map(_walkMathml).join("");
  }
  return "";
}

function _getMathmlChildren(node) {
  const result = [];
  for (const child of node.children) {
    if (child.nodeType === 1) result.push(child);
  }
  return result;
}

// ═══════════════════════════════════════════
// UI Controller
// ═══════════════════════════════════════════
class UIController {
  constructor() {
    Logger.info("UIController initializing...");
    this.currentSection = "editor";
    this.editor = new FormulaEditor();
    this.library = new FormulaLibrary();
    this.themeManager = new ThemeManager();
    this.settingsManager = new SettingsManager();
    this.formulaSvgRenderer = new FormulaSvgRenderer();
    this.platformOperations = new Set();
    this._pendingOfficeEditorRequest = null;

    this.initCustomSelects();
    this.initEventListeners();
    this.initLibrary();
    this.applySettings();
    this.themeManager.updateButton();
    this.loadPlatforms();
    this.syncOfficeSettingsToggle();
    this.renderPlatformList();
    this.updateOfficeInsertButton();
    this.updateMdCopyButton();

    this.initHistoryDb();

    Logger.info("UIController ready");
  }

  getFormulaInsertMode() {
    return selectedFormulaInsertMode();
  }

  setFormulaInsertMode(value) {
    const mode = normalizeOfficeInsertMode(value);
    const input = document.querySelector(
      `input[name="formulaInsertMode"][value="${mode}"]`,
    );
    if (input) input.checked = true;
    this.updateFormulaInsertModeUi(mode);
    return mode;
  }

  updateFormulaInsertModeUi(value = this.getFormulaInsertMode()) {
    const mode = normalizeOfficeInsertMode(value);
    const numbering = document.getElementById("numberingOptions");
    if (numbering) numbering.hidden = mode !== FORMULA_INSERT_MODES.NUMBERED;

    const context = document.getElementById("officeRequestContext");
    if (!context) return;
    const request = this._pendingOfficeEditorRequest;
    if (!request) {
      context.hidden = true;
      context.textContent = "";
      return;
    }
    const host = request.sourceHost === "word" ? "Word" : request.sourceHost;
    const modeLabel = {
      inline: "行内公式",
      display: "行间公式",
      numbered: "编号公式",
    }[mode];
    context.textContent = `目标：${host || "Office"} — ${modeLabel}`;
    context.hidden = false;
  }

  clearPendingOfficeEditorRequest() {
    this._pendingOfficeEditorRequest = null;
    this.updateFormulaInsertModeUi();
  }

  officeNumberingOptions(mode) {
    if (normalizeOfficeInsertMode(mode) !== FORMULA_INSERT_MODES.NUMBERED) {
      return null;
    }
    return {
      scheme: "global",
      chapterLevel: null,
      separator: null,
      label: null,
    };
  }

  officeHostKind(hostType) {
    if (hostType === "excel") return "excel";
    if (hostType === "powerpoint") return "powerPoint";
    if (hostType === "visio") return "visio";
    return "word";
  }

  async ensureOfficeEditTransaction(invoke, session, mode, latex) {
    const requestedMode = normalizeOfficeInsertMode(mode);
    const pending = this._pendingOfficeEditorRequest;
    if (pending?.transactionId) {
      const transaction = await invoke("update_office_edit_draft", {
        request: {
          transactionId: pending.transactionId,
          draftLatex: latex,
          requestedMode,
          numbering: this.officeNumberingOptions(requestedMode),
        },
      });
      Object.assign(pending, {
        requestedMode: transaction.requestedMode,
        formulaId: transaction.formulaId,
      });
      return transaction;
    }

    const transaction = await invoke("begin_office_edit_transaction", {
      request: {
        integration: "nativeOffice",
        host: this.officeHostKind(session.host_type),
        sourceSessionId: session.session_id,
        sourceDocumentId: session.document_id || null,
        sourceObjectId: pending?.formulaId || null,
        formulaId: pending?.formulaId || null,
        action: pending?.action === "edit" ? "update" : "insert",
        requestedMode,
        numbering: this.officeNumberingOptions(requestedMode),
        originalRevision: pending?.revision ?? null,
        originalMetadata: null,
        draftLatex: latex,
      },
    });
    this._pendingOfficeEditorRequest = {
      ...(pending || {}),
      sessionId: session.session_id,
      sourceHost: session.host_type,
      action: pending?.action || "insert",
      transactionId: transaction.transactionId,
      requestedMode: transaction.requestedMode,
      formulaId: transaction.formulaId,
      receivedAt: pending?.receivedAt || Date.now(),
    };
    this.updateFormulaInsertModeUi(transaction.requestedMode);
    return transaction;
  }

  async prepareOfficeEditTransaction(invoke, transaction, mode, latex) {
    const prepared = await invoke("prepare_office_edit_commit", {
      request: {
        transactionId: transaction.transactionId,
        draftLatex: latex,
        requestedMode: normalizeOfficeInsertMode(mode),
        numbering: this.officeNumberingOptions(mode),
        renderedAsset: null,
      },
    });
    await invoke("mark_office_edit_committing", {
      transactionId: prepared.transactionId,
    });
    return prepared;
  }

  async completeOfficeEditTransaction(success, errorCode, message) {
    const pending = this._pendingOfficeEditorRequest;
    if (!pending?.transactionId) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("complete_office_edit_transaction", {
        request: {
          transactionId: pending.transactionId,
          success,
          error: success
            ? null
            : {
                errorCode: errorCode || "HOST_COMMIT_FAILED",
                operation: pending.action || "insert",
                host: pending.sourceHost || "office",
                message: message || "Office host commit failed",
              },
        },
      });
    } catch (transactionError) {
      Logger.error("Office transaction completion failed:", transactionError);
    }
  }

  async restoreRecoverableOfficeTransaction() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const transactions = await invoke("list_recoverable_office_transactions");
      const transaction = transactions?.[0];
      if (!transaction) return;
      this._pendingOfficeEditorRequest = {
        transactionId: transaction.transactionId,
        sessionId: transaction.sourceSessionId,
        sourceHost: transaction.host,
        action: transaction.action === "update" ? "edit" : "insert",
        requestedMode: transaction.requestedMode,
        formulaId: transaction.formulaId,
        revision: transaction.originalRevision,
        receivedAt: transaction.updatedAtMs,
      };
      this.setFormulaInsertMode(transaction.requestedMode);
      if (transaction.draftLatex) this.editor.setLatex(transaction.draftLatex);
      Logger.info(
        `[OfficeTransaction] recovered ${transaction.transactionId} state=${transaction.state}`,
      );
      this.showToast("已恢复未完成的 Office 公式编辑");
    } catch (error) {
      Logger.warn("Recoverable Office transaction lookup failed:", error);
    }
  }

  initCustomSelects() {
    document.querySelectorAll(".custom-select").forEach((el) => {
      el._selectInstance = new CustomSelect(el);
    });
  }

  initEventListeners() {
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this.switchSection(e.target.id.replace("Btn", ""));
      });
    });

    const sidebarPanel = document.getElementById("sidebarPanel");
    const sidebarOverlay = document.getElementById("sidebarOverlay");
    const sidebarTrigger = document.getElementById("sidebarTrigger");
    const sidebarClose = document.getElementById("sidebarClose");

    const openSidebar = () => {
      sidebarPanel?.classList.add("open");
      sidebarOverlay?.classList.add("visible");
      sidebarTrigger.style.display = "none";
    };

    const closeSidebar = () => {
      sidebarPanel?.classList.remove("open");
      sidebarOverlay?.classList.remove("visible");
      sidebarTrigger.style.display = "flex";
    };

    sidebarTrigger?.addEventListener("click", openSidebar);
    sidebarClose?.addEventListener("click", closeSidebar);
    sidebarOverlay?.addEventListener("click", closeSidebar);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sidebarPanel?.classList.contains("open")) {
        closeSidebar();
      }
    });

    let isDragging = false;
    let dragStartY = 0;
    let triggerStartY = 0;

    sidebarTrigger?.addEventListener("mousedown", (e) => {
      isDragging = true;
      dragStartY = e.clientY;
      triggerStartY = sidebarTrigger.offsetTop;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const delta = e.clientY - dragStartY;
      const newTop = triggerStartY + delta;
      const minTop = 60;
      const maxTop = window.innerHeight - 110;
      const clampedTop = Math.max(minTop, Math.min(maxTop, newTop));
      sidebarTrigger.style.top = clampedTop + "px";
      sidebarTrigger.style.transform = "none";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
    });

    let openTimeout = null;
    let closeTimeout = null;

    document.addEventListener("mousemove", (e) => {
      if (isDragging) return;
      const threshold = 30;
      const isNearRightEdge = e.clientX >= window.innerWidth - threshold;
      const isInsideSidebar = sidebarPanel?.contains(e.target);
      const isOnTrigger = sidebarTrigger?.contains(e.target);

      if (openTimeout) {
        clearTimeout(openTimeout);
        openTimeout = null;
      }
      if (closeTimeout) {
        clearTimeout(closeTimeout);
        closeTimeout = null;
      }

      if (sidebarPanel?.classList.contains("open")) {
        if (!isInsideSidebar && !isOnTrigger && !isNearRightEdge) {
          closeTimeout = setTimeout(closeSidebar, 500);
        }
      } else {
        if (isNearRightEdge && sidebarTrigger?.style.display !== "none") {
          openTimeout = setTimeout(openSidebar, 300);
        }
      }
    });

    sidebarPanel?.addEventListener("mouseenter", () => {
      if (closeTimeout) {
        clearTimeout(closeTimeout);
        closeTimeout = null;
      }
    });

    sidebarTrigger?.addEventListener("mouseleave", () => {
      if (openTimeout) {
        clearTimeout(openTimeout);
        openTimeout = null;
      }
    });

    document.querySelectorAll(".settings-item").forEach((item) => {
      item.addEventListener("click", () => {
        const pageId = item.dataset.page;
        document.getElementById("settingsList").style.display = "none";
        document.getElementById(pageId)?.classList.add("active");
        Logger.debug(`Settings: open ${pageId}`);
      });
    });

    document.querySelectorAll(".settings-back").forEach((btn) => {
      btn.addEventListener("click", () => {
        const subpage = btn.closest(".settings-subpage");
        subpage.style.animation = "none";
        subpage.offsetHeight;
        subpage.style.animation = "fadeSlideLeft 0.25s ease";
        subpage.classList.remove("active");
        const list = document.getElementById("settingsList");
        list.style.animation = "none";
        list.offsetHeight;
        list.style.animation = "fadeSlideIn 0.25s ease";
        list.style.display = "block";
        Logger.debug("Settings: back to list");
      });
    });

    document
      .getElementById("testBridgeBtn")
      ?.addEventListener("click", async () => {
        const resultEl = document.getElementById("bridgeTestResult");
        if (resultEl) {
          resultEl.textContent = "测试中...";
          resultEl.className = "settings-hint";
        }

        const connected = await this.connectBridge();
        if (resultEl) {
          if (connected) {
            resultEl.textContent = "连接成功";
            resultEl.className = "settings-hint success";
          } else {
            resultEl.textContent = "连接失败";
            resultEl.className = "settings-hint error";
          }
        }
      });

    document.getElementById("themeToggle")?.addEventListener("click", () => {
      this.themeManager.toggle();
    });

    document
      .getElementById("copyLatex")
      ?.addEventListener("click", () => this.copyFormula("latex"));
    document
      .getElementById("copyMathml")
      ?.addEventListener("click", () => this.copyFormula("mathml"));
    document
      .getElementById("copySvg")
      ?.addEventListener("click", () => this.copyFormula("svg"));
    document
      .getElementById("copyMd")
      ?.addEventListener("click", () => this.copyFormula("md"));

    document
      .getElementById("insertToWord")
      ?.addEventListener("click", () => this.insertToWord());
    document
      .getElementById("insertToEcosystem")
      ?.addEventListener("click", () => this.insertToEcosystem());
    document
      .getElementById("loadFromWord")
      ?.addEventListener("click", () => this.loadFromWord());
    document
      .getElementById("insertTableBtn")
      ?.addEventListener("click", () => this.insertTableToWord());
    document
      .getElementById("readTableBtn")
      ?.addEventListener("click", () => this.readTableFromWord());
    this.updateOfficeInsertButton();
    this.updateMdCopyButton();
    this.updateMdCopyButton();

    document.getElementById("quickCopy")?.addEventListener("click", () => {
      const enabledPlatform = this.platforms.find((p) => p.enabled);
      if (enabledPlatform) {
        this.copyFormula(enabledPlatform.format);
        this.showToast(`已复制 ${enabledPlatform.name} 格式`);
      } else {
        this.copyFormula("latex");
      }
    });

    document
      .getElementById("fontStyleSelect")
      ?.addEventListener("change", (e) => {
        this.updateFontStyle(e.detail.value);
      });

    document.getElementById("fontColor")?.addEventListener("input", (e) => {
      this.updateFontColor(e.target.value);
    });

    document.getElementById("colorPreview")?.addEventListener("click", () => {
      document.getElementById("fontColor")?.click();
    });

    document
      .querySelectorAll('input[name="formulaInsertMode"]')
      .forEach((input) => {
        input.addEventListener("change", async (event) => {
          if (!event.target.checked) return;
          const mode = normalizeOfficeInsertMode(event.target.value);
          if (this._pendingOfficeEditorRequest) {
            this._pendingOfficeEditorRequest.requestedMode = mode;
            if (this._pendingOfficeEditorRequest.transactionId) {
              try {
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("update_office_edit_draft", {
                  request: {
                    transactionId:
                      this._pendingOfficeEditorRequest.transactionId,
                    draftLatex: this.editor.getLatex() || "",
                    requestedMode: mode,
                    numbering: this.officeNumberingOptions(mode),
                  },
                });
              } catch (error) {
                Logger.error("Office transaction mode update failed:", error);
              }
            }
          }
          this.updateFormulaInsertModeUi(mode);
          Logger.info(`formulaInsertMode: ${mode}`);
          const latex = this.editor.getLatex();
          if (latex) this.editor.updatePreview(latex);
        });
      });

    document.getElementById("latexSource")?.addEventListener("input", (e) => {
      let latex = e.target.value;

      latex = latex.replace(/^\$\$\s*/m, "").replace(/\s*\$\$\s*$/m, "");
      latex = latex.replace(/^\$\s*/, "").replace(/\s*\$/, "");

      this.editor.setLatex(latex);
      this.editor.updatePreview(latex);
    });

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.copyFormula("latex");
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        const latex = this.editor.getLatex();
        if (latex) {
          navigator.clipboard.writeText(latex).catch(() => {});
          this.switchSection("editor");
          this.showToast("已复制，可粘贴到目标编辑器");
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        const latex = this.editor.getLatex();
        if (latex) {
          ExportHelper.exportToTex(latex);
          this.showToast("已导出 .tex 文件");
        }
      }
    });

    document.getElementById("librarySearch")?.addEventListener("input", (e) => {
      this.searchLibrary(e.target.value);
    });

    document.getElementById("screenshotBtn")?.addEventListener("click", () => {
      this.startScreenshot();
    });
    document.getElementById("ocrInsertBtn")?.addEventListener("click", () => {
      this.insertOcrResult();
    });
    document.getElementById("ocrCopyBtn")?.addEventListener("click", () => {
      this.copyOcrResult();
    });

    document
      .getElementById("clearHistoryBtn")
      ?.addEventListener("click", () => {
        this.clearAllHistory(false);
      });
    document
      .getElementById("clearHistoryBtn2")
      ?.addEventListener("click", () => {
        this.clearAllHistory(false);
      });

    document.querySelectorAll(".history-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".history-filter")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.historyFilter = btn.dataset.filter;
        this.renderHistoryList();
      });
    });

    document
      .getElementById("defaultDisplayModeSelect")
      ?.addEventListener("change", (e) => {
        this.settingsManager.set("displayMode", e.detail.value);
        Logger.info(`Settings: displayMode = ${e.detail.value}`);
      });
    document
      .getElementById("defaultFontStyleSelect")
      ?.addEventListener("change", (e) => {
        this.settingsManager.set("fontStyle", e.detail.value);
        Logger.info(`Settings: fontStyle = ${e.detail.value}`);
      });
    document
      .getElementById("bridgeUrlInput")
      ?.addEventListener("change", (e) => {
        this.settingsManager.set("bridgeUrl", e.target.value);
        Logger.info(`Settings: bridgeUrl = ${e.target.value}`);
      });

    document
      .getElementById("officeEnabledToggle")
      ?.addEventListener("change", async (e) => {
        const enabled = e.target.checked;
        e.target.disabled = true;
        try {
          this.settingsManager.set("officeEnabled", enabled);
          Logger.info(`[Office] Toggle -> ${enabled ? "ON" : "OFF"}`);
          const ok = await this.setPlatformEnabled("office", enabled);
          Logger.info(
            `[Office] setPlatformEnabled('office', ${enabled}) -> ${ok}`,
          );
          if (!ok) {
            Logger.warn("[Office] Platform enable failed, reverting toggle");
            this.settingsManager.set("officeEnabled", !enabled);
            e.target.checked = !enabled;
          }
          this.updateTabVisibility();

          // Invalidate Rust Office status cache so next detect_office() re-detects.
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await this.withTimeout(
              invoke("invalidate_office_cache"),
              5000,
              "Office cache invalidate",
            );
          } catch (error) {
            Logger.warn("[Office] Failed to invalidate cache:", error);
          }

          // Refresh OLE status display after Office toggle completes.
          await this.checkOleStatus();
        } catch (e) {
          Logger.error("[Office] Toggle failed:", e);
          this.showToast("Office 状态切换失败: " + (e?.message || e));
          this.settingsManager.set("officeEnabled", !enabled);
          e.target.checked = !enabled;
        } finally {
          e.target.disabled = false;
        }
        Logger.info(
          `[Office] After toggle: platform=${this.platforms.find((p) => p.id === "office")?.enabled}, setting=${this.settingsManager.get("officeEnabled")}`,
        );
      });

    // Office Integration mode selector (CustomSelect)
    document
      .getElementById("officeIntegrationMode")
      ?.addEventListener("change", (e) => {
        const mode = e.detail?.value || e.target?.value;
        if (mode) {
          this.settingsManager.set("officeIntegrationMode", mode);
          this.updateOfficeIntegrationHint(mode);
          Logger.info(`[Office] Integration mode set to ${mode}`);
        }
      });

    // Restore saved integration mode
    const savedMode =
      this.settingsManager.get("officeIntegrationMode") || "auto";
    const modeSelect = document.getElementById("officeIntegrationMode");
    if (modeSelect) {
      const trigger = modeSelect.querySelector(".custom-select-trigger");
      if (trigger) {
        trigger.dataset.value = savedMode;
        const span = trigger.querySelector("span");
        if (span) {
          const opt = modeSelect.querySelector(
            `.custom-select-option[data-value="${savedMode}"]`,
          );
          span.textContent = opt?.textContent || savedMode;
          span.removeAttribute("data-i18n");
        }
      }
      modeSelect.querySelectorAll(".custom-select-option").forEach((o) => {
        o.classList.toggle("selected", o.dataset.value === savedMode);
      });
      this.updateOfficeIntegrationHint(savedMode);
    }

    // OLE status check — displayed as read-only info, with conditional install/remove buttons
    this.checkOleStatus();

    document
      .getElementById("officeOleInstallBtn")
      ?.addEventListener("click", async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("native_office_install_ole");
          this.showToast("OLE 安装成功");
          this.checkOleStatus();
        } catch (e) {
          this.showToast("OLE 安装失败: " + (e.message || e));
        }
      });
    document
      .getElementById("officeOleUninstallBtn")
      ?.addEventListener("click", async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("native_office_uninstall_ole");
          this.showToast("OLE 已移除");
          this.checkOleStatus();
        } catch (e) {
          this.showToast("OLE 移除失败: " + (e.message || e));
        }
      });
    this.checkOleStatus();

    // Ecosystem client list refresh
    document
      .getElementById("refreshEcosystemBtn")
      ?.addEventListener("click", () => {
        this.refreshEcosystemClients();
      });

    function compareVersions(left, right) {
      const a = left.split(".").map(Number);
      const b = right.split(".").map(Number);
      const length = Math.max(a.length, b.length);
      for (let i = 0; i < length; i += 1) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff !== 0) return Math.sign(diff);
      }
      return 0;
    }

    // Simple Markdown → HTML renderer (covers GitHub release notes)
    function renderMarkdown(md) {
      return (
        md
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          // headers
          .replace(
            /^### (.+)$/gm,
            '<h4 style="margin:0.5rem 0 0.25rem;font-size:0.85rem;color:var(--text);">$1</h4>',
          )
          .replace(
            /^## (.+)$/gm,
            '<h3 style="margin:0.6rem 0 0.3rem;font-size:0.9rem;color:var(--text);">$1</h3>',
          )
          .replace(
            /^# (.+)$/gm,
            '<h2 style="margin:0.7rem 0 0.35rem;font-size:1rem;color:var(--text);">$1</h2>',
          )
          // code fence
          .replace(
            /```(\w*)\n([\s\S]*?)```/g,
            '<pre style="background:var(--card-bg);border:1px solid var(--border-color);border-radius:4px;padding:0.5rem;overflow-x:auto;font-size:0.7rem;margin:0.35rem 0;"><code>$2</code></pre>',
          )
          // inline code
          .replace(
            /`([^`]+)`/g,
            '<code style="background:var(--card-bg);border:1px solid var(--border-color);border-radius:3px;padding:1px 4px;font-size:0.7rem;">$1</code>',
          )
          // bold
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
          // italic
          .replace(/\*([^*]+)\*/g, "<em>$1</em>")
          // links
          .replace(
            /\[([^\]]+)]\(([^)]+)\)/g,
            '<a href="$2" target="_blank">$1</a>',
          )
          // unordered list
          .replace(
            /^[\s]*[-*] (.+)$/gm,
            '<li style="margin-left:1rem;">$1</li>',
          )
          // ordered list
          .replace(
            /^[\s]*\d+\. (.+)$/gm,
            '<li style="margin-left:1rem;">$1</li>',
          )
          // paragraph breaks - wrap consecutive text lines
          .replace(/\n\n/g, '</p><p style="margin:0.35rem 0;">')
          .replace(/\n/g, "<br>")
      );
    }

    // Update check with Markdown release notes
    document
      .getElementById("checkUpdateBtn")
      ?.addEventListener("click", async () => {
        const statusEl = document.getElementById("updateStatus");
        const notesEl = document.getElementById("releaseNotes");
        const btn = document.getElementById("checkUpdateBtn");
        if (!statusEl || !btn) return;
        btn.disabled = true;
        statusEl.textContent = "检查中...";
        statusEl.className = "settings-hint";
        if (notesEl) {
          notesEl.style.display = "none";
          notesEl.innerHTML = "";
        }
        try {
          const resp = await fetch(
            "https://api.github.com/repos/strangelion/LaTeXSnipper-Office/releases/latest",
            {
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          const { getVersion } = await import("@tauri-apps/api/app");
          const current = await getVersion();
          const latest = (data.tag_name || "").replace(/^v/, "");
          if (latest && compareVersions(latest, current) > 0) {
            statusEl.innerHTML = `发现新版本 <a href="${data.html_url}" target="_blank">v${latest}</a>`;
            statusEl.className = "settings-hint";
            if (notesEl && data.body) {
              notesEl.innerHTML =
                '<p style="margin:0 0 0.35rem;font-weight:600;">更新内容</p><p style="margin:0.35rem 0;">' +
                renderMarkdown(data.body) +
                "</p>";
              notesEl.style.display = "block";
            }
          } else {
            statusEl.textContent = "已是最新版本";
            statusEl.className = "settings-hint success";
          }
        } catch (e) {
          statusEl.textContent = "检查失败: " + (e.message || e);
          statusEl.className = "settings-hint error";
        } finally {
          btn.disabled = false;
        }
      });

    document
      .getElementById("ocrEnabledToggle")
      ?.addEventListener("change", (e) => {
        this.settingsManager.set("ocrEnabled", e.target.checked);
        this.updateTabVisibility();
        Logger.info(`Settings: ocrEnabled = ${e.target.checked}`);
      });

    Logger.debug("Event listeners ready");

    this.initNativeOffice();
  }

  initNativeOffice() {
    window.__app = this;

    // Host selector state
    this._selectedSessionId = null;
    this._selectedHostType = "";
    this._selectedEcosystemTarget = "";
    this._sessions = [];

    // Update host selector dropdown
    this.updateOfficeHostSelector = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const sessions = await invoke("native_office_sessions");
        this._sessions = sessions || [];

        const selector = document.getElementById("officeTargetHost");
        const selectorContainer = document.getElementById("officeHostSelector");
        if (!selector || !selectorContainer) return;

        if (this._sessions.length === 0) {
          selector.innerHTML = "";
          selectorContainer.style.display = "none";
          this._selectedSessionId = null;
          this._selectedHostType = "";
          this.updateOfficeInsertButton();
          return;
        }

        selectorContainer.style.display = "inline-block";
        selector.innerHTML = "";

        for (const session of this._sessions) {
          const opt = document.createElement("div");
          opt.className = "custom-select-option";
          opt.dataset.value = session.session_id;
          opt.dataset.hostType = session.host_type || "";
          opt.textContent = `${session.host_type} - ${session.document_title || "未命名"}`;
          opt.addEventListener("click", (e) => {
            e.stopPropagation();
            const trigger = selectorContainer.querySelector(
              ".custom-select-trigger",
            );
            trigger.querySelector("span").textContent = opt.textContent;
            trigger.dataset.value = opt.dataset.value;
            this._selectedSessionId = opt.dataset.value;
            this._selectedHostType = opt.dataset.hostType;
            selectorContainer
              .querySelectorAll(".custom-select-option")
              .forEach((o) => o.classList.remove("selected"));
            opt.classList.add("selected");
            selectorContainer.classList.remove("open");
            // Update button visibility based on selected host capabilities
            this.updateOfficeInsertButton();
            Logger.info(
              `Office target: ${this._selectedSessionId || "none"} type=${this._selectedHostType}`,
            );
          });
          selector.appendChild(opt);
        }

        // Auto-select: keep previous selection if still valid, else pick first
        const trigger = selectorContainer.querySelector(
          ".custom-select-trigger",
        );
        let selectedOption = null;
        if (this._selectedSessionId) {
          selectedOption = selector.querySelector(
            `[data-value="${this._selectedSessionId}"]`,
          );
        }
        if (!selectedOption) {
          selectedOption = selector.querySelector(".custom-select-option");
        }
        if (selectedOption) {
          trigger.querySelector("span").textContent =
            selectedOption.textContent;
          trigger.dataset.value = selectedOption.dataset.value;
          selectedOption.classList.add("selected");
          this._selectedSessionId = selectedOption.dataset.value;
          this._selectedHostType = selectedOption.dataset.hostType || "";
        }

        // Refresh button visibility based on updated session/host selection
        this.updateOfficeInsertButton();

        // Toggle dropdown
        trigger.onclick = (e) => {
          e.stopPropagation();
          document
            .querySelectorAll(".custom-select.open")
            .forEach((s) => s.classList.remove("open"));
          selectorContainer.classList.toggle("open");
        };
      } catch (e) {
        Logger.error("Failed to update host selector:", e);
      }
    };

    // Ecosystem target selector (VS Code / Obsidian / Browser / WPS)
    this._selectedEcosystemTarget = "";
    this._selectedEcosystemClientId = "";

    this.updateEcosystemHostSelector = () => {
      const selector = document.getElementById("ecosystemTargetHost");
      const container = document.getElementById("ecosystemHostSelector");
      const trigger = container?.querySelector(".custom-select-trigger");

      if (!selector || !container || !trigger) return;

      selector.onclick = (event) => {
        const option = event.target.closest(".custom-select-option");
        if (!option) return;

        event.stopPropagation();

        trigger.querySelector("span").textContent = option.textContent;
        trigger.dataset.value = option.dataset.value || "";
        trigger.dataset.clientId = option.dataset.clientId || "";

        this._selectedEcosystemTarget = trigger.dataset.value;
        this._selectedEcosystemClientId = trigger.dataset.clientId;

        selector
          .querySelectorAll(".custom-select-option")
          .forEach((item) =>
            item.classList.toggle("selected", item === option),
          );

        container.classList.remove("open");
      };

      trigger.onclick = (event) => {
        event.stopPropagation();
        // Refresh clients when opening dropdown
        if (!container.classList.contains("open")) {
          this.refreshEcosystemTargetSelector().catch((e) =>
            Logger.warn("Ecosystem selector refresh failed:", e),
          );
        }
        container.classList.toggle("open");
      };
    };

    // Initial ecosystem host selector setup
    this.updateEcosystemHostSelector();
    // Immediately fetch online clients and populate selector
    this.refreshEcosystemTargetSelector().catch((e) =>
      Logger.warn("Ecosystem selector refresh failed:", e),
    );
    // Periodically refresh ecosystem target selector
    setInterval(() => {
      this.refreshEcosystemTargetSelector().catch((e) =>
        Logger.warn("Ecosystem selector refresh failed:", e),
      );
    }, 10000);

    // Close dropdown on outside click
    document.addEventListener("click", () => {
      document
        .querySelectorAll(".custom-select.open")
        .forEach((s) => s.classList.remove("open"));
    });

    // Listen for session changes
    this.initNativeOfficeEvents();
    void this.restoreRecoverableOfficeTransaction();

    // Initial selector update
    this.updateOfficeHostSelector();

    // Insert formula via Native Office Pipe
    window.insertFormula = async () => {
      const latex = this.editor?.getLatex();
      if (!latex) return;
      let officeTransaction = null;
      try {
        const { invoke } = await import("@tauri-apps/api/core");

        // Get selected session from dropdown
        const sessionId = this._selectedSessionId;
        if (!sessionId) {
          this.showToast("请先选择目标 Office 宿主");
          return;
        }

        const session = this._sessions.find((s) => s.session_id === sessionId);
        if (!session) {
          this.showToast("所选会话不存在");
          return;
        }

        // Get OMML from Rust
        console.log(`[Insert] Converting LaTeX: "${latex}"`);
        const omml = await invoke("latex_to_omml", { latex });
        console.log(`[Insert] OMML length: ${omml?.length || 0}`);

        const isWord = session.host_type === "word";
        let integrationMode =
          this.settingsManager.get("officeIntegrationMode") || "auto";
        // For Excel/PPT auto mode: if OLE is not available, skip OLE and use image directly.
        if (!isWord && integrationMode === "auto") {
          if (this._oleStatus?.available !== true) {
            integrationMode = "image";
            Logger.info(
              "[Insert] OLE not available, auto → image for Excel/PPT",
            );
          }
        }
        const shouldRenderPreview =
          !isWord || integrationMode === "ole" || integrationMode === "image";

        const mode = normalizeOfficeInsertMode(
          this._pendingOfficeEditorRequest?.requestedMode ??
            this.getFormulaInsertMode(),
        );
        if (mode === FORMULA_INSERT_MODES.NUMBERED && !isWord) {
          this.showToast(
            "UNSUPPORTED_MODE：当前 Office 宿主不支持编号公式，请选择行内或行间模式。",
          );
          return;
        }
        const isDisplayFormula = officeInsertModeIsDisplay(mode);
        officeTransaction = await this.ensureOfficeEditTransaction(
          invoke,
          session,
          mode,
          latex,
        );

        // Render SVG for OLE/image previews. Word native mode uses OMML directly.
        let svg = null;
        let widthPt = 0;
        let heightPt = 0;
        if (shouldRenderPreview) {
          try {
            const rendered = await this._renderLatexSvg(
              latex,
              isDisplayFormula,
            );
            svg = rendered.svg;
            widthPt = rendered.widthPt;
            heightPt = rendered.heightPt;
          } catch (e) {
            Logger.error("SVG render error:", e);
            this.showToast("公式 SVG 渲染失败，可能存在不支持的 LaTeX 宏");
            return;
          }
        }

        let pngBase64 = null;
        if (shouldRenderPreview && svg) {
          try {
            pngBase64 = await this._svgToPngBase64(svg, widthPt, heightPt);
          } catch (e) {
            Logger.warn("SVG to PNG conversion failed:", e);
            if (integrationMode === "image") {
              this.showToast("兼容图片生成失败，请尝试 SVG/OLE/OMML 模式");
              return;
            }
          }
        }

        console.log(
          `[Insert] Sending to session ${sessionId} (${session.host_type}) mode=${mode}`,
        );
        const formulaId = officeTransaction.formulaId;
        if (this._pendingOfficeEditorRequest) {
          this._pendingOfficeEditorRequest.requestedMode = mode;
          this._pendingOfficeEditorRequest.formulaId = formulaId;
        }
        await this.prepareOfficeEditTransaction(
          invoke,
          officeTransaction,
          mode,
          latex,
        );
        if (this._pendingOfficeEditorRequest?.action === "edit") {
          await invoke("native_office_replace_formula", {
            sessionId: sessionId,
            formulaId: formulaId,
            latex: latex,
            omml: omml,
            display: mode,
            svg: shouldRenderPreview ? svg : null,
            png: pngBase64,
            widthPt: widthPt,
            heightPt: heightPt,
            storageMode: integrationMode,
            expectedRevision: this._pendingOfficeEditorRequest.revision ?? null,
          });
        } else {
          await invoke("native_office_insert_formula", {
            sessionId: sessionId,
            formulaId: formulaId,
            latex: latex,
            omml: omml,
            display: isDisplayFormula ? "block" : "inline",
            mode: mode,
            svg: shouldRenderPreview ? svg : null,
            png: pngBase64,
            widthPt: widthPt,
            heightPt: heightPt,
            integrationMode: integrationMode,
          });
        }
        this.showToast("正在发送到 Office，等待确认...");
        this.addHistoryItem(latex);
      } catch (e) {
        if (officeTransaction) {
          await this.completeOfficeEditTransaction(
            false,
            "DESKTOP_DISPATCH_FAILED",
            e?.message || String(e),
          );
        }
        this.showToast("发送失败: " + e.message);
      }
    };

    window.loadSelection = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const sessionId = this._selectedSessionId;
        if (!sessionId) {
          this.showToast("请先选择目标 Office 宿主");
          return;
        }
        this.showToast("正在读取选区...");
        await invoke("native_office_request_read_selection", { sessionId });
      } catch (e) {
        this.showToast("读取失败: " + e.message);
      }
    };

    window.deleteSelection = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const sessionId = this._selectedSessionId;
        if (!sessionId) {
          this.showToast("请先选择目标 Office 宿主");
          return;
        }
        await invoke("native_office_delete_current", {
          sessionId: sessionId,
          formulaId: null,
        });
        this.showToast("已删除");
      } catch (e) {
        this.showToast("删除失败: " + e.message);
      }
    };
  }

  async initNativeOfficeEvents() {
    try {
      const { listen } = await import("@tauri-apps/api/event");

      // Office.js Bridge rendering uses the same MathJax pipeline as Native Office.
      // The Bridge owns the bounded request timeout; this listener only returns
      // rendered content and dimensions and never accesses arbitrary files.
      listen("office-render-asset", async (event) => {
        const request = event.payload || {};
        const response = { id: request.id, success: false };
        try {
          const rendered = await this._renderLatexSvg(
            String(request.latex || ""),
            Boolean(request.display),
          );
          response.widthPt = rendered.widthPt;
          response.heightPt = rendered.heightPt;
          if (request.format === "svg") {
            response.content = rendered.svg;
          } else if (request.format === "png") {
            response.content = await this._svgToPngBase64(
              rendered.svg,
              rendered.widthPt,
              rendered.heightPt,
            );
          } else {
            throw new Error("Unsupported Office.js render format");
          }
          response.success = true;
        } catch (error) {
          response.diagnostic = error?.message || String(error);
        }
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("submit_office_render_asset_result", {
            result: response,
          });
        } catch (error) {
          Logger.warn("Office render result internal callback failed:", error);
        }
      });

      // Office loaded formula from selection
      listen("native-office-latex-loaded", async (event) => {
        const { latex, sessionId } = event.payload;
        Logger.info(`Native Office: loaded latex from ${sessionId}: ${latex}`);
        if (latex) {
          this.switchSection("editor");
          this.editor.setLatex(latex);
          this.showToast("已加载选中的公式");
        }
      });

      // Office loaded table
      listen("native-office-table-loaded", async (event) => {
        const { table, xml, sessionId } = event.payload;
        Logger.info(`Native Office: loaded table from ${sessionId}`);

        if (table) {
          // Structured TablePayload - handle nested structure
          // Rust sends: { tableId, table: { rows: [...] }, formulas: {...} }
          const tableData = table.table || table;
          const rows = tableData.rows || [];
          const formulas = table.formulas || {};

          // Build LaTeX tabular
          const cols = rows[0]?.cells?.length || 2;
          const colSpec = "c".repeat(cols);
          let latex = `\\begin{tabular}{|${colSpec}|}\n\\hline\n`;
          for (const row of rows) {
            const cells = row.cells || [];
            const cellTexts = cells.map((cell) => {
              const inlines = cell.inlines || [];
              return inlines
                .map((inline) => {
                  if (inline.type === "formula") {
                    const formula =
                      inline.formula || formulas[inline.formulaRef];
                    return formula?.latex || "";
                  }
                  return inline.text || "";
                })
                .join(" ");
            });
            latex += cellTexts.join(" & ") + " \\\\\n\\hline\n";
          }
          latex += "\\end{tabular}";
          this.switchSection("editor");
          this.editor.setLatex(latex);
          this.showToast("已加载表格");
        } else if (xml) {
          // Fallback: raw XML
          this.showToast("已加载表格 (原始格式)");
        }
      });

      // Office insert result
      listen("native-office-insert-result", async (event) => {
        const {
          success,
          formulaId,
          error,
          errorCode,
          sessionId,
          requestedStorageMode,
          actualStorageMode,
          fallbackReason,
        } = event.payload;
        if (success) {
          Logger.info(
            `Native Office: formula inserted (id=${formulaId}, requested=${requestedStorageMode}, actual=${actualStorageMode}, fallback=${fallbackReason || "none"})`,
          );
          await this.completeOfficeEditTransaction(true, null, null);
          this.showToast(
            fallbackReason
              ? `公式已通过兼容图像插入：${fallbackReason}`
              : "公式插入成功",
          );
          const pending = this._pendingOfficeEditorRequest;
          if (
            pending &&
            pending.sessionId === sessionId &&
            (!pending.formulaId || pending.formulaId === formulaId)
          ) {
            this.clearPendingOfficeEditorRequest();
          }
        } else {
          Logger.error(
            `Native Office: insert failed code=${errorCode || "UNKNOWN"} session=${sessionId} detail=${error || "none"}`,
          );
          await this.completeOfficeEditTransaction(
            false,
            errorCode || "HOST_COMMIT_FAILED",
            error || "Office host commit failed",
          );
          const messages = {
            OLE_NOT_REGISTERED:
              "OLE 组件未注册，请在设置中修复 Native Office 安装。",
            OLE_BITNESS_MISMATCH: "OLE 组件位数与当前 Office 不匹配。",
            OLE_ACTIVATION_TIMEOUT:
              "OLE 对象激活超时，请关闭占用的 Office 对话框后重试。",
            OLE_AUTOMATION_UNAVAILABLE: "Office 未能提供 OLE 自动化对象。",
            OLE_INITIALIZE_FAILED: "OLE 公式初始化失败。",
            OLE_VECTOR_PREVIEW_FAILED: "SVG 矢量预览生成失败。",
            OLE_RASTER_FALLBACK_FAILED: "兼容 PNG 预览生成失败。",
            OLE_ROUNDTRIP_FAILED: "OLE 公式写入后的完整性校验失败。",
            OLE_STORAGE_INVALID: "文档中的 OLE 公式存储已损坏。",
            OLE_COM_CALL_REJECTED: "Office 暂时拒绝了 COM 调用，请稍后重试。",
          };
          const friendlyMsg = messages[errorCode] || "插入失败";
          const status = document.getElementById("officeOleStatus");
          if (status) {
            status.dataset.lastErrorCode = errorCode || "UNKNOWN";
            status.title = error || "";
          }
          this.showToast(`${friendlyMsg}${error ? ` 详情：${error}` : ""}`);
        }
      });

      listen("native-office-replace-result", async (event) => {
        const { success, error, sessionId } = event.payload;
        const pending = this._pendingOfficeEditorRequest;
        if (
          !pending ||
          pending.sessionId !== sessionId ||
          pending.action !== "edit"
        ) {
          Logger.warn(
            `Ignoring unmatched Native Office replacement ACK for session=${sessionId}`,
          );
          return;
        }
        if (success) {
          await this.completeOfficeEditTransaction(true, null, null);
          this.showToast("公式已更新");
          this.clearPendingOfficeEditorRequest();
          return;
        }
        await this.completeOfficeEditTransaction(
          false,
          "HOST_REPLACE_FAILED",
          error || "Office host replacement failed",
        );
        this.showToast(`公式更新失败：${error || "宿主提交未完成"}`);
      });

      // Office error
      listen("native-office-error", async (event) => {
        const { error, errorCode, sessionId } = event.payload;
        Logger.error(`Native Office error [${errorCode}]: ${error}`);
        this.showToast("Office 错误: " + error);
      });

      // Open editor requested from Office
      listen("native-office-open-editor", async (event) => {
        const {
          sessionId,
          action,
          display,
          omml,
          latex: sourceLatex,
          sourceHost,
          transaction,
        } = event.payload;
        Logger.info(
          `Native Office: open editor requested from ${sessionId} action=${action}`,
        );
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();

        if (action === "delete") {
          // Delete requested directly from Ribbon — call delete
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("native_office_delete_current", {
              sessionId: sessionId,
              formulaId: null,
            });
            Logger.info("Native Office: deleted formula via Ribbon action");
          } catch (e) {
            Logger.error("Native Office: delete failed:", e);
          }
          return;
        }

        // Update session selection to match the source host
        this._selectedSessionId = sessionId;
        if (sourceHost) this._selectedHostType = sourceHost;
        await this.updateOfficeHostSelector();

        // Switch to editor section regardless of current page
        this.switchSection("editor");

        // Show and focus the window
        await win.show();
        await win.setFocus();

        // If action=edit and omml is provided, load formula into editor
        if (action === "edit" && (sourceLatex || omml)) {
          try {
            // ommlToLatex is a module-level function in this file
            const latex =
              sourceLatex ||
              (typeof ommlToLatex === "function" ? ommlToLatex(omml) : omml);
            this.editor.setLatex(latex);
          } catch (e) {
            Logger.error("Failed to load OMML into editor:", e);
          }
        }

        // The Rust transaction is authoritative; this object is only a UI mirror.
        if (matchesOfficeEditAction(action) && transaction) {
          const requestedMode = normalizeOfficeInsertMode(
            transaction.requestedMode || display,
          );
          this._pendingOfficeEditorRequest = {
            sessionId,
            sourceHost: String(sourceHost || "").toLowerCase(),
            action,
            requestedMode,
            receivedAt: transaction.updatedAtMs || Date.now(),
            formulaId: transaction.formulaId,
            revision: transaction.originalRevision,
            transactionId: transaction.transactionId,
          };
          this.setFormulaInsertMode(requestedMode);
        }
      });

      // OLE edit session — frontend must respond with ole-edit-result-{token}
      listen("ole-edit-open", async (event) => {
        const { formula_id, latex, session_token, payload_json } =
          event.payload;
        Logger.info(
          `OLE edit open: formulaId=${formula_id} session=${session_token}`,
        );

        // P0-5: Use a Map to support concurrent OLE edit sessions.
        // Each session is keyed by its unique pipe-derived UUID (session_token).
        if (this._oleSessionToken && this._oleSessionToken !== session_token) {
          Logger.error(
            `[OLE] Unexpected concurrent session: active=${this._oleSessionToken} incoming=${session_token}`,
          );
          return;
        }
        this._oleSessions ??= new Map();

        // Store session data — new sessions do NOT overwrite existing ones
        this._oleSessions.set(session_token, {
          formulaId: formula_id,
          payloadJson: payload_json,
          revision: event.payload.revision ?? payload_json?.revision ?? 0,
        });

        // Load the formula into the editor
        this.switchSection("editor");

        // If full payload is available, use omml for richer editing
        if (payload_json?.omml) {
          this.editor.setLatex(latex || "");
        } else {
          this.editor.setLatex(latex || "");
        }

        // Mark current OLE session for save-with-response
        this._oleSessionToken = session_token;
        this._oleFormulaId = formula_id;

        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        await win.show();
        await win.setFocus();
      });

      // OLE session ended — Rust guard dropped (save/cancel/timeout/error)
      listen("ole-edit-session-ended", async (event) => {
        const sessionToken = event.payload?.sessionToken;
        if (sessionToken && this._oleSessionToken === sessionToken) {
          this._oleSessions?.delete(sessionToken);
          this._oleSessionToken = null;
          this._oleFormulaId = null;
          Logger.info(
            `[OLE] Session ended and frontend state cleared: ${sessionToken}`,
          );
        }
      });

      // Focus on OCR tab (from VSTO Ribbon)
      listen("native-office-focus-ocr", async () => {
        Logger.info("Native Office: focus OCR requested");
        this.switchSection("ocr");
        this.showToast(
          "OCR 识别需要启用本地识别功能（recognition feature），当前构建未包含",
        );
      });

      // Focus on Settings tab (from VSTO Ribbon)
      listen("native-office-focus-settings", async () => {
        Logger.info("Native Office: focus settings requested");
        this.switchSection("settings");
      });

      // Session added/updated/removed - refresh selector
      listen("native-office-session-added", async () => {
        await this.updateOfficeHostSelector();
      });
      listen("native-office-session-updated", async () => {
        await this.updateOfficeHostSelector();
      });
      listen("native-office-session-removed", async () => {
        await this.updateOfficeHostSelector();
      });

      // Context changed
      listen("native-office-context-changed", async (event) => {
        const { sessionId, documentTitle } = event.payload;
        Logger.info(
          `Native Office: context changed for ${sessionId}: ${documentTitle}`,
        );
        // Update session title in local list immediately
        const session = this._sessions?.find((s) => s.session_id === sessionId);
        if (session && documentTitle) {
          session.document_title = documentTitle;
        }
        await this.updateOfficeHostSelector();
      });

      Logger.info("Native Office events initialized");
    } catch (e) {
      Logger.error("Failed to init Native Office events:", e);
    }
  }

  latexToMathML(latex) {
    const result = this._parseLatex(latex, 0);
    return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow>${result.xml}</mrow></math>`;
  }

  _parseLatex(tex, pos) {
    let xml = "";
    while (pos < tex.length) {
      const ch = tex[pos];
      if (ch === "}" || ch === "]") {
        pos++;
        break;
      }
      if (ch === "{") {
        pos++;
        const inner = this._parseLatex(tex, pos);
        xml += inner.xml;
        pos = inner.pos;
      } else if (ch === "\\") {
        pos++;
        const cmd = this._readCommand(tex, pos);
        pos = cmd.pos;
        const name = cmd.name;

        const greekMap = {
          alpha: "\u03B1",
          beta: "\u03B2",
          gamma: "\u03B3",
          delta: "\u03B4",
          epsilon: "\u03B5",
          zeta: "\u03B6",
          eta: "\u03B7",
          theta: "\u03B8",
          iota: "\u03B9",
          kappa: "\u03BA",
          lambda: "\u03BB",
          mu: "\u03BC",
          nu: "\u03BD",
          xi: "\u03BE",
          pi: "\u03C0",
          rho: "\u03C1",
          sigma: "\u03C3",
          tau: "\u03C4",
          upsilon: "\u03C5",
          phi: "\u03C6",
          chi: "\u03C7",
          psi: "\u03C8",
          omega: "\u03C9",
          Gamma: "\u0393",
          Delta: "\u0394",
          Theta: "\u0398",
          Lambda: "\u039B",
          Xi: "\u039E",
          Pi: "\u03A0",
          Sigma: "\u03A3",
          Phi: "\u03A6",
          Psi: "\u03A8",
          Omega: "\u03A9",
          infty: "\u221E",
          partial: "\u2202",
          nabla: "\u2207",
          emptyset: "\u2205",
          forall: "\u2200",
          exists: "\u2203",
          neg: "\u00AC",
          int: "\u222B",
          iint: "\u222C",
          oint: "\u222E",
          sum: "\u2211",
          prod: "\u220F",
          times: "\u00D7",
          cdot: "\u22C5",
          pm: "\u00B1",
          mp: "\u2213",
          leq: "\u2264",
          geq: "\u2265",
          neq: "\u2260",
          approx: "\u2248",
          equiv: "\u2261",
          sim: "\u223C",
          propto: "\u221D",
          rightarrow: "\u2192",
          leftarrow: "\u2190",
          leftrightarrow: "\u2194",
          subset: "\u2282",
          supset: "\u2283",
          subseteq: "\u2286",
          supseteq: "\u2287",
          in: "\u2208",
          notin: "\u2209",
          cap: "\u2229",
          cup: "\u222A",
          langle: "\u27E8",
          rangle: "\u27E9",
          lfloor: "\u230A",
          rfloor: "\u230B",
          lceil: "\u2308",
          rceil: "\u2309",
        };

        if (greekMap[name]) {
          xml += `<mi>${greekMap[name]}</mi>`;
        } else if (name === "bm" || name === "mathbf") {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mstyle font-weight="bold"><mrow>${body.xml}</mrow></mstyle>`;
        } else if (name === "mathit") {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mstyle font-style="italic"><mrow>${body.xml}</mrow></mstyle>`;
        } else if (name === "text") {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mtext>${body.xml}</mtext>`;
        } else if (name === "textcolor") {
          const color = this._readBrace(tex, pos);
          pos = color.pos;
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mstyle mathcolor="${color.xml}"><mrow>${body.xml}</mrow></mstyle>`;
        } else if (name === "colorbox") {
          const color = this._readBrace(tex, pos);
          pos = color.pos;
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<menclose notation="roundbox"><mstyle mathbackground="${color.xml}"><mrow>${body.xml}</mrow></mstyle></menclose>`;
        } else if (name === "color") {
          const color = this._readBrace(tex, pos);
          pos = color.pos;
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mstyle mathcolor="${color.xml}"><mrow>${body.xml}</mrow></mstyle>`;
        } else if (name === "frac") {
          const num = this._parseGroup(tex, pos);
          pos = num.pos;
          const den = this._parseGroup(tex, pos);
          pos = den.pos;
          xml += `<mfrac><mrow>${num.xml}</mrow><mrow>${den.xml}</mrow></mfrac>`;
        } else if (name === "sqrt") {
          if (tex[pos] === "[") {
            pos++;
            const deg = this._readBrace(tex, pos);
            pos = deg.pos;
            const body = this._parseGroup(tex, pos);
            pos = body.pos;
            xml += `<mroot><mrow>${body.xml}</mrow><mrow>${deg.xml}</mrow></mroot>`;
          } else {
            const body = this._parseGroup(tex, pos);
            pos = body.pos;
            xml += `<msqrt><mrow>${body.xml}</mrow></msqrt>`;
          }
        } else if (name === "overline") {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u00AF</mo></mover>`;
        } else if (name === "underline") {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<munder><mrow>${body.xml}</mrow><mo>\u0332</mo></munder>`;
        } else if (name === "hat" || name === "widehat") {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u005E</mo></mover>`;
        } else if (name === "vec") {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u20D7</mo></mover>`;
        } else if (name === "dot" || name === "ddot") {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u0307</mo></mover>`;
        } else if (name === "quad" || name === "qquad") {
          xml += '<mspace width="1em"/>';
        } else if (
          name === "mathrm" ||
          name === "mathsf" ||
          name === "mathtt" ||
          name === "mathcal" ||
          name === "mathbb" ||
          name === "mathfrak"
        ) {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          const variant =
            {
              mathrm: "normal",
              mathbf: "bold",
              mathit: "italic",
              mathsf: "sans-serif",
              mathtt: "monospace",
              mathcal: "script",
              mathbb: "double-struck",
              mathfrak: "fraktur",
            }[name] || "normal";
          xml += `<mstyle mathvariant="${variant}"><mrow>${body.xml}</mrow></mstyle>`;
        } else if (name === "begin") {
          const env = this._readBrace(tex, pos);
          pos = env.pos;
          if (
            env.xml === "matrix" ||
            env.xml === "pmatrix" ||
            env.xml === "bmatrix" ||
            env.xml === "vmatrix" ||
            env.xml === "cases"
          ) {
            const delim = {
              pmatrix: ["(", ")"],
              bmatrix: ["[", "]"],
              vmatrix: ["|", "|"],
              cases: ["{", ""],
            }[env.xml] || ["", ""];
            const rows = [];
            let row = [];
            while (pos < tex.length) {
              if (tex[pos] === "\\" && tex.substr(pos + 1, 3) === "end") {
                pos += 4;
                if (tex[pos] === "{") {
                  while (pos < tex.length && tex[pos] !== "}") pos++;
                  pos++;
                }
                break;
              }
              if (tex[pos] === "&") {
                row.push("");
                pos++;
              } else if (tex[pos] === "\\" && tex[pos + 1] === "\\") {
                rows.push(row.join("<mo>&#x2062;</mo>"));
                row = [];
                pos += 2;
              } else {
                row.push(tex[pos]);
                pos++;
              }
            }
            if (row.length > 0) rows.push(row.join("<mo>&#x2062;</mo>"));
            xml += `<mrow>${delim[0]}<mtable>${rows.map((r) => `<mtr><mtd>${r}</mtd></mtr>`).join("")}</mtable>${delim[1]}</mrow>`;
          } else {
            xml += `\\begin{${env.xml}}`;
          }
        } else if (name === "end") {
          if (tex[pos] === "{") {
            while (pos < tex.length && tex[pos] !== "}") pos++;
            pos++;
          }
        } else {
          xml += `<mi>${name}</mi>`;
        }
      } else if (ch === "^") {
        pos++;
        const sup = this._parseGroup(tex, pos);
        pos = sup.pos;
        xml = `<msup><mrow>${xml}</mrow><mrow>${sup.xml}</mrow></msup>`;
      } else if (ch === "_") {
        pos++;
        const sub = this._parseGroup(tex, pos);
        pos = sub.pos;
        xml = `<msub><mrow>${xml}</mrow><mrow>${sub.xml}</mrow></msub>`;
      } else if (ch === " ") {
        pos++;
        xml += '<mspace width="0.33em"/>';
      } else if (ch >= "0" && ch <= "9") {
        let num = "";
        while (pos < tex.length && tex[pos] >= "0" && tex[pos] <= "9") {
          num += tex[pos];
          pos++;
        }
        xml += `<mn>${num}</mn>`;
      } else if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
        let ident = "";
        while (
          pos < tex.length &&
          ((tex[pos] >= "a" && tex[pos] <= "z") ||
            (tex[pos] >= "A" && tex[pos] <= "Z"))
        ) {
          ident += tex[pos];
          pos++;
        }
        xml += `<mi>${ident}</mi>`;
      } else if ("+-*/=()[]|!.,;:<>".includes(ch)) {
        xml += `<mo>${ch}</mo>`;
        pos++;
      } else {
        pos++;
      }
    }
    return { xml, pos };
  }

  _parseGroup(tex, pos) {
    if (pos < tex.length && tex[pos] === "{") {
      pos++;
      return this._parseLatex(tex, pos);
    }
    let ident = "";
    while (
      pos < tex.length &&
      tex[pos] !== " " &&
      tex[pos] !== "{" &&
      tex[pos] !== "}" &&
      tex[pos] !== "\\"
    ) {
      ident += tex[pos];
      pos++;
    }
    return { xml: `<mi>${ident}</mi>`, pos };
  }

  _readBrace(tex, pos) {
    if (tex[pos] === "{") {
      pos++;
      let depth = 1;
      let content = "";
      while (pos < tex.length && depth > 0) {
        if (tex[pos] === "{") depth++;
        if (tex[pos] === "}") depth--;
        if (depth > 0) content += tex[pos];
        pos++;
      }
      return { xml: content, pos };
    }
    let content = "";
    while (
      pos < tex.length &&
      tex[pos] !== " " &&
      tex[pos] !== "{" &&
      tex[pos] !== "}" &&
      tex[pos] !== "\\"
    ) {
      content += tex[pos];
      pos++;
    }
    return { xml: content, pos };
  }

  _readCommand(tex, pos) {
    if (pos >= tex.length) return { name: "", pos };
    if (!tex[pos].match(/[a-zA-Z]/)) return { name: tex[pos], pos: pos + 1 };
    let name = "";
    while (pos < tex.length && tex[pos].match(/[a-zA-Z]/)) {
      name += tex[pos];
      pos++;
    }
    return { name, pos };
  }

  _parseLatex(tex, pos) {
    let xml = "";
    while (pos < tex.length) {
      const ch = tex[pos];
      if (ch === "}" || ch === "]") {
        pos++;
        break;
      }
      if (ch === "{") {
        pos++;
        const inner = this._parseLatex(tex, pos);
        xml += inner.xml;
        pos = inner.pos;
      } else if (ch === "\\") {
        pos++;
        const cmd = this._readCommand(tex, pos);
        pos = cmd.pos;
        const name = cmd.name;
        const greekMap = {
          alpha: "\u03B1",
          beta: "\u03B2",
          gamma: "\u03B3",
          delta: "\u03B4",
          epsilon: "\u03B5",
          zeta: "\u03B6",
          eta: "\u03B7",
          theta: "\u03B8",
          iota: "\u03B9",
          kappa: "\u03BA",
          lambda: "\u03BB",
          mu: "\u03BC",
          nu: "\u03BD",
          xi: "\u03BE",
          pi: "\u03C0",
          rho: "\u03C1",
          sigma: "\u03C3",
          tau: "\u03C4",
          upsilon: "\u03C5",
          phi: "\u03C6",
          chi: "\u03C7",
          psi: "\u03C8",
          omega: "\u03C9",
          Gamma: "\u0393",
          Delta: "\u0394",
          Theta: "\u0398",
          Lambda: "\u039B",
          Xi: "\u039E",
          Pi: "\u03A0",
          Sigma: "\u03A3",
          Phi: "\u03A6",
          Psi: "\u03A8",
          Omega: "\u03A9",
          infty: "\u221E",
          partial: "\u2202",
          nabla: "\u2207",
          prime: "\u2032",
          emptyset: "\u2205",
          forall: "\u2200",
          exists: "\u2203",
          neg: "\u00AC",
          ldots: "\u2026",
          cdots: "\u22EF",
          int: "\u222B",
          iint: "\u222C",
          oint: "\u222E",
          sum: "\u2211",
          prod: "\u220F",
          coprod: "\u2210",
          sqrt: "\u221A",
          times: "\u00D7",
          cdot: "\u22C5",
          pm: "\u00B1",
          mp: "\u2213",
          leq: "\u2264",
          geq: "\u2265",
          neq: "\u2260",
          approx: "\u2248",
          equiv: "\u2261",
          sim: "\u223C",
          propto: "\u221D",
          mid: "\u2223",
          nmid: "\u2224",
          subset: "\u2282",
          supset: "\u2283",
          in: "\u2208",
          notin: "\u2209",
          cap: "\u2229",
          cup: "\u222A",
          setminus: "\u2216",
          alpha: "\u03B1",
          langle: "\u27E8",
          rangle: "\u27E9",
          lceil: "\u2308",
          rceil: "\u2309",
          lfloor: "\u230A",
          rfloor: "\u230B",
          arrow: "\u2192",
          leftarrow: "\u2190",
          Leq: "\u2A7D",
          Geq: "\u2A7E",
        };
        if (name === "frac") {
          const num = this._parseLatex(tex, pos);
          pos = num.pos;
          const den = this._parseLatex(tex, pos);
          pos = den.pos;
          xml += `<mfrac><mrow>${num.xml}</mrow><mrow>${den.xml}</mrow></mfrac>`;
        } else if (name === "sqrt") {
          if (tex[pos] === "[") {
            pos++;
            const deg = this._parseLatex(tex, pos);
            pos = deg.pos;
            const body = this._parseLatex(tex, pos);
            pos = body.pos;
            xml += `<mroot><mrow>${body.xml}</mrow><mrow>${deg.xml}</mrow></mroot>`;
          } else {
            const body = this._parseLatex(tex, pos);
            pos = body.pos;
            xml += `<msqrt><mrow>${body.xml}</mrow></msqrt>`;
          }
        } else if (
          name === "mathrm" ||
          name === "mathbf" ||
          name === "mathit" ||
          name === "mathsf" ||
          name === "mathtt"
        ) {
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mstyle mathvariant="${name.replace("math", "")}">${body.xml}</mstyle>`;
        } else if (name === "text") {
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mtext>${body.xml}</mtext>`;
        } else if (name === "left" || name === "right" || name === "middle") {
          pos++;
        } else if (name === "quad" || name === "qquad") {
          xml += '<mspace width="1em"/>';
        } else if (
          name === "," ||
          name === ";" ||
          name === ":" ||
          name === "!"
        ) {
          xml += '<mspace width="0.17em"/>';
        } else if (greekMap[name]) {
          xml += `<mi>${greekMap[name]}</mi>`;
        } else if (name === "cdot") {
          xml += "<mo>\u22C5</mo>";
        } else if (name === "times") {
          xml += "<mo>\u00D7</mo>";
        } else if (name === "div") {
          xml += "<mo>\u00F7</mo>";
        } else if (name === "pm") {
          xml += "<mo>\u00B1</mo>";
        } else if (name === "mp") {
          xml += "<mo>\u2213</mo>";
        } else if (name === "leq" || name === "le") {
          xml += "<mo>\u2264</mo>";
        } else if (name === "geq" || name === "ge") {
          xml += "<mo>\u2265</mo>";
        } else if (name === "neq" || name === "ne") {
          xml += "<mo>\u2260</mo>";
        } else if (name === "approx") {
          xml += "<mo>\u2248</mo>";
        } else if (name === "equiv") {
          xml += "<mo>\u2261</mo>";
        } else if (name === "rightarrow" || name === "to") {
          xml += "<mo>\u2192</mo>";
        } else if (name === "leftarrow") {
          xml += "<mo>\u2190</mo>";
        } else if (name === "subset") {
          xml += "<mo>\u2282</mo>";
        } else if (name === "supset") {
          xml += "<mo>\u2283</mo>";
        } else if (name === "in") {
          xml += "<mo>\u2208</mo>";
        } else if (name === "cup") {
          xml += "<mo>\u222A</mo>";
        } else if (name === "cap") {
          xml += "<mo>\u2229</mo>";
        } else if (name === "forall") {
          xml += "<mo>\u2200</mo>";
        } else if (name === "exists") {
          xml += "<mo>\u2203</mo>";
        } else if (name === "nabla") {
          xml += "<mo>\u2207</mo>";
        } else if (name === "partial") {
          xml += "<mo>\u2202</mo>";
        } else if (name === "infty") {
          xml += "<mi>\u221E</mi>";
        } else if (name === "emptyset") {
          xml += "<mi>\u2205</mi>";
        } else if (name === "sum") {
          xml += "<mo>\u2211</mo>";
        } else if (name === "prod") {
          xml += "<mo>\u220F</mo>";
        } else if (name === "int") {
          xml += "<mo>\u222B</mo>";
        } else if (name === "oint") {
          xml += "<mo>\u222E</mo>";
        } else if (name === "ldots") {
          xml += "<mo>\u2026</mo>";
        } else if (name === "langle") {
          xml += "<mo>\u27E8</mo>";
        } else if (name === "rangle") {
          xml += "<mo>\u27E9</mo>";
        } else if (name === "overline") {
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u00AF</mo></mover>`;
        } else if (name === "underline") {
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<munder><mrow>${body.xml}</mrow><mo>\u0332</mo></munder>`;
        } else if (name === "hat") {
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u005E</mo></mover>`;
        } else {
          xml += `<mi>${name}</mi>`;
        }
      } else if (ch === "^") {
        pos++;
        if (tex[pos] === "{") {
          pos++;
          const sup = this._parseLatex(tex, pos);
          pos = sup.pos;
          xml = `<msup><mrow>${xml}</mrow><mrow>${sup.xml}</mrow></msup>`;
        } else {
          const sup = this._parseLatex(tex, pos);
          pos = sup.pos;
          xml = `<msup><mrow>${xml}</mrow><mrow>${sup.xml}</mrow></msup>`;
        }
      } else if (ch === "_") {
        pos++;
        if (tex[pos] === "{") {
          pos++;
          const sub = this._parseLatex(tex, pos);
          pos = sub.pos;
          xml = `<msub><mrow>${xml}</mrow><mrow>${sub.xml}</mrow></msub>`;
        } else {
          const sub = this._parseLatex(tex, pos);
          pos = sub.pos;
          xml = `<msub><mrow>${xml}</mrow><mrow>${sub.xml}</mrow></msub>`;
        }
      } else if (ch === " ") {
        pos++;
        xml += '<mspace width="0.33em"/>';
      } else if (ch === "~") {
        pos++;
        xml += '<mspace width="0.33em"/>';
      } else if (ch >= "0" && ch <= "9") {
        let num = "";
        while (pos < tex.length && tex[pos] >= "0" && tex[pos] <= "9") {
          num += tex[pos];
          pos++;
        }
        xml += `<mn>${num}</mn>`;
      } else if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
        let ident = ch;
        pos++;
        while (
          pos < tex.length &&
          ((tex[pos] >= "a" && tex[pos] <= "z") ||
            (tex[pos] >= "A" && tex[pos] <= "Z"))
        ) {
          ident += tex[pos];
          pos++;
        }
        xml += `<mi>${ident}</mi>`;
      } else if ("+-*/=()[]|!.,;:<>".includes(ch)) {
        xml += `<mo>${ch}</mo>`;
        pos++;
      } else {
        pos++;
      }
    }
    return { xml, pos };
  }

  _readCommand(tex, pos) {
    if (pos >= tex.length) return { name: "", pos };
    const ch = tex[pos];
    if (!ch.match(/[a-zA-Z]/)) return { name: tex[pos], pos: pos + 1 };
    let name = "";
    while (pos < tex.length && tex[pos].match(/[a-zA-Z]/)) {
      name += tex[pos];
      pos++;
    }
    return { name, pos };
  }

  async initLibrary() {
    Logger.debug("Initializing formula library...");

    await this.library.load();

    Logger.debug(
      `Library loaded: ${this.library.categories.length} categories`,
    );

    const categorySelect = document.getElementById("categorySelect");
    const categoryDropdown = document.getElementById("categoryDropdown");
    const grid = document.getElementById("libraryGrid");

    if (!categorySelect || !categoryDropdown || !grid) {
      Logger.warn("Library UI elements not found");
      return;
    }

    this.library.getCategories().forEach((cat, i) => {
      const option = document.createElement("div");
      option.className = `custom-select-option${i === 0 ? " selected" : ""}`;
      option.textContent = cat.name;
      option.dataset.value = cat.id;
      option.addEventListener("click", () => {
        Logger.debug(`Category selected: ${cat.name}`);
        categorySelect
          .querySelectorAll(".custom-select-option")
          .forEach((o) => o.classList.remove("selected"));
        option.classList.add("selected");
        categorySelect.querySelector(
          ".custom-select-trigger span",
        ).textContent = cat.name;
        categorySelect.querySelector(".custom-select-trigger").dataset.value =
          cat.id;
        categorySelect.classList.remove("open");
        this.renderFormulas(cat.id);
      });
      categoryDropdown.appendChild(option);
    });

    if (this.library.getCategories().length > 0) {
      const firstCategory = this.library.getCategories()[0];
      categorySelect.querySelector(".custom-select-trigger span").textContent =
        firstCategory.name;
      categorySelect.querySelector(".custom-select-trigger").dataset.value =
        firstCategory.id;
      Logger.debug(`Rendering first category: ${firstCategory.name}`);
      this.renderFormulas(firstCategory.id);
    }

    Logger.info("Formula library initialized");
  }

  renderFormulas(categoryId) {
    Logger.debug(`renderFormulas: categoryId=${categoryId}`);
    const grid = document.getElementById("libraryGrid");
    if (!grid) {
      Logger.warn("libraryGrid not found");
      return;
    }

    const formulas = this.library.getFormulas(categoryId);
    Logger.debug(`Found ${formulas.length} formulas for ${categoryId}`);

    grid.innerHTML = "";

    if (formulas.length === 0) {
      grid.innerHTML =
        '<div style="color: var(--muted); text-align: center; padding: 1rem; grid-column: 1/-1;">暂无公式</div>';
      return;
    }

    formulas.forEach((formula) => {
      const item = document.createElement("div");
      item.className = "formula-item";
      item.title = formula.latex;
      item.innerHTML = `
        <div class="formula-label">${formula.label}</div>
        <div class="formula-latex">${formula.latex}</div>
      `;
      item.addEventListener("click", () => this.insertFormula(formula.latex));
      grid.appendChild(item);
    });

    Logger.debug(`Rendered ${formulas.length} formula items`);
  }

  searchLibrary(query) {
    const grid = document.getElementById("libraryGrid");
    if (!grid) return;

    if (!query) {
      const categorySelect = document.getElementById("categorySelect");
      const currentCategory = categorySelect?.querySelector(
        ".custom-select-trigger",
      )?.dataset?.value;
      if (currentCategory) {
        this.renderFormulas(currentCategory);
      }
      return;
    }

    const results = this.library.search(query);
    grid.innerHTML = "";

    if (results.length === 0) {
      grid.innerHTML =
        '<div style="color: var(--muted); text-align: center; padding: 1rem; grid-column: 1/-1;">未找到匹配公式</div>';
      return;
    }

    results.forEach(({ formula, category }) => {
      const item = document.createElement("div");
      item.className = "formula-item";
      item.title = `${formula.latex}\n分类: ${category}`;
      item.innerHTML = `
        <div class="formula-label">${formula.label}</div>
        <div class="formula-latex">${formula.latex}</div>
      `;
      item.addEventListener("click", () => this.insertFormula(formula.latex));
      grid.appendChild(item);
    });

    Logger.debug(`Search results: ${results.length}`);
  }

  insertFormula(latex) {
    Logger.info(`insertFormula: ${latex}`);

    this.addHistoryItem(latex);

    const mfLatex = latex.replace(/#\?/g, "#{}");

    if (this.mathfield) {
      this.mathfield.insert(mfLatex, {
        mode: "math",
        focus: true,
        format: "latex",
      });
      const newLatex = this.mathfield.getValue("latex");
      this.editor.updatePreview(newLatex);
      const source = document.getElementById("latexSource");
      if (source) source.value = newLatex;
    } else {
      const currentLatex = this.editor.getLatex();
      const newLatex = currentLatex ? currentLatex + mfLatex : mfLatex;
      this.editor.setLatex(newLatex);
      this.editor.updatePreview(newLatex);
    }

    this.showToast("已插入公式");
  }

  // ═══════════════════════════════════════════
  // History Management
  // ═══════════════════════════════════════════
  historyDb = null;
  historyFilter = "all";

  async initHistoryDb() {
    try {
      this.historyDb = await new Promise((resolve, reject) => {
        const request = indexedDB.open("latexsnipper-office-history", 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("results")) {
            const store = db.createObjectStore("results", {
              keyPath: "id",
              autoIncrement: true,
            });
            store.createIndex("createdAt", "createdAt");
            store.createIndex("favorite", "favorite");
          }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
      });
      Logger.info("History DB initialized");
    } catch (e) {
      Logger.warn("IndexedDB not available, using localStorage fallback");
    }
  }

  async addHistoryItem(latex) {
    // Dedup: skip if the most recent history item has the same content
    if (await this._latestHistoryEquals(latex)) {
      Logger.debug(
        `[History] Skipped duplicate: "${latex.substring(0, 30)}..."`,
      );
      return;
    }

    const item = {
      latex,
      type: "formula",
      source: "editor",
      favorite: false,
      createdAt: Date.now(),
    };

    if (this.historyDb) {
      await new Promise((resolve, reject) => {
        const tx = this.historyDb.transaction("results", "readwrite");
        tx.objectStore("results").add(item);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    } else {
      const history = JSON.parse(
        localStorage.getItem("formulaHistory") || "[]",
      );
      history.unshift({ ...item, id: Date.now() });
      localStorage.setItem(
        "formulaHistory",
        JSON.stringify(history.slice(0, 50)),
      );
    }
    this.renderHistoryList();
  }

  async _latestHistoryEquals(latex) {
    try {
      if (this.historyDb) {
        // IndexedDB: get the latest item by createdAt index (descending)
        const latest = await new Promise((resolve, reject) => {
          const tx = this.historyDb.transaction("results", "readonly");
          const index = tx.objectStore("results").index("createdAt");
          const req = index.openCursor(null, "prev");
          req.onsuccess = () => {
            const cursor = req.result;
            resolve(cursor ? cursor.value : null);
          };
          req.onerror = () => reject(req.error);
        });
        return latest != null && latest.latex === latex;
      }
      // localStorage fallback: first item is latest
      const history = JSON.parse(
        localStorage.getItem("formulaHistory") || "[]",
      );
      return history.length > 0 && history[0].latex === latex;
    } catch {
      return false; // don't block on errors
    }
  }

  async getHistoryItems(filter = "all") {
    if (this.historyDb) {
      const items = await new Promise((resolve, reject) => {
        const tx = this.historyDb.transaction("results", "readonly");
        const request = tx.objectStore("results").index("createdAt").getAll();
        request.onsuccess = () => resolve(request.result.reverse());
        request.onerror = (e) => reject(e.target.error);
      });
      if (filter === "favorites") return items.filter((r) => r.favorite);
      return items;
    }
    const history = JSON.parse(localStorage.getItem("formulaHistory") || "[]");
    if (filter === "favorites") return history.filter((r) => r.favorite);
    return history;
  }

  async toggleFavoriteHistory(id) {
    if (this.historyDb) {
      return await new Promise((resolve, reject) => {
        const tx = this.historyDb.transaction("results", "readwrite");
        const store = tx.objectStore("results");
        const request = store.get(id);
        request.onsuccess = () => {
          const record = request.result;
          if (record) {
            record.favorite = !record.favorite;
            store.put(record);
            resolve(record.favorite);
          } else {
            resolve(false);
          }
        };
        request.onerror = (e) => reject(e.target.error);
      });
    }
    return false;
  }

  async deleteHistoryItem(id) {
    if (this.historyDb) {
      await new Promise((resolve, reject) => {
        const tx = this.historyDb.transaction("results", "readwrite");
        tx.objectStore("results").delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    } else {
      const history = JSON.parse(
        localStorage.getItem("formulaHistory") || "[]",
      );
      localStorage.setItem(
        "formulaHistory",
        JSON.stringify(history.filter((h) => h.id !== id)),
      );
    }
  }

  async clearAllHistory(keepFavorites = true) {
    if (this.historyDb) {
      await new Promise((resolve, reject) => {
        const tx = this.historyDb.transaction("results", "readwrite");
        const store = tx.objectStore("results");
        const request = store.getAll();
        request.onsuccess = () => {
          const all = request.result;
          for (const record of all) {
            if (keepFavorites && record.favorite) continue;
            store.delete(record.id);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    } else {
      if (keepFavorites) {
        const history = JSON.parse(
          localStorage.getItem("formulaHistory") || "[]",
        );
        localStorage.setItem(
          "formulaHistory",
          JSON.stringify(history.filter((h) => h.favorite)),
        );
      } else {
        localStorage.removeItem("formulaHistory");
      }
    }
    this.renderHistoryList();
    this.showToast("历史记录已清空");
  }

  async renderHistoryList() {
    const listEl = document.getElementById("historyList");
    if (!listEl) return;

    const items = await this.getHistoryItems(this.historyFilter);

    if (items.length === 0) {
      listEl.innerHTML =
        '<div class="history-empty">暂无历史记录<br>使用编辑器或 OCR 添加公式</div>';
      return;
    }

    listEl.innerHTML = items
      .map((item) => {
        const time = new Date(item.createdAt).toLocaleString("zh-CN");
        const sourceMap = { editor: "编辑器", ocr: "OCR", formula: "公式库" };
        const srcLabel = sourceMap[item.source] || "编辑器";
        return `
        <div class="history-item-wrap">
          <div class="hi-swipe-bg">
            <div class="hi-swipe-delete">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              删除
            </div>
            <div class="hi-swipe-actions">
              <span class="hi-swipe-fav-label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                已收藏
              </span>
              <button class="hi-swipe-btn" data-action="copy">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                复制
              </button>
              <button class="hi-swipe-btn" data-action="insert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                插入
              </button>
            </div>
          </div>
          <div class="history-item" data-id="${item.id}">
            <div class="hi-latex">${this._escapeHtml(item.latex)}</div>
            <div class="hi-meta">
              <span class="hi-tag">${srcLabel}</span>
              <span>${time}</span>
              <button class="hi-fav ${item.favorite ? "active" : ""}" data-action="fav" title="收藏">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${item.favorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
      })
      .join("");

    listEl.querySelectorAll(".history-item").forEach((card) => {
      this.initSwipe(card);
      // Click to quickly insert formula to editor
      card.addEventListener("click", async (e) => {
        if (e.target.closest(".hi-fav")) return;
        // Skip if card is in swiped position
        if (
          card.style.transform &&
          card.style.transform !== "none" &&
          card.style.transform !== ""
        )
          return;
        const id = Number(card.dataset.id);
        const items = await this.getHistoryItems();
        const item = items.find((x) => x.id === id);
        if (!item) return;
        this.editor.setLatex(item.latex);
        this.editor.updatePreview(item.latex);
        const source = document.getElementById("latexSource");
        if (source) source.value = item.latex;
        this.switchSection("editor");
        this.showToast("已加载公式");
      });
    });

    listEl.addEventListener("click", (e) => {
      if (
        !e.target.closest(".history-item") &&
        !e.target.closest(".hi-swipe-delete") &&
        !e.target.closest(".hi-swipe-btn") &&
        !e.target.closest(".hi-fav")
      ) {
        listEl.querySelectorAll(".history-item").forEach((card) => {
          if (card.style.transform && card.style.transform !== "none") {
            card.style.transition =
              "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)";
            card.style.transform = "";
            const wrap = card.parentElement;
            const dz = wrap?.querySelector(".hi-swipe-delete");
            const az = wrap?.querySelector(".hi-swipe-actions");
            if (dz) dz.style.width = "0";
            if (az) {
              az.style.width = "0";
              az.classList.remove("fav-mode");
              az.querySelectorAll(".hi-swipe-btn").forEach((b) =>
                b.classList.remove("visible"),
              );
            }
            setTimeout(() => {
              card.style.transition = "";
            }, 300);
          }
        });
      }
    });

    listEl.querySelectorAll(".hi-fav").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.closest(".history-item").dataset.id);
        await this.toggleFavoriteHistory(id);
        this.renderHistoryList();
      });
    });
  }

  // ═══════════════════════════════════════════
  // Swipe Gesture Handling
  // ═══════════════════════════════════════════
  initSwipe(card) {
    let startX = 0,
      startY = 0,
      startTime = 0;
    let tracking = false,
      currentDx = 0;

    const wrap = card.parentElement;
    const bg = wrap.querySelector(".hi-swipe-bg");
    const deleteZone = bg?.querySelector(".hi-swipe-delete");
    const actionZone = bg?.querySelector(".hi-swipe-actions");
    const actionBtns = actionZone
      ? [...actionZone.querySelectorAll(".hi-swipe-btn")]
      : [];

    const setZoneWidths = (dx) => {
      if (!bg) return;
      const dz = bg.querySelector(".hi-swipe-delete");
      const az = bg.querySelector(".hi-swipe-actions");
      const favLabel = az?.querySelector(".hi-swipe-fav-label");
      const wrapWidth = wrap.offsetWidth;
      const abs = Math.abs(dx);

      if (dx > 0) {
        if (dz)
          dz.style.width = Math.round(Math.min(dx, wrapWidth * 0.3)) + "px";
        if (az) {
          az.style.width = "0";
          az.classList.remove("fav-mode");
        }
        actionBtns.forEach((b) => b.classList.remove("visible"));
        if (favLabel) favLabel.style.opacity = "0";
        if (dz) dz.style.pointerEvents = dx > 50 ? "auto" : "none";
      } else if (dx < 0) {
        if (az)
          az.style.width = Math.round(Math.min(abs, wrapWidth * 0.5)) + "px";
        if (dz) dz.style.width = "0";

        if (abs > wrapWidth * 0.55) {
          if (az) az.classList.add("fav-mode");
          actionBtns.forEach((b) => b.classList.remove("visible"));
          if (favLabel) favLabel.style.opacity = "1";
        } else if (abs > wrapWidth * 0.2) {
          if (az) az.classList.remove("fav-mode");
          actionBtns.forEach((b) => b.classList.add("visible"));
          if (favLabel) favLabel.style.opacity = "0";
        } else {
          if (az) az.classList.remove("fav-mode");
          actionBtns.forEach((b) => b.classList.remove("visible"));
          if (favLabel) favLabel.style.opacity = "0";
        }
      } else {
        if (dz) dz.style.width = "0";
        if (az) {
          az.style.width = "0";
          az.classList.remove("fav-mode");
          actionBtns.forEach((b) => b.classList.remove("visible"));
          if (favLabel) favLabel.style.opacity = "0";
        }
      }
    };

    const returnToOrigin = (smooth = true) => {
      if (smooth) {
        card.classList.remove("swiping");
        card.classList.add("returning");
        card.style.transform = "";
        if (deleteZone) deleteZone.classList.remove("no-transition");
        if (actionZone) actionZone.classList.remove("no-transition");
      } else {
        card.style.transition = "none";
        card.style.transform = "";
        if (deleteZone) deleteZone.classList.add("no-transition");
        if (actionZone) actionZone.classList.add("no-transition");
        requestAnimationFrame(() => {
          card.style.transition = "";
        });
      }
      setZoneWidths(0);
      setTimeout(() => card.classList.remove("returning"), 300);
    };

    const snapTo = (dir) => {
      const wrapWidth = wrap.offsetWidth;
      const pos = dir > 0 ? 100 : -160;
      card.style.transition = "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)";
      card.style.transform = `translateX(${pos}px)`;
      if (deleteZone) deleteZone.classList.remove("no-transition");
      if (actionZone) {
        actionZone.classList.remove("no-transition");
        actionZone.classList.remove("fav-mode");
      }
      if (dir > 0 && deleteZone) {
        deleteZone.style.width = "100px";
        actionBtns.forEach((b) => b.classList.remove("visible"));
      } else if (dir < 0 && actionZone) {
        actionZone.style.width = "160px";
        actionBtns.forEach((b) => b.classList.add("visible"));
      }
      setTimeout(() => {
        card.style.transition = "";
      }, 300);
    };

    const doDelete = () => {
      const id = Number(card.dataset.id);
      card.classList.add("deleting");
      card.style.transform = "translateX(100%)";
      card.style.opacity = "0";
      setTimeout(async () => {
        await this.deleteHistoryItem(id);
        this.renderHistoryList();
      }, 300);
    };

    const doAction = async (action) => {
      const id = Number(card.dataset.id);
      returnToOrigin(true);
      const items = await this.getHistoryItems();
      const item = items.find((x) => x.id === id);
      if (!item) return;
      if (action === "copy") {
        navigator.clipboard.writeText(item.latex);
        this.showToast("已复制");
      } else if (action === "insert") {
        this.editor.setLatex(item.latex);
        this.editor.updatePreview(item.latex);
        const source = document.getElementById("latexSource");
        if (source) source.value = item.latex;
        this.switchSection("editor");
        this.showToast("已加载公式");
      }
    };

    const onStart = (x, y) => {
      startX = x;
      startY = y;
      startTime = Date.now();
      tracking = true;
      currentDx = 0;
      card.classList.add("swiping");
    };

    const onMove = (x, y) => {
      if (!tracking) return;
      const dx = x - startX;
      const dy = y - startY;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 10) return;
      currentDx = dx;
      card.style.transform = `translateX(${dx}px)`;
      setZoneWidths(dx);
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      card.classList.remove("swiping");

      const duration = Date.now() - startTime;
      const velocity = Math.abs(currentDx) / duration;
      const wrapWidth = wrap.offsetWidth;

      if (currentDx > wrapWidth * 0.3) {
        doDelete();
      } else if (currentDx > wrapWidth * 0.12) {
        snapTo(1);
      } else if (currentDx < -(wrapWidth * 0.55)) {
        const id = Number(card.dataset.id);
        this.toggleFavoriteHistory(id).then(() => {
          this.renderHistoryList();
        });
      } else if (currentDx < -(wrapWidth * 0.2)) {
        snapTo(-1);
      } else {
        returnToOrigin(true);
      }
    };

    card.addEventListener("mousedown", (e) => {
      if (e.target.closest(".hi-fav")) return;
      onStart(e.clientX, e.clientY);
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (tracking) onMove(e.clientX, e.clientY);
    });
    document.addEventListener("mouseup", () => {
      if (tracking) onEnd();
    });

    card.addEventListener(
      "touchstart",
      (e) => {
        if (e.target.closest(".hi-fav")) return;
        onStart(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true },
    );
    card.addEventListener(
      "touchmove",
      (e) => {
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true },
    );
    card.addEventListener("touchend", () => onEnd());

    actionBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        doAction(btn.dataset.action);
      });
    });

    if (deleteZone) {
      deleteZone.addEventListener("click", (e) => {
        e.stopPropagation();
        doDelete();
      });
    }
  }

  _escapeHtml(text) {
    const d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML;
  }

  switchSection(section) {
    Logger.debug(`switchSection: ${section}`);

    document
      .querySelectorAll(".section")
      .forEach((s) => s.classList.remove("active"));
    document.getElementById(`${section}Section`)?.classList.add("active");

    document
      .querySelectorAll(".nav-tab")
      .forEach((btn) => btn.classList.remove("active"));
    document.getElementById(`${section}Btn`)?.classList.add("active");

    this.currentSection = section;

    // If leaving editor while OLE edit session is active, emit cancel
    if (section !== "editor" && this._oleSessionToken) {
      this.cancelOleEdit();
    }

    const sidebarTrigger = document.getElementById("sidebarTrigger");
    const sidebarPanel = document.getElementById("sidebarPanel");
    const sidebarOverlay = document.getElementById("sidebarOverlay");

    if (section === "editor") {
      sidebarTrigger?.classList.remove("hidden");
      // Restore sidebar open state if it was open before leaving
      if (this._sidebarWasOpen) {
        sidebarPanel?.classList.add("open");
        sidebarOverlay?.classList.add("visible");
        this._sidebarWasOpen = false;
      }
    } else {
      // Save sidebar state before hiding
      this._sidebarWasOpen = sidebarPanel?.classList.contains("open") || false;
      sidebarTrigger?.classList.add("hidden");
      sidebarPanel?.classList.remove("open");
      sidebarOverlay?.classList.remove("visible");
    }

    if (section === "history") {
      this.renderHistoryList();
    }

    if (section === "settings") {
      this.renderPlatformList();
    }

    if (section === "ocr") {
      this.checkBridgeStatus();
    }
  }

  updateTabVisibility() {
    Logger.debug("Updating tab visibility...");
    const settings = this.settingsManager.settings;

    const ocrTab = document.getElementById("ocrBtn");
    if (ocrTab) {
      ocrTab.style.display = settings.ocrEnabled ? "" : "none";
    }
    this.updateOfficeInsertButton();

    Logger.debug("Tab visibility updated");
  }

  async checkBridgeStatus() {
    const statusEl = document.getElementById("ocrBridgeStatus");
    if (!statusEl) return;

    const connected = await this.connectBridge();
    if (connected) {
      statusEl.textContent = "已连接到桌面端 LaTeXSnipper";
      statusEl.style.color = "var(--accent)";
    } else {
      statusEl.textContent = "未检测到桌面端，请先启动 LaTeXSnipper";
      statusEl.style.color = "#ef4444";
    }
  }

  async copyFormula(format) {
    Logger.info(`copyFormula: ${format}`);
    const latex = this.editor.getLatex();
    if (!latex) {
      this.showStatus("请先输入公式");
      return;
    }

    let textToCopy = latex;

    try {
      if (format === "mathml") {
        textToCopy = `<math xmlns="http://www.w3.org/1998/Math/MathML">${this.latexToMathML(latex)}</math>`;
      } else if (format === "svg") {
        const result = await this._renderLatexSvg(latex, false);
        textToCopy = result.svg || latex;
      } else if (format === "md") {
        const isDisplay = officeInsertModeIsDisplay(
          this.getFormulaInsertMode(),
        );
        textToCopy = isDisplay ? `$$\n${latex}\n$$` : `$${latex}$`;
      }

      const textarea = document.createElement("textarea");
      textarea.value = textToCopy;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);

      const labelMap = {
        latex: "LaTeX",
        mathml: "MathML",
        svg: "SVG",
        md: "Markdown",
      };
      if (ok) {
        this.showToast(`已复制 ${labelMap[format] || format.toUpperCase()}`);
        this.addHistoryItem(latex);
        Logger.info(`Copy successful: ${format}`);
      } else {
        this.showToast("复制失败");
      }
    } catch (e) {
      Logger.error("Copy failed:", e);
      this.showToast("复制失败");
    }
  }

  async insertToWord() {
    const latex = this.editor.getLatex();
    console.log("[Insert] latex:", latex);
    if (!latex) {
      this.showStatus("请先输入公式");
      return;
    }

    // P1-A: OLE edit mode — skip insert, only save back to existing OLE object
    if (this._oleSessionToken) {
      await this._saveOleEditOnly(latex);
      return;
    }

    let officeTransaction = null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const mode = normalizeOfficeInsertMode(
        this._pendingOfficeEditorRequest?.requestedMode ??
          this.getFormulaInsertMode(),
      );
      const isDisplay = officeInsertModeIsDisplay(mode);

      // Refresh sessions before insert to avoid selecting stale entries
      await this.updateOfficeHostSelector();

      // Get selected session from dropdown
      const sessionId = this._selectedSessionId;
      if (!sessionId) {
        this.showToast("请先选择目标 Office 宿主");
        return;
      }

      const session = this._sessions.find((s) => s.session_id === sessionId);
      if (!session) {
        this.showToast("所选会话不存在");
        return;
      }
      if (
        mode === FORMULA_INSERT_MODES.NUMBERED &&
        session.host_type !== "word"
      ) {
        this.showToast(
          "UNSUPPORTED_MODE：当前 Office 宿主不支持编号公式，请选择行内或行间模式。",
        );
        return;
      }
      officeTransaction = await this.ensureOfficeEditTransaction(
        invoke,
        session,
        mode,
        latex,
      );

      console.log("[Insert] Converting LaTeX to OMML...");
      const omml = await invoke("latex_to_omml", { latex });
      console.log("[Insert] OMML length:", omml?.length || 0);

      const isWord = session.host_type === "word";
      const integrationMode =
        this.settingsManager.get("officeIntegrationMode") || "auto";
      const shouldRenderPreview =
        !isWord || integrationMode === "ole" || integrationMode === "image";

      // Render SVG for OLE/image previews. Word native mode uses OMML directly.
      let svg = null;
      let widthPt = 0;
      let heightPt = 0;
      if (shouldRenderPreview) {
        try {
          const rendered = await this._renderLatexSvg(latex, isDisplay);
          svg = rendered.svg;
          widthPt = rendered.widthPt;
          heightPt = rendered.heightPt;
        } catch (e) {
          Logger.error("[Insert] SVG render error for Excel/PPT:", e);
          this.showToast(
            `${session.host_type} 公式 SVG 渲染失败，可能存在不支持的 LaTeX 宏: ${e.message}，插入已取消`,
          );
          return; // block insert — don't send SVG-less request
        }
      }

      console.log("[Insert] Sending to session:", sessionId);

      // Convert SVG to PNG for Excel/PPT (SVG rendering is unreliable in Office)
      let pngBase64 = null;
      if (shouldRenderPreview && svg) {
        try {
          pngBase64 = await this._svgToPngBase64(svg, widthPt, heightPt);
        } catch (e) {
          Logger.warn("[Insert] SVG→PNG conversion failed:", e);
          if (integrationMode === "image") {
            this.showToast("兼容图片生成失败，请尝试 SVG/OLE/OMML 模式");
            return;
          }
        }
      }

      await this.prepareOfficeEditTransaction(
        invoke,
        officeTransaction,
        mode,
        latex,
      );
      if (this._pendingOfficeEditorRequest?.action === "edit") {
        await invoke("native_office_replace_formula", {
          sessionId,
          formulaId: officeTransaction.formulaId,
          latex,
          omml,
          display: mode,
          svg: shouldRenderPreview ? svg : null,
          png: pngBase64,
          widthPt,
          heightPt,
          storageMode: integrationMode,
          expectedRevision: this._pendingOfficeEditorRequest.revision ?? null,
        });
      } else {
        await invoke("native_office_insert_formula", {
          sessionId: sessionId,
          formulaId: officeTransaction.formulaId,
          latex: latex,
          omml: omml,
          display: isDisplay ? "block" : "inline",
          mode,
          svg: shouldRenderPreview ? svg : null,
          png: pngBase64,
          widthPt: widthPt,
          heightPt: heightPt,
          integrationMode: integrationMode,
        });
      }
      console.log("[Insert] Success");
      this.addHistoryItem(latex);
      // The INSERT_RESULT event handler will show the actual success/failure toast.
    } catch (error) {
      if (officeTransaction) {
        await this.completeOfficeEditTransaction(
          false,
          "DESKTOP_DISPATCH_FAILED",
          error?.message || String(error),
        );
      }
      this.showToast(`插入失败: ${error.message || error}`);
    }
  }

  /** Save OLE edit result back to the existing OLE object — does NOT insert a new formula. */
  async _createOleCommitWaiter(sessionToken) {
    const { listen } = await import("@tauri-apps/api/event");
    let settled = false;
    let unlisten = null;
    let timer = null;
    let resolveAck;
    let rejectAck;
    const promise = new Promise((resolve, reject) => {
      resolveAck = resolve;
      rejectAck = reject;
    });
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (unlisten) unlisten();
      unlisten = null;
    };
    unlisten = await listen(`ole-edit-commit-${sessionToken}`, (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveAck(event.payload);
    });
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectAck(new Error("OLE_EDIT_COMMIT_ACK_TIMEOUT"));
    }, 30000);
    return {
      promise,
      cancel: () => {
        if (settled) return;
        settled = true;
        cleanup();
      },
    };
  }

  async _saveOleEditOnly(latex) {
    const isDisplay = officeInsertModeIsDisplay(this.getFormulaInsertMode());
    const sessionToken = this._oleSessionToken;
    if (!sessionToken) {
      this.showToast("No active OLE session");
      return;
    }

    // Look up session data from Map
    const sessionData = this._oleSessions?.get(sessionToken);
    const oldPayloadJson = sessionData?.payloadJson;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { emit } = await import("@tauri-apps/api/event");
      const omml = await invoke("latex_to_omml", { latex });

      // P0-6: Regenerate preview — abort save if preview generation fails.
      // Never allow "new LaTeX + old preview" to be saved.
      let renderedSvg = null;
      let pngBase64Ole = null;
      let widthPtOle = 0;
      let heightPtOle = 0;
      try {
        const rendered = await this._renderLatexSvg(latex, isDisplay);
        renderedSvg = rendered.svg;
        widthPtOle = rendered.widthPt;
        heightPtOle = rendered.heightPt;
        pngBase64Ole = await this._svgToPngBase64(
          rendered.svg,
          rendered.widthPt,
          rendered.heightPt,
        );
      } catch (e) {
        Logger.error("[OLE] Preview regeneration failed — aborting save:", e);
        this.showToast("预览生成失败，无法保存公式");
        return;
      }

      let formulaPayload = {
        formulaId:
          sessionData?.formulaId || this._oleFormulaId || crypto.randomUUID(),
        latex: latex,
        omml: omml,
        display: isDisplay ? "block" : "inline",
        revision: (sessionData?.revision ?? oldPayloadJson?.revision ?? 0) + 1,
        storageMode: "ole",
        render: {
          svg: renderedSvg,
          png: pngBase64Ole,
          widthPt: widthPtOle,
          heightPt: heightPtOle,
        },
      };

      if (oldPayloadJson) {
        formulaPayload = {
          ...oldPayloadJson,
          ...formulaPayload,
        };
      }

      const commitWaiter = await this._createOleCommitWaiter(sessionToken);
      let ack;
      try {
        await emit(`ole-edit-result-${sessionToken}`, {
          action: "save",
          formula: formulaPayload,
        });
        ack = await commitWaiter.promise;
      } catch (error) {
        commitWaiter.cancel();
        throw error;
      }
      if (!ack?.success) {
        const error = new Error(ack?.errorCode || "OLE_EDIT_COMMIT_FAILED");
        error.hresult = ack?.hresult;
        throw error;
      }

      // Clear edit state only after the native object confirms its commit.
      this._oleSessions?.delete(sessionToken);
      this._oleSessionToken = null;
      this._oleFormulaId = null;
      this.showToast("公式已更新");
      this.addHistoryItem(latex);
    } catch (e) {
      Logger.error("[OLE] Save failed:", e);
      this.showToast(`OLE 保存失败: ${e.message}`);
    }
  }

  async waitForEcosystemAction(actionId, timeoutMs = 15000) {
    const { invoke } = await import("@tauri-apps/api/core");
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const record = await invoke("get_ecosystem_action_status_internal", {
        actionId,
      });

      const status = String(record?.status || "").toLowerCase();

      if (status === "completed") {
        return record;
      }

      if (
        status === "failed" ||
        status === "canceled" ||
        status === "expired"
      ) {
        const error = new Error(
          record?.error?.message || `Ecosystem action ${status}`,
        );
        error.code =
          record?.error?.code || `ECOSYSTEM_ACTION_${status.toUpperCase()}`;
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const error = new Error(
      "目标插件未在规定时间内确认插入。请确认插件在线且存在活动编辑器。",
    );
    error.code = "ECOSYSTEM_ACTION_TIMEOUT";
    throw error;
  }

  /** Push formula to an ecosystem plugin (VS Code, Obsidian, Browser, WPS). */
  async insertToEcosystem() {
    const latex = this.editor.getLatex();

    if (!latex) {
      this.showStatus("请先输入公式");
      return;
    }

    const container = document.getElementById("ecosystemHostSelector");
    const trigger = container?.querySelector(".custom-select-trigger");

    const target = trigger?.dataset?.value || "";
    const targetClientId = trigger?.dataset?.clientId || "";

    if (!target || !targetClientId) {
      this.showToast("请先选择一个当前在线的目标插件");
      return;
    }

    const mode = normalizeOfficeInsertMode(this.getFormulaInsertMode());
    const display = officeInsertModeIsDisplay(mode);

    const action =
      target === "browser"
        ? {
            type: "InsertFormulaIntoBrowser",
            latex,
            display,
            mode,
            format: "markdown",
            displayMode: display ? "display" : "inline",
            insertionFormat: display ? "dollar-display" : "dollar-inline",
          }
        : {
            type: "InsertFormula",
            latex,
            display,
            mode,
            format: "markdown",
          };

    try {
      const { invoke } = await import("@tauri-apps/api/core");

      const actionId = await invoke("push_ecosystem_action_internal", {
        request: {
          target,
          targetClientId,
          action,
        },
      });

      this.showToast("已加入发送队列，等待目标插件确认...");

      await this.waitForEcosystemAction(actionId, 20000);

      this.showToast(`公式已成功插入 ${target}`);
      this.addHistoryItem(latex);
    } catch (error) {
      const code = error?.code ? `[${error.code}] ` : "";
      this.showToast(`${code}发送失败：${error?.message || String(error)}`);
    }
  }

  async cancelOleEdit() {
    // Emit cancel to any active OLE session
    if (this._oleSessionToken) {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit(`ole-edit-result-${this._oleSessionToken}`, {
          action: "cancel",
        });
      } catch (e) {
        Logger.error("Failed to cancel OLE edit:", e);
      }
      // Clean up session from Map
      this._oleSessions?.delete(this._oleSessionToken);
      this._oleSessionToken = null;
      this._oleFormulaId = null;
    }
  }

  /** @deprecated Use this.formulaSvgRenderer.renderFormulaSvg() instead. */
  async _renderLatexSvg(latex, display) {
    const result = await this.formulaSvgRenderer.renderFormulaSvg(latex, {
      display,
    });
    return {
      svg: result.svg,
      widthPt: result.widthPt,
      heightPt: result.heightPt,
    };
  }

  /** @deprecated Use this.formulaSvgRenderer.renderFormulaPng() instead. */
  async _svgToPngBase64(svg, widthPt, heightPt) {
    const result = await this.formulaSvgRenderer.renderSvgPng(
      svg,
      widthPt,
      heightPt,
      { targetDpi: 300 },
    );
    return result.pngDataUrl.split(",")[1];
  }

  async loadFromWord() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // Get selected session from dropdown
      const sessionId = this._selectedSessionId;
      if (!sessionId) {
        this.showToast("请先选择目标 Office 宿主");
        return;
      }

      const session = this._sessions.find((s) => s.session_id === sessionId);
      if (!session) {
        this.showToast("所选会话不存在");
        return;
      }

      this.showToast(`正在从 ${session.host_type} 读取选区...`);
      await invoke("native_office_request_read_selection", { sessionId });
    } catch (e) {
      Logger.error("loadFromWord failed:", e);
      this.showToast("加载失败: " + (e.message || e));
    }
  }

  /** Check if the selected Office session supports a given capability. */
  supportsOfficeCapability(cap) {
    const session = this._sessions?.find(
      (s) => s.session_id === this._selectedSessionId,
    );
    if (!session) return false;
    const aliases = {
      insert_table: ["insert_table", "insertTable"],
      read_table: ["read_table", "readTable"],
      insert_formula: ["insert_formula", "insertFormula"],
      replace_formula: ["replace_formula", "replaceFormula"],
      read_selection: ["read_selection", "readSelection"],
    };
    const keys = aliases[cap] || [cap];
    const caps = session.capabilities;
    if (Array.isArray(caps) && caps.length > 0) {
      return caps.some((c) => keys.includes(c));
    }
    // Fallback only when capabilities array is empty or missing
    const host = String(session.host_type || "").toLowerCase();
    return this._supportsCapFallback(host, cap);
  }

  /** Fallback when VSTO did not report capabilities (matching Rust HostType::default_capabilities()). */
  _supportsCapFallback(host, cap) {
    if (host === "word") {
      return [
        "insert_formula",
        "replace_formula",
        "read_selection",
        "insert_table",
        "read_table",
      ].includes(cap);
    }
    if (host === "excel" || host === "powerpoint") {
      return ["insert_formula", "replace_formula", "read_selection"].includes(
        cap,
      );
    }
    return false;
  }

  async insertTableToWord() {
    const sessionId = this._selectedSessionId;
    if (!sessionId) {
      this.showToast("请先选择目标 Office 宿主");
      return;
    }
    if (!this.supportsOfficeCapability("insert_table")) {
      this.showToast("当前 Office 宿主暂不支持表格插入");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const latex = this.editor?.getLatex();
      if (!latex) {
        this.showToast("编辑器内容为空");
        return;
      }

      // Parse LaTeX tabular into TablePayload
      const table = this._parseLatexTableToPayload(latex);
      if (!table) {
        this.showToast("未能解析 LaTeX 表格，请使用 \\begin{tabular} 格式");
        return;
      }

      await invoke("native_office_insert_table", {
        sessionId,
        tableJson: JSON.stringify(table),
      });
      this.showToast("表格已发送");
    } catch (e) {
      this.showToast("插入表格失败: " + (e.message || e));
    }
  }

  /**
   * Parse a LaTeX tabular environment into a TablePayload JSON structure.
   * Supports: \\begin{tabular}{...} ... \\end{tabular}
   * Handles: \\hline, \\cline, \\multicolumn{n}{...}{content}, \\multirow{n}{*}{content}
   */
  async _parseLatexTableToPayload(latex) {
    const { invoke } = await import("@tauri-apps/api/core");
    // Find \begin{tabular} ... \end{tabular}
    const beginMatch = latex.match(/\\begin\{tabular\}/);
    if (!beginMatch) return null;
    const endMatch = latex.match(/\\end\{tabular\}/);
    if (!endMatch) return null;

    const startIdx = beginMatch.index + beginMatch[0].length;
    const endIdx = endMatch.index;
    let body = latex.substring(startIdx, endIdx).trim();

    // Skip column spec {|c|c|...}
    const braceEnd = body.indexOf("}");
    if (braceEnd !== -1) {
      body = body.substring(braceEnd + 1).trim();
    }

    const rows = [];
    // Split by \\ (row separator) instead of newline, so inline tabular
    // like "a & b \\ c & d" is parsed correctly.
    const rowTexts = body
      .replace(/\\hline|\\toprule|\\midrule|\\bottomrule/g, "")
      .split(/\\\\(?:\s*\[[^\]]*\])?/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (let rowText of rowTexts) {
      let line = rowText.trim();
      // Skip \hline, \cline, \toprule, \midrule, \bottomrule, empty
      if (
        !line ||
        line.startsWith("\\hline") ||
        line.startsWith("\\cline") ||
        line.startsWith("\\toprule") ||
        line.startsWith("\\midrule") ||
        line.startsWith("\\bottomrule")
      ) {
        continue;
      }

      // Split by & for cells
      const cellTexts = line.split("&").map((t) => t.trim());

      const cells = cellTexts.map((text) => {
        let colspan = 1;
        let rowspan = 1;
        let content = text;

        // Parse \multicolumn{n}{...}{content}
        const mcMatch = content.match(
          /\\multicolumn\{(\d+)\}\{[^}]*\}\{(.+)\}/,
        );
        if (mcMatch) {
          colspan = parseInt(mcMatch[1]) || 1;
          content = mcMatch[2];
        }

        // Parse \multirow{n}{*}{content}
        const mrMatch = content.match(/\\multirow\{(\d+)\}\{\*?\}\{(.+)\}/);
        if (mrMatch) {
          rowspan = parseInt(mrMatch[1]) || 1;
          content = mrMatch[2];
        }

        // Check if content is a formula ($...$)
        const formulaMatch = content.match(/^\$(.+)\$$/);
        if (formulaMatch) {
          const formulaId = crypto.randomUUID();
          return {
            rowspan,
            colspan,
            inlines: [
              {
                type: "formula",
                formulaRef: formulaId,
                formula: { latex: formulaMatch[1] },
              },
            ],
          };
        }

        return {
          rowspan,
          colspan,
          inlines: [{ type: "text", text: content }],
        };
      });

      if (cells.length > 0) {
        rows.push({ cells });
      }
    }

    if (rows.length === 0) return null;

    // Build formulas dictionary with OMML conversion.
    // Each formula cell's LaTeX is converted to OMML via the Rust backend,
    // so Word's TableConverter can insert it as native OMML instead of plain text.
    const formulas = {};
    const ommlPromises = [];
    for (const row of rows) {
      for (const cell of row.cells || []) {
        for (const inline of cell.inlines || []) {
          if (
            inline.type === "formula" &&
            inline.formulaRef &&
            inline.formula?.latex
          ) {
            const ref = inline.formulaRef;
            const latexStr = inline.formula.latex;
            const p = invoke("latex_to_omml", { latex: latexStr })
              .then((omml) => {
                formulas[ref] = {
                  schemaVersion: 3,
                  formulaId: ref,
                  latex: latexStr,
                  omml: omml || "",
                  display: "inline",
                  revision: 0,
                  storageMode: "native",
                };
              })
              .catch(() => {
                // Fallback: omml empty (VSTO will use plain LaTeX)
                formulas[ref] = {
                  schemaVersion: 3,
                  formulaId: ref,
                  latex: latexStr,
                  omml: "",
                  display: "inline",
                  revision: 0,
                  storageMode: "native",
                };
              });
            ommlPromises.push(p);
          }
        }
      }
    }
    await Promise.all(ommlPromises);

    return {
      tableId: crypto.randomUUID(),
      table: { rows },
      formulas: Object.keys(formulas).length > 0 ? formulas : undefined,
    };
  }

  async readTableFromWord() {
    const sessionId = this._selectedSessionId;
    if (!sessionId) {
      this.showToast("请先选择目标 Office 宿主");
      return;
    }
    if (!this.supportsOfficeCapability("read_table")) {
      this.showToast("当前 Office 宿主暂不支持表格读取");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("native_office_request_read_table", { sessionId });
      this.showToast("表格读取请求已发送");
    } catch (e) {
      this.showToast("读取表格失败: " + (e.message || e));
    }
  }

  updateOfficeInsertButton() {
    const officePlatform = this.platforms.find((p) => p.id === "office");
    const enabled =
      officePlatform?.enabled && this.settingsManager.get("officeEnabled");
    Logger.info(
      `[Office] updateOfficeInsertButton → enabled=${enabled}, platform=${officePlatform?.enabled}, setting=${this.settingsManager.get("officeEnabled")}`,
    );
    const btn = document.getElementById("insertToWord");
    if (btn) btn.style.display = enabled ? "" : "none";
    const loadBtn = document.getElementById("loadFromWord");
    if (loadBtn) loadBtn.style.display = enabled ? "" : "none";

    // Table buttons: use capability check (Word supports tables, Excel/PPT do not)
    const canInsertTable =
      enabled && this.supportsOfficeCapability("insert_table");
    const canReadTable = enabled && this.supportsOfficeCapability("read_table");
    const tableInsert = document.getElementById("insertTableBtn");
    if (tableInsert) tableInsert.style.display = canInsertTable ? "" : "none";
    const tableRead = document.getElementById("readTableBtn");
    if (tableRead) tableRead.style.display = canReadTable ? "" : "none";

    // Show ecosystem controls if any non-Office plugin platform is enabled
    const hasEcoPlatform = this.platforms.some(
      (p) =>
        p.enabled && ["vscode", "obsidian", "browser", "wps"].includes(p.id),
    );
    const ecoSelector = document.getElementById("ecosystemHostSelector");
    const ecoBtn = document.getElementById("insertToEcosystem");
    if (ecoSelector) ecoSelector.style.display = hasEcoPlatform ? "" : "none";
    if (ecoBtn) ecoBtn.style.display = hasEcoPlatform ? "" : "none";
  }

  updateOfficeIntegrationHint(mode) {
    const hint = document.getElementById("officeIntegrationModeHint");
    if (!hint) return;
    const key = `officeIntegration.hint.${mode}`;
    hint.textContent = t(key);
  }

  async checkOleStatus() {
    const statusEl = document.getElementById("officeOleStatus");
    const installBtn = document.getElementById("officeOleInstallBtn");
    const uninstallBtn = document.getElementById("officeOleUninstallBtn");
    const actionRow = document.getElementById("officeOleActionRow");
    if (!statusEl) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await this.withTimeout(
        invoke("native_office_ole_status"),
        8000,
        "OLE status",
      );
      const health = status?.health || "Unknown";
      const detail = status?.detail || "";
      this._oleStatus = {
        available: status?.available === true && health === "Registered",
        health,
        errorCode: status?.errorCode || null,
        detail,
      };
      if (health === "Registered") {
        statusEl.textContent = "OLE 公式对象: 已注册";
        statusEl.className = "settings-hint success";
        if (actionRow) actionRow.style.display = "";
        if (uninstallBtn) uninstallBtn.style.display = "";
        if (installBtn) installBtn.style.display = "none";
      } else if (health === "NotInstalled") {
        statusEl.textContent =
          "OLE 公式对象: 未安装。如需双击编辑功能，请点击下方安装。";
        statusEl.className = "settings-hint";
        if (actionRow) actionRow.style.display = "";
        if (installBtn) installBtn.style.display = "";
        if (uninstallBtn) uninstallBtn.style.display = "none";
      } else if (health === "RegisteredButBroken") {
        statusEl.textContent = "OLE 注册已损坏，可尝试重新安装。" + detail;
        statusEl.className = "settings-hint error";
        if (actionRow) actionRow.style.display = "";
        if (installBtn) installBtn.style.display = "";
        if (uninstallBtn) uninstallBtn.style.display = "none";
      } else if (health === "NotSupported") {
        statusEl.textContent = "OLE 公式对象: 仅在 Windows 可用";
        statusEl.className = "settings-hint";
        if (actionRow) actionRow.style.display = "none";
      } else {
        statusEl.textContent =
          "OLE 状态: " + health + (detail ? " - " + detail : "");
        statusEl.className = "settings-hint";
        if (actionRow) actionRow.style.display = "none";
      }
    } catch (error) {
      this._oleStatus = {
        available: false,
        health: "Unknown",
        errorCode: "OLE_STATUS_QUERY_FAILED",
        detail: error?.message || String(error),
      };
      statusEl.textContent = t("common.unknown");
      statusEl.className = "settings-hint";
      if (actionRow) actionRow.style.display = "none";
    }
  }

  updateMdCopyButton() {
    const hasMdPlatform = this.platforms.some((p) => p.enabled && p.copyAsMd);
    const btn = document.getElementById("copyMd");
    if (btn) {
      btn.style.display = hasMdPlatform ? "" : "none";
    }
  }

  updateFontStyle(style) {
    Logger.info(`fontStyle: ${style}`);

    const previewHost = document.getElementById("previewHost");
    if (previewHost) {
      previewHost.style.fontStyle = style === "italic" ? "italic" : "normal";
      previewHost.style.fontWeight = style === "bold" ? "bold" : "normal";
      previewHost.style.fontFamily = style === "roman" ? "serif" : "";
    }

    this.showStatus(`字体样式: ${style}`);
  }

  updateFontColor(color) {
    Logger.info(`fontColor: ${color}`);

    const previewHost = document.getElementById("previewHost");
    if (previewHost) {
      previewHost.style.color = color;
    }

    this.showStatus(`颜色已更新`);
  }

  showStatus(message) {
    Logger.debug(`showStatus: ${message}`);
    const statusText = document.getElementById("statusText");
    if (statusText) {
      statusText.textContent = message;
      setTimeout(() => {
        statusText.textContent = "就绪";
      }, 2000);
    }
  }

  showToast(message, duration = 1500) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, duration);
  }

  // ═══════════════════════════════════════════
  // Platform Management
  // ═══════════════════════════════════════════
  platforms = [
    {
      id: "office",
      name: "Microsoft Office",
      desc: "Word / PowerPoint",
      icon: "/icons/platforms/office.svg",
      color: "#d83b01",
      enabled: false,
      format: "omml",
      shortcut: null,
    },
    {
      id: "obsidian",
      name: "Obsidian",
      desc: "Markdown 笔记编辑器",
      icon: "/icons/platforms/obsidian.svg",
      color: "#7c3aed",
      enabled: false,
      format: "markdown_inline",
      copyAsMd: true,
      shortcut: null,
    },
    {
      id: "vscode",
      name: "VS Code",
      desc: "代码编辑器",
      icon: "/icons/platforms/vscode.svg",
      color: "#007acc",
      enabled: false,
      format: "latex",
      shortcut: null,
    },
    {
      id: "wps",
      name: "WPS Office",
      desc: "办公套件（自动检测）",
      icon: "/icons/platforms/wps.svg",
      color: "#00a651",
      enabled: false,
      format: "omml",
      copyAsMd: true,
      shortcut: null,
    },
    {
      id: "typora",
      name: "Typora",
      desc: "剪贴板集成（复制 Markdown 公式后手动粘贴）",
      icon: "/icons/platforms/typora.svg",
      color: "#4a90d9",
      enabled: false,
      format: "latex",
      shortcut: null,
    },
    {
      id: "notion",
      name: "Notion",
      desc: "剪贴板集成（复制 Markdown 公式后手动粘贴）",
      icon: "/icons/platforms/notion.svg",
      color: "#000000",
      enabled: false,
      format: "latex",
      copyAsMd: true,
      shortcut: null,
    },
    {
      id: "libreoffice",
      name: "LibreOffice",
      desc: "开源办公套件",
      icon: "/icons/platforms/libreoffice.svg",
      color: "#18a303",
      enabled: false,
      format: "mathml",
      copyAsMd: true,
      shortcut: null,
    },
  ];

  loadPlatforms() {
    try {
      const saved = JSON.parse(localStorage.getItem("platforms") || "[]");
      this.platforms.forEach((p) => {
        const s = saved.find((x) => x.id === p.id);
        if (s) {
          p.enabled = s.enabled;
          p.shortcut = s.shortcut;
        }
      });
    } catch (error) {
      Logger.warn(
        `[Platforms] operation=load host=desktop formulaId=<none> error=${error?.message || error}`,
      );
    }
  }

  savePlatforms() {
    const data = this.platforms.map((p) => ({
      id: p.id,
      enabled: p.enabled,
      shortcut: p.shortcut,
    }));
    localStorage.setItem("platforms", JSON.stringify(data));
  }

  syncOfficeSettingsToggle() {
    const officePlatform = this.platforms.find((p) => p.id === "office");
    const officeToggle = document.getElementById("officeEnabledToggle");
    if (officeToggle && officePlatform) {
      officeToggle.checked = officePlatform.enabled;
      this.settingsManager.set("officeEnabled", officePlatform.enabled);
    }
  }

  _officeStatusCache = null;

  async getOfficeStatus() {
    if (this._officeStatusCache) return this._officeStatusCache;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      this._officeStatusCache = await invoke("detect_office");
      return this._officeStatusCache;
    } catch (e) {
      Logger.warn("Office detection failed:", e);
      return {
        installed: false,
        word: { available: false },
        powerpoint: { available: false },
        visio: { available: false },
      };
    }
  }

  clearOfficeStatusCache() {
    this._officeStatusCache = null;
  }

  async getPlatformIntegrationStatus(platformId) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke("check_platform_integration", { platformId });
    } catch (e) {
      Logger.warn(`Platform status failed for ${platformId}:`, e);
      return { success: false, message: e?.message || String(e) };
    }
  }

  async renderPlatformList(options = {}) {
    const { refreshStatus = false } = options;
    const listEl = document.getElementById("platformList");
    if (!listEl) return;

    const officeStatus = refreshStatus
      ? await this.getOfficeStatus()
      : this._officeStatusCache;
    const officePlatform = this.platforms.find((p) => p.id === "office");
    const officeIntegrationStatus =
      refreshStatus && officePlatform
        ? await this.getPlatformIntegrationStatus("office")
        : null;
    if (officePlatform && officeStatus) {
      const parts = [];
      if (officeStatus.installed) {
        if (officeStatus.word && officeStatus.word.available)
          parts.push("Word");
        if (officeStatus.excel && officeStatus.excel.available)
          parts.push("Excel");
        if (officeStatus.powerpoint && officeStatus.powerpoint.available)
          parts.push("PowerPoint");
        if (officeStatus.visio && officeStatus.visio.available)
          parts.push("Visio");
        officePlatform.desc = parts.join(" / ") || "Office detected";
      } else {
        officePlatform.desc = "未检测到 Office";
      }
    }

    if (officePlatform && officeIntegrationStatus) {
      const detectedHosts =
        officeStatus?.installed && officePlatform.desc !== "未检测到 Office"
          ? officePlatform.desc
          : "";
      if (officeIntegrationStatus.success) {
        officePlatform.desc =
          detectedHosts ||
          officeIntegrationStatus.message ||
          "Office 集成已安装";
      } else if (officeIntegrationStatus.message) {
        officePlatform.desc = detectedHosts
          ? `${detectedHosts} · ${officeIntegrationStatus.message}`
          : officeIntegrationStatus.message;
      }
      Logger.info(
        "[Office] Generic integration status:",
        officeIntegrationStatus,
      );
    }

    if (refreshStatus) {
      const wpsPlatform = this.platforms.find((p) => p.id === "wps");
      if (wpsPlatform) {
        const wpsStatus = await this.getPlatformIntegrationStatus("wps");
        if (wpsStatus.success) {
          wpsPlatform.desc = "JSAddIn · 已安装";
        } else if (wpsStatus.message) {
          wpsPlatform.desc = wpsStatus.message;
        }
      }

      // Check ecosystem client status for VS Code, Obsidian, Browser
      const ecosystemTargets = ["vscode", "obsidian", "browser"];
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const clients = await invoke("list_ecosystem_clients_internal");
        for (const id of ecosystemTargets) {
          const p = this.platforms.find((pl) => pl.id === id);
          if (p && p.enabled) {
            const client = clients.find(
              (c) =>
                c.clientType === id ||
                (c.clientId && c.clientId.startsWith(id)),
            );
            if (client) {
              const lastSeen = new Date(client.lastSeen).getTime();
              const now = Date.now();
              const connected = now - lastSeen < 30000;
              p.desc = connected
                ? `已连接 (${client.clientName || id})`
                : "未连接";
            } else {
              p.desc = "等待插件连接...";
            }
          }
        }
      } catch (error) {
        Logger.warn("Internal ecosystem status command failed:", error);
        for (const id of ecosystemTargets) {
          const p = this.platforms.find((pl) => pl.id === id);
          if (p) p.desc = "内部状态读取失败";
        }
      }
    }

    listEl.innerHTML = this.platforms
      .map((p) => {
        const busy = this.platformOperations.has(p.id);
        return `
      <div class="platform-item ${busy ? "is-busy" : ""}">
        <div class="platform-icon" style="background:${p.color}15;">
          <img src="${p.icon}" alt="${p.name}" style="width:18px;height:18px;">
        </div>
        <div class="platform-info">
          <div class="platform-name">${p.name}</div>
          <div class="platform-desc">${busy ? "处理中..." : p.desc}${p.enabled ? " · 已启用" : ""}</div>
        </div>
        <label class="custom-toggle ${busy ? "is-busy" : ""}">
          <input type="checkbox" class="platform-toggle" data-platform="${p.id}" ${p.enabled ? "checked" : ""} ${busy ? "disabled" : ""}>
          <span class="toggle-track"></span>
        </label>
      </div>
    `;
      })
      .join("");

    listEl.querySelectorAll(".platform-toggle").forEach((toggle) => {
      toggle.addEventListener("change", async (e) => {
        const platformId = e.target.dataset.platform;
        const platform = this.platforms.find((p) => p.id === platformId);
        if (platform) {
          const ok = await this.setPlatformEnabled(
            platformId,
            e.target.checked,
          );
          if (!ok) e.target.checked = platform.enabled;
        }
      });
    });
  }

  /** Run a promise with a timeout. If it doesn't resolve within ms, reject. */
  async withTimeout(promise, ms, label) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} timeout after ${ms}ms`)),
            ms,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async setPlatformEnabled(platformId, requestedEnabled) {
    const platform = this.platforms.find((p) => p.id === platformId);
    if (!platform) return false;
    if (this.platformOperations.has(platformId)) return false;

    const previousEnabled = platform.enabled;
    platform.enabled = requestedEnabled;
    this.platformOperations.add(platformId);

    let ok = false;
    try {
      await this.renderPlatformList();

      if (requestedEnabled) {
        ok = await this.withTimeout(
          this.registerPlatform(platform),
          30000,
          `${platformId} install`,
        );
      } else {
        ok = await this.withTimeout(
          this.unregisterPlatform(platform),
          30000,
          `${platformId} uninstall`,
        );
      }

      if (!ok) {
        platform.enabled = previousEnabled;
      }
    } catch (error) {
      Logger.error("Platform operation failed:", error);
      this.showToast("操作超时或失败: " + (error?.message || error));
      platform.enabled = previousEnabled;
      ok = false;
    } finally {
      this.savePlatforms();
      this.platformOperations.delete(platformId);

      // 先立即刷新一次 UI，确保"处理中..."消失。
      await this.renderPlatformList({ refreshStatus: false });

      // 再做带超时的真实状态刷新，失败只显示警告，不影响 busy 释放。
      try {
        if (platformId === "office" || platformId === "wps") {
          await this.withTimeout(
            this.renderPlatformList({ refreshStatus: true }),
            12000,
            `${platformId} status refresh`,
          );
        }
      } catch (error) {
        Logger.error("Platform status refresh failed:", error);
        this.showToast("状态刷新超时，请重启应用后再查看真实状态");
      }

      if (platformId === "office") {
        const officeToggle = document.getElementById("officeEnabledToggle");
        if (officeToggle) {
          officeToggle.checked = platform.enabled;
        }
        this.settingsManager.set("officeEnabled", platform.enabled);
      }

      this.updateOfficeInsertButton();
      this.updateMdCopyButton();
    }

    return ok;
  }

  platformSupport = {
    office: { ready: true, message: "" },
    obsidian: { ready: true, message: "Obsidian 插件开发中，敬请期待" },
    vscode: { ready: true, message: "" },
    wps: { ready: true, message: "" },
    typora: {
      ready: true,
      message: "剪贴板集成：复制 Markdown 公式后粘贴到 Typora",
    },
    notion: {
      ready: true,
      message: "剪贴板集成：复制 Markdown 公式后粘贴到 Notion",
    },
    libreoffice: { ready: false, message: "LibreOffice 扩展开发中，敬请期待" },
  };

  async registerPlatform(platform) {
    Logger.info(`Registering platform: ${platform.name}`);
    const support = this.platformSupport[platform.id];
    if (support && !support.ready) {
      this.showToast(support.message);
      platform.enabled = false;
      this.savePlatforms();
      return false;
    }

    if (
      platform.id === "office" ||
      platform.id === "wps" ||
      platform.id === "obsidian"
    ) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (platform.id === "obsidian") {
          // Show vault selection dialog before installation
          const vaultPath = await this._showObsidianVaultDialog();
          if (vaultPath === null) {
            platform.enabled = false;
            this.savePlatforms();
            return false;
          }
          const result = await invoke("install_obsidian_to_vault", {
            vaultPath,
          });
          if (result.success) {
            this.showToast("Obsidian 插件已安装到 vault，请重启 Obsidian 启用");
            return true;
          } else {
            this.showToast("安装失败: " + (result.message || result.error));
            platform.enabled = false;
            return false;
          }
        }
        if (platform.id === "office") {
          const result = await invoke("install_platform_integration", {
            platformId: "office",
          });
          Logger.info(
            `[Office] install result: success=${result.success}, mode=${result.mode}, message=${result.message}`,
          );
          this.clearOfficeStatusCache();
          if (result.success) {
            this.showToast(
              result.message || "Office 集成已启用，请重启 Office 应用。",
            );
            return true;
          }

          this.showToast("启用失败: " + (result.message || result.error));
          platform.enabled = false;
          return false;
        }

        const result = await invoke("install_platform_integration", {
          platformId: platform.id,
        });
        this.clearOfficeStatusCache();
        if (result.success) {
          this.showToast(`${platform.name} 插件已安装，请重启对应应用加载插件`);
          return true;
        } else {
          this.showToast("安装失败: " + result.message);
          platform.enabled = false;
          return false;
        }
      } catch (e) {
        Logger.error("Platform registration failed:", e);
        this.showToast("安装失败: " + e.message);
        platform.enabled = false;
        return false;
      }
    }

    this.showToast(`${platform.name} 已注册`);
    return true;
  }

  async unregisterPlatform(platform) {
    Logger.info(`Unregistering platform: ${platform.name}`);

    if (platform.id === "office") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke("uninstall_platform_integration", {
          platformId: "office",
        });
        this.clearOfficeStatusCache();
        if (result.success) {
          this.showToast("Office 插件已停用，请重启 Office 生效");
          return true;
        } else {
          this.showToast("停用失败: " + (result.message || result.error));
          return false;
        }
      } catch (e) {
        Logger.error("Platform unregister failed:", e);
        this.showToast("卸载失败: " + e.message);
        return false;
      }
    } else if (platform.id === "wps" || platform.id === "obsidian") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke("uninstall_platform_integration", {
          platformId: platform.id,
        });
        this.clearOfficeStatusCache();
        if (result.success) {
          this.showToast(`${platform.name} 插件已卸载，请重启对应应用`);
          return true;
        } else {
          this.showToast("卸载失败: " + result.message);
          return false;
        }
      } catch (e) {
        Logger.error("Platform unregister failed:", e);
        this.showToast("卸载失败: " + e.message);
        return false;
      }
    }

    this.showToast(`${platform.name} 已取消注册`);
    return true;
  }

  ecosystemTargetFromClient(client) {
    const type = String(client?.clientType || "").toLowerCase();
    const id = String(client?.clientId || "").toLowerCase();

    if (type === "obsidian" || id.startsWith("obsidian-")) return "obsidian";
    if (type === "vscode" || id.startsWith("vscode-")) return "vscode";

    if (
      type === "browser-extension" ||
      type === "browser" ||
      id.startsWith("browser-")
    ) {
      return "browser";
    }

    if (type === "wps" || id.startsWith("latexsnipper-wps-")) {
      return "wps";
    }

    return null;
  }

  ecosystemClientIsFresh(client, ttlMs = 30000) {
    const lastSeen = Date.parse(client?.lastSeen || "");
    return Number.isFinite(lastSeen) && Date.now() - lastSeen < ttlMs;
  }

  async refreshEcosystemTargetSelector(providedClients) {
    let clients = providedClients;
    if (!clients) {
      const { invoke } = await import("@tauri-apps/api/core");
      clients = await invoke("list_ecosystem_clients_internal");
    }

    const dropdown = document.getElementById("ecosystemTargetHost");
    const container = document.getElementById("ecosystemHostSelector");
    const trigger = container?.querySelector(".custom-select-trigger");

    if (!dropdown || !trigger) return;

    const previousClientId =
      trigger.dataset.clientId || this._selectedEcosystemClientId || "";

    const freshClients = (clients || []).filter((client) => {
      return (
        this.ecosystemClientIsFresh(client) &&
        this.ecosystemTargetFromClient(client)
      );
    });

    dropdown.replaceChildren();
    const options = [];

    for (const client of freshClients) {
      const target = this.ecosystemTargetFromClient(client);
      const option = document.createElement("div");

      option.className = "custom-select-option";
      option.dataset.value = target;
      option.dataset.clientId = client.clientId;
      option.textContent = client.clientName || client.clientId;

      dropdown.appendChild(option);
      options.push(option);
    }

    // Auto-select: keep previous selection if still online, otherwise select first
    const selectedOption =
      options.find((opt) => opt.dataset.clientId === previousClientId) ||
      options[0] ||
      null;

    if (selectedOption) {
      for (const option of options) {
        option.classList.toggle("selected", option === selectedOption);
      }

      const target = selectedOption.dataset.value || "";
      const clientId = selectedOption.dataset.clientId || "";

      trigger.querySelector("span").textContent =
        selectedOption.textContent || clientId;
      trigger.dataset.value = target;
      trigger.dataset.clientId = clientId;
      this._selectedEcosystemTarget = target;
      this._selectedEcosystemClientId = clientId;
    } else {
      trigger.dataset.value = "";
      trigger.dataset.clientId = "";
      this._selectedEcosystemTarget = "";
      this._selectedEcosystemClientId = "";
      trigger.querySelector("span").textContent = "暂无在线插件";
    }
  }

  async refreshEcosystemClients() {
    let clients = null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      clients = await invoke("list_ecosystem_clients_internal");
      const listEl = document.getElementById("ecosystemClientList");
      if (listEl) {
        if (!clients || clients.length === 0) {
          listEl.innerHTML =
            '<span style="color:var(--muted);">暂无已连接客户端</span>';
        } else {
          const svgIcons = {
            vscode:
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M17.5 2.5L8 12l9.5 9.5 2-2L12 12l7.5-7.5-2-2z" fill="currentColor"/><path d="M7 6.5L2 12l5 5.5 2-2L6 12l3-3.5-2-2z" fill="currentColor"/></svg>',
            obsidian:
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 7h8M8 11h6M8 15h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
            browser:
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" stroke="currentColor" stroke-width="2"/></svg>',
          };
          const defaultIcon =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';

          listEl.innerHTML = clients
            .map((c) => {
              const lastSeen = new Date(c.lastSeen).toLocaleString("zh-CN");
              const isFresh = this.ecosystemClientIsFresh(c);
              const statusStyle = isFresh
                ? "color:var(--muted)"
                : "color:#ef4444";
              const statusText = isFresh ? lastSeen : `${lastSeen} (离线)`;
              const svgIcon = svgIcons[c.clientType] || defaultIcon;
              return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-color);${isFresh ? "" : "opacity:0.6;"}">
              <span style="width:16px;height:16px;display:flex;align-items:center;">${svgIcon}</span>
              <span style="flex:1;"><strong>${c.clientName}</strong> (${c.clientId})</span>
              <span style="${statusStyle};font-size:0.75rem;">${statusText}</span>
            </div>`;
            })
            .join("");
        }
      }
    } catch (e) {
      Logger.warn("Failed to list ecosystem clients internally:", e);
      const listEl = document.getElementById("ecosystemClientList");
      if (listEl)
        listEl.textContent = `内部客户端状态读取失败：${e?.message || e}`;
    }

    // Always refresh target selector, even if list update failed
    try {
      await this.refreshEcosystemTargetSelector(clients);
    } catch (e) {
      Logger.warn("Failed to refresh ecosystem target selector:", e);
    }
  }

  /** Show Obsidian vault/plugins selection dialog. Returns detected vault path or null. */
  async _showObsidianVaultDialog() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.id = "obsidianVaultOverlay";
      overlay.innerHTML = `
<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;">
  <div style="background:var(--card-bg,#fff);border-radius:12px;padding:24px;max-width:520px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);font-family:system-ui,-apple-system,sans-serif;">
    <h2 style="margin:0 0 4px;font-size:1.1rem;font-weight:600;color:var(--text,#1a1a1a);">安装 Obsidian 插件</h2>
    <p style="margin:0 0 16px;font-size:0.85rem;color:var(--muted,#888);">输入 Obsidian <strong>插件目录</strong>或 <strong>Vault 目录</strong></p>
    <div style="margin-bottom:12px;">
      <label style="font-size:0.8rem;font-weight:500;color:var(--muted,#888);display:block;margin-bottom:4px;">插件目录路径</label>
      <input id="obsidianVaultInput" type="text" style="width:100%;padding:8px 12px;border:1px solid var(--border-color,#ddd);border-radius:6px;font-size:0.85rem;background:var(--card-bg,#fff);color:var(--text,#1a1a1a);box-sizing:border-box;" placeholder="C:\\Users\\...\\.obsidian\\plugins" />
    </div>
    <p style="font-size:0.78rem;color:var(--muted,#999);margin:0 0 16px;line-height:1.6;">
      如何找到插件目录：打开 Obsidian → 设置 → 社区插件 → 在"已安装插件"右侧点击文件夹图标
      <br>也支持直接输入 Vault 目录（包含 .obsidian 的文件夹）
    </p>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="obsidianCancelBtn" style="padding:8px 20px;border:1px solid var(--border-color,#ddd);border-radius:6px;background:transparent;cursor:pointer;font-size:0.85rem;">取消</button>
      <button id="obsidianConfirmBtn" style="padding:8px 20px;border:none;border-radius:6px;background:var(--accent,#4a6cf7);color:#fff;cursor:pointer;font-size:0.85rem;font-weight:500;">确认安装</button>
    </div>
  </div>
</div>`;
      document.body.appendChild(overlay);

      document.getElementById("obsidianCancelBtn").onclick = () => {
        overlay.remove();
        resolve(null);
      };
      document.getElementById("obsidianConfirmBtn").onclick = () => {
        let val = document.getElementById("obsidianVaultInput").value.trim();
        if (!val) {
          this.showToast("请输入路径");
          return;
        }

        // Accept either plugins folder directly or vault root
        // If path ends with "plugins", assume it's the plugins folder → derive vault path
        if (
          val.replace(/\\/g, "/").endsWith("/.obsidian/plugins") ||
          val.replace(/\\/g, "/").endsWith("/plugins")
        ) {
          // Step up to vault root: remove "/plugins" or "/.obsidian/plugins"
          val = val
            .replace(/\\/g, "/")
            .replace(/\/plugins$/, "")
            .replace(/\/\.obsidian\/plugins$/, "")
            .replace(/\/\.obsidian$/, "");
          val = val.replace(/\//g, "\\"); // restore Windows backslashes
        }

        overlay.remove();
        resolve(val);
      };
    });
  }

  ocrLatex = "";
  bridgeConfig = null;

  async connectBridge() {
    Logger.info("Connecting to LaTeXSnipper Bridge...");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const diagnostics = await invoke("get_bridge_runtime_diagnostics");
      this.bridgeConfig = diagnostics;
      Logger.info(
        `Bridge runtime: http=${diagnostics.httpListening}, https=${diagnostics.httpsListening}`,
      );
      return diagnostics.httpListening || diagnostics.httpsListening;
    } catch (e) {
      Logger.warn("Bridge connection failed:", e.message);
      Logger.warn("Make sure LaTeXSnipper desktop app is running");
      return false;
    }
  }

  async startScreenshot() {
    Logger.info("startScreenshot");
    this.showStatus("正在连接桌面端...");

    const connected = await this.connectBridge();
    if (!connected) {
      this.showStatus("无法连接 LaTeXSnipper，请确保桌面端正在运行");
      return;
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const imageData = await invoke("screenshot_capture");
      const result = await invoke("ocr_recognize", { imageData });
      if (result) {
        this.ocrLatex = result.latex || "";
        const ocrResult = document.getElementById("ocrResult");
        const ocrInsertBtn = document.getElementById("ocrInsertBtn");
        const ocrCopyBtn = document.getElementById("ocrCopyBtn");

        if (ocrResult) ocrResult.textContent = this.ocrLatex || "未识别到公式";
        if (ocrInsertBtn) ocrInsertBtn.disabled = !this.ocrLatex;
        if (ocrCopyBtn) ocrCopyBtn.disabled = !this.ocrLatex;

        this.showStatus(this.ocrLatex ? "识别完成" : "未识别到公式");
        Logger.info(`OCR result: ${this.ocrLatex}`);
      } else {
        const errMsg = "识别失败";
        this.showStatus(errMsg);
        Logger.error("OCR failed:", errMsg);
      }
    } catch (e) {
      Logger.error("Screenshot OCR failed:", e);
      this.showStatus("截图识别失败，请确保桌面端正在运行");
    }
  }

  insertOcrResult() {
    Logger.info(`insertOcrResult: ${this.ocrLatex}`);
    if (this.ocrLatex) {
      this.insertFormula(this.ocrLatex);
      this.switchSection("editor");
    }
  }

  copyOcrResult() {
    Logger.info("copyOcrResult");
    if (this.ocrLatex) {
      this.editor.copyToClipboard(this.ocrLatex);
      this.showStatus("已复制 LaTeX");
    }
  }

  applySettings() {
    const settings = this.settingsManager.settings;
    Logger.debug("Applying settings:", settings);

    const bridgeInput = document.getElementById("bridgeUrlInput");
    if (bridgeInput && settings.bridgeUrl) {
      bridgeInput.value = settings.bridgeUrl;
    }

    this.setFormulaInsertMode(settings.displayMode);

    const officeToggle = document.getElementById("officeEnabledToggle");
    if (officeToggle) {
      officeToggle.checked = settings.officeEnabled;
    }
    const ocrToggle = document.getElementById("ocrEnabledToggle");
    if (ocrToggle) {
      ocrToggle.checked = settings.ocrEnabled;
    }

    this.updateTabVisibility();
  }
}

// ═══════════════════════════════════════════
async function setupBrowserImportInbox(controller) {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const modal = document.getElementById("browserImportsModal");
  const list = document.getElementById("browserImportsList");
  const preview = document.getElementById("browserImportPreview");
  const badge = document.getElementById("browserImportsBadge");
  const button = document.getElementById("browserImportsButton");
  let records = [];

  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };

  async function refresh() {
    records = await invoke("list_browser_imports");
    const pending = records.filter(
      (record) =>
        !["completed", "cancelled", "expired"].includes(record.status),
    );
    badge.textContent = String(pending.length);
    list.replaceChildren();
    if (records.length === 0) {
      list.append(
        node("div", t("browserImports.empty"), "browser-import-empty"),
      );
      return;
    }
    for (const record of [...records].reverse()) {
      const item = node("button", undefined, "browser-import-item");
      item.type = "button";
      item.append(
        node("strong", record.document.sourceTitle || record.document.provider),
        node(
          "div",
          `${record.sourceBrowser} · ${record.document.messages.length} ${t("browserImports.messages")}`,
        ),
        node("small", record.status),
      );
      item.addEventListener("click", () => void showRecord(record));
      list.append(item);
    }
  }

  async function showRecord(record) {
    preview.replaceChildren();
    preview.append(
      node("h3", record.document.sourceTitle || t("browserImports.title")),
    );
    preview.append(
      node("p", `${record.document.provider} · ${record.document.sourceUrl}`),
    );
    if (record.document.truncated)
      preview.append(
        node(
          "p",
          t("browserImports.truncatedWarning"),
          "browser-import-warning",
        ),
      );
    const checkboxes = [];
    for (const message of record.document.messages) {
      const card = node("label", undefined, "browser-import-message");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = record.selectedMessageIds.includes(message.id);
      checkbox.value = message.id;
      checkboxes.push(checkbox);
      const blockCount = message.blocks.length;
      card.append(
        checkbox,
        node("strong", ` ${message.sequence + 1}. ${message.role}`),
        node("div", `${blockCount} structured blocks`),
      );
      preview.append(card);
    }
    const mode = document.createElement("select");
    for (const value of [
      "formulas-only",
      "current-message",
      "question-and-answer",
      "selected-message-range",
      "full-loaded-conversation",
      "structured-notes",
    ]) {
      const option = document.createElement("option");
      option.value = value;
      const modeKey = `browserImports.mode${value.charAt(0).toUpperCase() + value.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
      option.textContent = t(modeKey) || value;
      option.selected = record.importMode === value;
      mode.append(option);
    }
    const template = document.createElement("select");
    for (const value of [
      "clean-notes",
      "conversation-transcript",
      "compact-qa",
      "academic-excerpt",
      "formulas-only",
    ]) {
      const option = document.createElement("option");
      option.value = value;
      const templateKey = `browserImports.template${value.charAt(0).toUpperCase() + value.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
      option.textContent = t(templateKey) || value;
      option.selected = record.template === value;
      template.append(option);
    }
    const sessions = (await invoke("native_office_sessions")).filter(
      (session) => session.host_type === "word" && session.document_id,
    );
    const destination = document.createElement("select");
    destination.append(new Option(t("browserImports.selectDocument"), ""));
    for (const session of sessions)
      destination.append(
        new Option(
          session.document_title || session.document_id,
          session.session_id,
        ),
      );
    preview.append(
      node("h4", t("browserImports.importMode")),
      mode,
      node("h4", t("browserImports.template")),
      template,
      node("h4", t("browserImports.destination")),
      destination,
    );
    const diagnostics = node("div");
    const actions = node("div", undefined, "browser-import-actions");
    const planButton = node("button", t("browserImports.buildPlan"));
    planButton.type = "button";
    const commitButton = node("button", t("browserImports.commitToWord"));
    commitButton.type = "button";
    commitButton.disabled = true;
    const cancelButton = node("button", t("browserImports.cancelImport"));
    cancelButton.type = "button";
    actions.append(planButton, commitButton, cancelButton);
    preview.append(diagnostics, actions);
    let planned = false;
    planButton.addEventListener("click", async () => {
      const session = sessions.find(
        (item) => item.session_id === destination.value,
      );
      if (!session) {
        diagnostics.textContent = t("browserImports.noDocumentSelected");
        diagnostics.className = "browser-import-warning";
        return;
      }
      const selected = checkboxes
        .filter((item) => item.checked)
        .map((item) => item.value);
      await invoke("update_browser_import_preview", {
        request: {
          actionId: record.actionId,
          selectedMessageIds: selected,
          importMode: mode.value,
          template: template.value,
          formulaNumbering: "none",
          destinationSessionId: session.session_id,
          expectedDocumentId: session.document_id,
        },
      });
      const plan = await invoke("build_browser_word_import_plan", {
        actionId: record.actionId,
      });
      const formulas = plan.operations.filter(
        (operation) => operation.kind === "formula",
      ).length;
      diagnostics.textContent = `${plan.operations.length} native Word operations · ${formulas} OMML formulas · ${plan.diagnostics.length} diagnostics`;
      diagnostics.className = plan.canCommit
        ? "browser-import-success"
        : "browser-import-warning";
      planned = plan.canCommit;
      commitButton.disabled = !planned;
    });
    commitButton.addEventListener("click", async () => {
      if (!planned) return;
      commitButton.disabled = true;
      diagnostics.textContent = t("browserImports.commitSuccess") + "...";
      try {
        await invoke("native_office_import_conversation", {
          actionId: record.actionId,
        });
        diagnostics.textContent = t("browserImports.commitSuccess");
        diagnostics.className = "browser-import-success";
      } catch (error) {
        diagnostics.textContent = `${t("browserImports.commitFailed")}: ${String(error)}`;
        diagnostics.className = "browser-import-warning";
        commitButton.disabled = false;
      }
    });
    cancelButton.addEventListener("click", async () => {
      await invoke("cancel_browser_import", { actionId: record.actionId });
      await refresh();
      preview.replaceChildren(
        node("p", t("browserImports.cancelImport") + "."),
      );
    });
  }

  button.addEventListener("click", async () => {
    modal.hidden = false;
    await refresh();
  });
  document
    .getElementById("browserImportsClose")
    .addEventListener("click", () => {
      modal.hidden = true;
    });
  await listen("browser-import-received", async () => {
    modal.hidden = false;
    await refresh();
  });
  await listen("browser-formula-import-received", async (event) => {
    const formula = event.payload?.payload?.formulas?.[0];
    const latex = formula?.normalizedLatex || formula?.rawSource;
    if (latex) {
      controller.editor.setLatex(latex);
      controller.switchSection("editor");
      controller.showToast(
        "Browser formula received. Review it and choose a destination before insertion.",
      );
    }
  });
  await listen("native-word-conversation-import-result", async (event) => {
    const record = records.find(
      (item) => item.document.importId === event.payload?.importId,
    );
    if (record)
      await invoke("complete_browser_import", {
        actionId: record.actionId,
        success: !!event.payload.success,
        errorCode: event.payload.errorCode || null,
        error: event.payload.error || null,
      });
    await refresh();
    controller.showToast(
      event.payload?.success
        ? "Conversation imported into Word."
        : `Conversation import failed: ${event.payload?.errorCode || "unknown"}`,
    );
  });
  await refresh();
}

// Initialize App
// ═══════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
  Logger.info("DOM loaded");
  const controller = new UIController();
  setupBrowserImportInbox(controller).catch((error) =>
    Logger.error("Browser import inbox setup failed", error),
  );
  Logger.info("App ready");
  Logger.info("Global shortcut: Ctrl/Cmd+Shift+L (registered in Rust backend)");

  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const version = await getVersion();
    document.querySelectorAll(".app-version-text").forEach((el) => {
      el.textContent = `v${version}`;
    });
    const appVersionEl = document.getElementById("appVersion");
    if (appVersionEl) {
      appVersionEl.textContent = `v${version}`;
    }
  } catch (e) {
    Logger.warn("Failed to get app version:", e);
  }
});
