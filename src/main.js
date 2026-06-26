import { invoke } from '@tauri-apps/api/tauri';

// 公式编辑器
class FormulaEditor {
  constructor() {
    this.init();
  }

  async init() {
    // 初始化 MathLive 编辑器
    // TODO: 集成 MathLive
  }

  async renderFormula(latex, display = false) {
    const result = await invoke('render_formula', {
      request: {
        latex,
        display,
        formats: ['svg', 'mathml'],
      },
    });
    return result;
  }

  async applyFontStyle(latex, style) {
    const result = await invoke('apply_font_style', {
      latex,
      style,
    });
    return result;
  }

  async copyToClipboard(text) {
    const result = await invoke('copy_to_clipboard', {
      text,
    });
    return result;
  }
}

// 公式库
class FormulaLibrary {
  constructor() {
    this.categories = [];
    this.formulas = {};
  }

  async loadFormulas() {
    // TODO: 从 JSON 文件加载公式
  }

  getCategories() {
    return this.categories;
  }

  getFormulas(category) {
    return this.formulas[category] || [];
  }

  search(query) {
    const results = [];
    for (const category of this.categories) {
      for (const formula of this.getFormulas(category)) {
        if (formula.latex.includes(query) || formula.label?.includes(query)) {
          results.push({ formula, category });
        }
      }
    }
    return results;
  }
}

// 导出服务
class ExportService {
  async exportFormula(latex, format, display = false) {
    const result = await invoke('export_formula', {
      request: {
        latex,
        format,
        display,
      },
    });
    return result;
  }
}

// UI 控制器
class UIController {
  constructor() {
    this.currentSection = 'editor';
    this.editor = new FormulaEditor();
    this.library = new FormulaLibrary();
    this.exportService = new ExportService();

    this.initEventListeners();
  }

  initEventListeners() {
    // 导航按钮
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.target.id.replace('Btn', '');
        this.switchSection(section);
      });
    });

    // 复制按钮
    document.getElementById('copyLatex')?.addEventListener('click', () => {
      this.copyFormula('latex');
    });
    document.getElementById('copyMathml')?.addEventListener('click', () => {
      this.copyFormula('mathml');
    });
    document.getElementById('copySvg')?.addEventListener('click', () => {
      this.copyFormula('svg');
    });

    // 字体样式
    document.getElementById('fontStyle')?.addEventListener('change', (e) => {
      this.updateFontStyle(e.target.value);
    });

    // 字体颜色
    document.getElementById('fontColor')?.addEventListener('input', (e) => {
      this.updateFontColor(e.target.value);
    });
  }

  switchSection(section) {
    // 隐藏所有 section
    document.querySelectorAll('.section').forEach((s) => {
      s.classList.remove('active');
    });

    // 显示目标 section
    document.getElementById(`${section}Section`)?.classList.add('active');

    // 更新导航按钮
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.remove('active');
    });
    document.getElementById(`${section}Btn`)?.classList.add('active');

    this.currentSection = section;
  }

  async copyFormula(format) {
    const latex = document.getElementById('latexSource')?.value || '';
    if (!latex) return;

    const result = await this.exportService.exportFormula(latex, format);
    if (result.success && result.content) {
      await this.editor.copyToClipboard(result.content);
      this.showStatus(`已复制 ${format.toUpperCase()} 格式`);
    }
  }

  async updateFontStyle(style) {
    const latex = document.getElementById('latexSource')?.value || '';
    if (!latex) return;

    const result = await this.editor.applyFontStyle(latex, style);
    if (result) {
      document.getElementById('latexSource').value = result;
    }
  }

  updateFontColor(color) {
    // TODO: 实现字体颜色更新
  }

  showStatus(message) {
    const statusText = document.getElementById('statusText');
    if (statusText) {
      statusText.textContent = message;
      setTimeout(() => {
        statusText.textContent = '就绪';
      }, 2000);
    }
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new UIController();
});
