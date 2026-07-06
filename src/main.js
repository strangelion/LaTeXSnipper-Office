// LaTeXSnipper Office - Main JavaScript

// ═══════════════════════════════════════════
// Logging System
// ═══════════════════════════════════════════
const Logger = {
  _prefix: '[LaTeXSnipper]',
  
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
  }
};

Logger.info('Application starting...');

// ═══════════════════════════════════════════
// MathLive Chinese Translation
// ═══════════════════════════════════════════
const MATHLIVE_I18N = {
  'keyboard.tooltip.symbols': '符号',
  'keyboard.tooltip.greek': '希腊字母',
  'keyboard.tooltip.numeric': '数字',
  'keyboard.tooltip.alphabetic': '罗马字母',
  'tooltip.copy to clipboard': '复制到剪贴板',
  'tooltip.cut to clipboard': '剪切到剪贴板',
  'tooltip.paste from clipboard': '从剪贴板粘贴',
  'tooltip.redo': '重做',
  'tooltip.toggle virtual keyboard': '切换虚拟键盘',
  'tooltip.menu': '菜单',
  'tooltip.undo': '撤销',
  'menu.borders': '矩阵边框',
  'menu.insert matrix': '插入矩阵',
  'menu.array.add row above': '上方添加行',
  'menu.array.add row below': '下方添加行',
  'menu.array.add column after': '右侧添加列',
  'menu.array.add column before': '左侧添加列',
  'menu.array.delete row': '删除行',
  'menu.array.delete rows': '删除选中行',
  'menu.array.delete column': '删除列',
  'menu.array.delete columns': '删除选中列',
  'menu.mode': '模式',
  'menu.mode-math': '数学',
  'menu.mode-text': '文本',
  'menu.mode-latex': 'LaTeX',
  'menu.insert': '插入',
  'menu.insert.abs': '绝对值',
  'menu.insert.nth-root': 'n 次根号',
  'menu.insert.log-base': '对数 (log)',
  'menu.insert.heading-calculus': '微积分',
  'menu.insert.derivative': '导数',
  'menu.insert.nth-derivative': 'n 阶导数',
  'menu.insert.integral': '积分',
  'menu.insert.sum': '求和',
  'menu.insert.product': '乘积',
  'menu.insert.heading-complex-numbers': '复数',
  'menu.insert.modulus': '模',
  'menu.insert.argument': '辐角',
  'menu.insert.real-part': '实部',
  'menu.insert.imaginary-part': '虚部',
  'menu.insert.conjugate': '共轭',
  'tooltip.blackboard': '黑板粗体',
  'tooltip.bold': '粗体',
  'tooltip.italic': '斜体',
  'tooltip.fraktur': '哥特体',
  'tooltip.script': '手写体',
  'tooltip.caligraphic': '书法体',
  'tooltip.typewriter': '等宽',
  'tooltip.roman-upright': '罗马正体',
  'tooltip.row-by-col': '%@ × %@',
  'menu.font-style': '字体风格',
  'menu.accent': '重音/修饰',
  'menu.decoration': '装饰',
  'menu.color': '颜色',
  'menu.background-color': '背景',
  'menu.evaluate': '计算',
  'menu.simplify': '化简',
  'menu.solve': '求解',
  'menu.solve-for': '求解 %@',
  'menu.cut': '剪切',
  'menu.copy': '复制',
  'menu.copy-as-latex': '复制为 LaTeX',
  'menu.copy-as-typst': '复制为 Typst',
  'menu.copy-as-ascii-math': '复制为 ASCII Math',
  'menu.copy-as-mathml': '复制为 MathML',
  'menu.paste': '粘贴',
  'menu.select-all': '全选',
  'color.red': '红色',
  'color.orange': '橙色',
  'color.yellow': '黄色',
  'color.lime': '青柠色',
  'color.green': '绿色',
  'color.teal': '蓝绿色',
  'color.cyan': '青色',
  'color.blue': '蓝色',
  'color.indigo': '靛蓝色',
  'color.purple': '紫色',
  'color.magenta': '品红色',
  'color.black': '黑色',
  'color.dark-grey': '深灰色',
  'color.grey': '灰色',
  'color.light-grey': '浅灰色',
  'color.white': '白色',
};

// ═══════════════════════════════════════════
// Temml Renderer
// ═══════════════════════════════════════════
class TemmlRenderer {
  constructor() {
    Logger.info('TemmlRenderer initializing...');
    this.loaded = false;
  }

  async init() {
    if (this.loaded) return true;
    try {
      const Temml = await import('temml/dist/temml.mjs');
      this.temml = Temml.default || Temml;

      // Register unsupported LaTeX macros
      this.macros = {
        '\\bm': '\\mathbf',
        '\\boldsymbol': '\\mathbf',
        '\\operatorname': '\\mathrm',
      };

      this.loaded = true;
      Logger.info('Temml loaded');
      return true;
    } catch (e) {
      Logger.error('Failed to load Temml:', e);
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
      Logger.error('Temml render error:', e);
      return `<span>${latex}</span>`;
    }
  }

  // LaTeX → MathML
  toMathML(latex) {
    if (!this.loaded) return '';
    try {
      // Register unsupported macros before converting
      const macros = {
        '\\bm': '\\mathbf',
        '\\boldsymbol': '\\mathbf',
        '\\operatorname': '\\mathrm',
      };
      return this.temml.renderToString(latex, {
        xml: true,
        macros: macros,
        throwOnError: false
      });
    } catch (e) {
      Logger.error('Temml toMathML error:', e);
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
    this.trigger = element.querySelector('.custom-select-trigger');
    this.dropdown = element.querySelector('.custom-select-dropdown');
    this.options = element.querySelectorAll('.custom-select-option');
    this.value = this.trigger.dataset.value || '';
    
    this.init();
  }
  
  init() {
    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    
    this.options.forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(option);
      });
    });
    
    document.addEventListener('click', () => {
      this.close();
    });
  }
  
  toggle() {
    this.element.classList.contains('open') ? this.close() : this.open();
  }
  
  open() {
    document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
    this.element.classList.add('open');
  }
  
  close() {
    this.element.classList.remove('open');
  }
  
  select(option) {
    this.options.forEach(opt => opt.classList.remove('selected'));
    option.classList.add('selected');
    this.value = option.dataset.value;
    this.trigger.querySelector('span').textContent = option.textContent;
    this.trigger.dataset.value = this.value;
    this.close();
    
    Logger.debug(`CustomSelect: ${this.value}`);
    
    this.element.dispatchEvent(new CustomEvent('change', {
      detail: { value: this.value }
    }));
  }
  
  getValue() { return this.value; }
  
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
    Logger.info('FormulaEditor initializing...');
    this.mathfield = null;
    this.renderer = new TemmlRenderer();
    this.init();
  }

  async init() {
    Logger.debug('FormulaEditor init');
    
    try {
      const { MathfieldElement } = await import('mathlive');
      
      const container = document.getElementById('mathfieldHost');
      if (container) {
        this.mathfield = new MathfieldElement();
        this.mathfield.setAttribute('virtual-keyboard-mode', 'manual');
        container.appendChild(this.mathfield);
        
        this.mathfield.addEventListener('input', () => {
          const latex = this.mathfield.getValue('latex');
          Logger.debug(`MathLive input: ${latex.substring(0, 30)}...`);
          
          const source = document.getElementById('latexSource');
          if (source) {
            source.value = latex;
          }
          
          this.updatePreview(latex);
        });

        this.mathfield.addEventListener('keystroke', (e) => {
          Logger.debug(`MathLive keystroke: ${e.key}`);
        });
        
        Logger.info('MathLive editor initialized');
      }
      
      this.renderer.init().then(() => {
        Logger.info('Temml preloaded');
      });
      
    } catch (e) {
      Logger.error('Failed to initialize FormulaEditor:', e);
    }
  }

  async updatePreview(latex) {
    const previewHost = document.getElementById('previewHost');
    if (!previewHost) return;
    
    if (!latex) {
      previewHost.innerHTML = '<span style="color: var(--muted);">输入公式后预览</span>';
      return;
    }

    const display = document.getElementById('displayMode')?.checked || false;
    Logger.debug(`updatePreview: display=${display}`);
    
    if (!this.renderer.loaded) {
      Logger.debug('Waiting for Temml to load...');
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
    const source = document.getElementById('latexSource');
    if (source) {
      source.value = latex;
    }
    this.updatePreview(latex);
  }

  getLatex() {
    if (this.mathfield) {
      return this.mathfield.getValue('latex');
    }
    return document.getElementById('latexSource')?.value || '';
  }

  async copyToClipboard(text) {
    Logger.info('copyToClipboard');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('copy_to_clipboard', { text });
      Logger.debug('Tauri copy successful');
      return result;
    } catch (e) {
      Logger.warn('Tauri failed, using browser clipboard');
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e2) {
        Logger.error('Copy failed:', e2.message);
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
    Logger.info('FormulaLibrary initializing...');
    this.categories = [];
    this.formulas = {};
    this.loaded = false;
  }

  async load() {
    Logger.debug('Loading formula data...');
    
    try {
      const indexResponse = await fetch('/formulas/_index.json');
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
            .filter(item => Array.isArray(item))
            .map(item => ({
              label: item[0],
              latex: item[1],
            }));
          
          Logger.debug(`Loaded ${this.formulas[categoryId].length} formulas for ${categoryId}`);
        } catch (e) {
          Logger.warn(`Failed to load category ${categoryId}:`, e.message);
        }
      }
      
      this.loaded = true;
      Logger.info(`Loaded ${this.categories.length} categories`);
      
    } catch (e) {
      Logger.error('Failed to load formula data:', e);
      this._loadFallbackData();
    }
  }

  _getCategoryName(id) {
    const names = {
      'greek': '希腊字母',
      'structures': '结构',
      'delimiters': '定界符',
      'analysis': '分析',
      'algebra': '代数',
      'geometry': '几何',
      'topology': '拓扑',
      'numberTheory': '数论',
      'relations': '关系',
      'operators': '运算符',
      'bigops': '大运算符',
      'arrows': '箭头',
      'sets': '集合',
      'functions': '函数',
      'probability': '概率',
      'physics': '物理',
      'chemistry': '化学',
      'misc': '其他',
    };
    return names[id] || id;
  }

  _loadFallbackData() {
    Logger.info('Loading fallback formula data...');
    this.categories = [
      { id: 'greek', name: '希腊字母' },
      { id: 'structures', name: '结构' },
      { id: 'operators', name: '运算符' },
      { id: 'relations', name: '关系' },
      { id: 'misc', name: '其他' },
    ];
    this.formulas = {
      greek: [
        { latex: '\\alpha', label: 'α' },
        { latex: '\\beta', label: 'β' },
        { latex: '\\gamma', label: 'γ' },
        { latex: '\\delta', label: 'δ' },
        { latex: '\\pi', label: 'π' },
        { latex: '\\sigma', label: 'σ' },
        { latex: '\\omega', label: 'ω' },
      ],
      structures: [
        { latex: '\\frac{a}{b}', label: '分数' },
        { latex: '\\sqrt{x}', label: '根号' },
        { latex: 'x^{n}', label: '上标' },
        { latex: 'x_{n}', label: '下标' },
        { latex: '\\int_{a}^{b}', label: '积分' },
        { latex: '\\sum_{i=1}^{n}', label: '求和' },
      ],
      operators: [
        { latex: '+', label: '加' },
        { latex: '-', label: '减' },
        { latex: '\\times', label: '乘' },
        { latex: '\\div', label: '除' },
        { latex: '\\pm', label: '±' },
        { latex: '\\infty', label: '无穷' },
      ],
      relations: [
        { latex: '=', label: '等于' },
        { latex: '\\neq', label: '不等于' },
        { latex: '<', label: '小于' },
        { latex: '>', label: '大于' },
        { latex: '\\leq', label: '≤' },
        { latex: '\\geq', label: '≥' },
        { latex: '\\in', label: '∈' },
        { latex: '\\subset', label: '⊂' },
      ],
      misc: [
        { latex: '\\forall', label: '∀' },
        { latex: '\\exists', label: '∃' },
        { latex: '\\ldots', label: '…' },
        { latex: '\\angle', label: '∠' },
      ],
    };
    this.loaded = true;
    Logger.info('Fallback data loaded');
  }

  getCategories() { return this.categories; }
  getFormulas(category) { return this.formulas[category] || []; }

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
    const label = (formula.label || '').toLowerCase();
    const latex = (formula.latex || '').toLowerCase();

    if (label.includes(q) || latex.includes(q)) return true;

    const py = this._pinyinInitials(query);
    if (py.length >= 2 && (label.includes(py) || latex.includes(py))) return true;

    const aliases = this._getSearchAliases();
    for (const [cmd, aliasList] of Object.entries(aliases)) {
      if (q.includes(cmd) || cmd.includes(q)) {
        for (const alias of aliasList) {
          if (label.includes(alias.toLowerCase()) || latex.includes('\\' + cmd)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  _pinyinInitials(str) {
    const map = {
      '分':'f','数':'s','极':'j','限':'x','积':'j','求':'q','和':'h',
      '矩':'j','阵':'z','向':'x','量':'l','特':'t','征':'z','值':'z','行':'h',
      '列':'l','式':'s','秩':'z','逆':'n','转':'z','置':'z','梯':'t','度':'d',
      '散':'s','旋':'x','拉':'l','普':'p','斯':'s','无':'w','穷':'q','空':'k',
      '集':'j','属':'s','于':'y','并':'b','交':'j','子':'z','超':'c','非':'f',
      '对':'d','数':'s','指':'z','正':'z','余':'y','切':'q','双':'s','曲':'q',
      '反':'f','自':'z','然':'r','最':'z','大':'d','上':'s','确':'q','界':'j',
      '分':'f','段':'d','行':'h','列':'l','迹':'j','共':'g','轭':'e','偏':'p',
      '导':'d','欧':'o','米':'m','伽':'j','马':'m','阿':'a','尔':'e','贝':'b',
      '塔':'t','德':'d','西':'x','斐':'f','陶':'t','卡':'k','克':'k','艾':'a',
      '泽':'z','普':'p','柔':'r','派':'p','格':'g','推':'t','出':'c','等':'d',
      '价':'j','负':'f','约':'y','恒':'h','属':'s','包':'b','含':'h','左':'z',
      '右':'y','箭':'j','头':'t','逻':'l','辑':'j','与':'y','或':'h','不':'b',
      '粗':'c','黑':'h','板':'b','书':'s','法':'f','哥':'g','特':'t','组':'z',
      '合':'h','文':'w','本':'b','运':'y','算':'s','符':'f','点':'d','乘':'c',
      '叉':'c','除':'c','微':'w','三':'s','角':'j','函':'h','几':'j','何':'h',
      '代':'d','概':'g','率':'l','物':'w','理':'l','化':'h','学':'x',
    };
    let r = '';
    for (const ch of str) {
      if (map[ch]) r += map[ch];
    }
    return r;
  }

  _getSearchAliases() {
    return {
      frac: ['分数', 'fraction'],
      sqrt: ['根号', '平方根', 'square root'],
      lim: ['极限', 'limit'],
      int: ['积分', 'integral'],
      sum: ['求和', 'summation'],
      prod: ['求积', 'product'],
      vec: ['向量', 'vector'],
      dot: ['点乘', 'dot'],
      sin: ['正弦', 'sine'],
      cos: ['余弦', 'cosine'],
      tan: ['正切', 'tangent'],
      log: ['对数', 'logarithm'],
      ln: ['自然对数'],
      exp: ['指数', 'exponential'],
      max: ['最大值', 'maximum'],
      min: ['最小值', 'minimum'],
      alpha: ['阿尔法'],
      beta: ['贝塔'],
      gamma: ['伽马'],
      delta: ['德尔塔'],
      epsilon: ['艾普西隆'],
      theta: ['西塔'],
      lambda: ['拉姆达'],
      mu: ['缪'],
      pi: ['派'],
      sigma: ['西格玛'],
      phi: ['斐'],
      omega: ['欧米伽'],
      matrix: ['矩阵', 'matrix'],
      det: ['行列式', 'determinant'],
      infty: ['无穷', 'infinity'],
      emptyset: ['空集', 'empty set'],
      forall: ['任意', 'for all'],
      exists: ['存在', 'exists'],
      subset: ['子集', 'subset'],
      cup: ['并集', 'union'],
      cap: ['交集', 'intersection'],
      in: ['属于', 'element of'],
      leq: ['小于等于'],
      geq: ['大于等于'],
      neq: ['不等于'],
      approx: ['约等于', 'approximately'],
    };
  }
}

// ═══════════════════════════════════════════
// Settings Manager
// ═══════════════════════════════════════════
class SettingsManager {
  constructor() {
    this.defaults = {
      displayMode: 'inline',
      fontStyle: 'tex',
      fontColor: '#000000',
      bridgeUrl: 'http://127.0.0.1:19876',
      theme: 'light',
      officeEnabled: true,
      ocrEnabled: true,
    };
    this.settings = this.load();
    Logger.info('Settings loaded');
  }

  load() {
    try {
      const saved = localStorage.getItem('settings');
      return saved ? { ...this.defaults, ...JSON.parse(saved) } : { ...this.defaults };
    } catch {
      return { ...this.defaults };
    }
  }

  save() {
    localStorage.setItem('settings', JSON.stringify(this.settings));
    Logger.debug('Settings saved');
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
    const a = document.createElement('a');
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
    this.downloadFile(content, 'formula.tex', 'application/x-tex');
  }

  static exportToSvg(svgContent) {
    this.downloadFile(svgContent, 'formula.svg', 'image/svg+xml');
  }
}

// ═══════════════════════════════════════════
// Theme Manager
// ═══════════════════════════════════════════
class ThemeManager {
  constructor() {
    this.currentTheme = localStorage.getItem('theme') || 'light';
    Logger.info(`Theme: ${this.currentTheme}`);
    this.apply();
  }

  toggle() {
    this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', this.currentTheme);
    this.apply();
    this.updateButton();
    Logger.info(`Theme → ${this.currentTheme}`);
  }

  apply() {
    document.documentElement.setAttribute('data-theme', this.currentTheme);
  }

  updateButton() {
    const btn = document.getElementById('themeToggle');
    if (btn) {
      if (this.currentTheme === 'light') {
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
  if (!s) return '';
  const mathItalicA = 0x1D434;
  const mathBoldA = 0x1D400;
  const mathScriptA = 0x1D49C;
  const mathFrakturA = 0x1D504;
  const mathDoubleA = 0x1D538;
  const mathMonoA = 0x1D670;

  let result = '';
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    const isSup = cp >= 0x2070 && cp <= 0x2079;
    const isSub = cp >= 0x2080 && cp <= 0x2089;

    if (cp >= mathBoldA && cp < mathBoldA + 52) {
      const idx = cp - mathBoldA;
      const ch = idx < 26 ? String.fromCharCode(65 + idx) : String.fromCharCode(97 + idx - 26);
      result += `\\mathbf{${ch}}`;
    } else if (cp >= mathItalicA && cp < mathItalicA + 52) {
      const idx = cp - mathItalicA;
      const ch = idx < 26 ? String.fromCharCode(65 + idx) : String.fromCharCode(97 + idx - 26);
      result += ch;
    } else if (cp >= mathScriptA && cp < mathScriptA + 52) {
      const idx = cp - mathScriptA;
      const ch = idx < 26 ? String.fromCharCode(65 + idx) : String.fromCharCode(97 + idx - 26);
      result += `\\mathcal{${ch}}`;
    } else if (cp >= mathFrakturA && cp < mathFrakturA + 52) {
      const idx = cp - mathFrakturA;
      const ch = idx < 26 ? String.fromCharCode(65 + idx) : String.fromCharCode(97 + idx - 26);
      result += `\\mathfrak{${ch}}`;
    } else if (cp >= mathDoubleA && cp < mathDoubleA + 52) {
      const idx = cp - mathDoubleA;
      const ch = idx < 26 ? String.fromCharCode(65 + idx) : String.fromCharCode(97 + idx - 26);
      result += `\\mathbb{${ch}}`;
    } else if (cp >= mathMonoA && cp < mathMonoA + 52) {
      const idx = cp - mathMonoA;
      const ch = idx < 26 ? String.fromCharCode(65 + idx) : String.fromCharCode(97 + idx - 26);
      result += `\\mathtt{${ch}}`;
    } else if (isSup) {
      const digit = String(cp - 0x2070);
      if (cp === 0x2070) result += '^{0}';
      else if (cp === 0x00B9) result += '^{1}';
      else if (cp === 0x00B2) result += '^{2}';
      else if (cp === 0x00B3) result += '^{3}';
      else result += `^{${digit}}`;
    } else if (isSub) {
      const digit = String(cp - 0x2080);
      result += `_{${digit}}`;
    } else {
      const special = {
        0x2211: '\\sum', 0x220F: '\\prod', 0x222B: '\\int', 0x222C: '\\iint',
        0x222E: '\\oint', 0x2210: '\\coprod', 0x2202: '\\partial', 0x2207: '\\nabla',
        0x221E: '\\infty', 0x2205: '\\emptyset', 0x2200: '\\forall', 0x2203: '\\exists',
        0x2208: '\\in', 0x2209: '\\notin', 0x2282: '\\subset', 0x2283: '\\supset',
        0x2286: '\\subseteq', 0x2287: '\\supseteq', 0x2229: '\\cap', 0x222A: '\\cup',
        0x2261: '\\equiv', 0x2248: '\\approx', 0x223C: '\\sim', 0x2264: '\\leq',
        0x2265: '\\geq', 0x2260: '\\neq', 0x00D7: '\\times', 0x00B1: '\\pm',
        0x2213: '\\mp', 0x22C5: '\\cdot', 0x2192: '\\rightarrow', 0x2190: '\\leftarrow',
        0x2194: '\\leftrightarrow', 0x21D2: '\\Rightarrow', 0x21D0: '\\Leftarrow',
        0x00AC: '\\neg', 0x2227: '\\wedge', 0x2228: '\\vee', 0x2234: '\\therefore',
        0x2235: '\\because', 0x2026: '\\ldots', 0x22EF: '\\cdots', 0x22EE: '\\vdots',
        0x22F1: '\\ddots', 0x2262: '\\not\\equiv', 0x223D: '\\backsim',
        0x27E8: '\\langle', 0x27E9: '\\rangle', 0x230A: '\\lfloor', 0x230B: '\\rfloor',
        0x2308: '\\lceil', 0x2309: '\\rceil', 0x221D: '\\propto',
        0x2223: '\\mid', 0x2225: '\\parallel', 0x2216: '\\setminus',
        0x00B0: '\\degree', 0x2135: '\\aleph', 0x210F: '\\hbar',
        0x211C: '\\Re', 0x2111: '\\Im', 0x2133: '\\mathcal{M}',
      };
      if (special[cp]) {
        result += special[cp];
      } else if (cp === 0x2032) {
        result += "'";
      } else if (cp === 0x2033) {
        result += "''";
      } else if (cp <= 0x7F || (cp >= 0xA0 && cp < 0x10000)) {
        result += s[i];
      }
    }
    i += cp > 0xFFFF ? 2 : 1;
  }

  // Post-process: group consecutive superscripts/subscripts
  result = result.replace(/\^\{(\d+)\}\^\{(\d+)\}/g, '^{$1$2}');
  result = result.replace(/_\{(\d+)\}_\{(\d+)\}/g, '_{$1$2}');

  return result;
}

// ═══════════════════════════════════════════
// Extract OMML math element from Word document XML
// ═══════════════════════════════════════════
function extractMathElement(xml) {
  let decoded = xml;
  if (xml.indexOf('&lt;') !== -1 || xml.indexOf('&#') !== -1 || xml.indexOf('&amp;') !== -1) {
    decoded = xml
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    Logger.info(`[extractMath] Decoded HTML entities, new length: ${decoded.length}`);
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
      const rawTag = m[0].trim().replace(/[\s>]$/, '');
      const closeTag = rawTag.replace(/^</, '</') + '>';
      const end = decoded.indexOf(closeTag, start);
      if (end > start) {
        let result = decoded.substring(start, end + closeTag.length);
        if (!result.includes('xmlns:m=')) {
          const ns = ' xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
          const gtIdx = result.indexOf('>');
          if (gtIdx > 0) {
            result = result.substring(0, gtIdx) + ns + result.substring(gtIdx);
          }
        }
        if (!result.includes('xmlns:w=')) {
          const ns = ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
          const gtIdx = result.indexOf('>');
          if (gtIdx > 0) {
            result = result.substring(0, gtIdx) + ns + result.substring(gtIdx);
          }
        }
        Logger.info(`[extractMath] Extracted: ${rawTag} at ${start}..${end} (${result.length}b)`);
        return result;
      }
    }
  }

  Logger.warn('[extractMath] No oMath tag found, returning decoded XML');
  return decoded;
}

// ═══════════════════════════════════════════
// OMML → LaTeX
// ═══════════════════════════════════════════
const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function ommlToLatex(omml) {
  if (!omml) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(omml, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    Logger.error('OMML parse error:', err.textContent);
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
  if (!node) return '';
  if (node.nodeType === 3) return node.textContent || '';
  if (node.nodeType !== 1) return '';

  const tag = node.localName;

  // Top-level containers
  if (tag === 'oMathPara' || tag === 'oMath') {
    const children = Array.from(node.childNodes).filter(n => n.nodeType === 1);
    return children.map(_walkOmml).join('');
  }

  // Text run
  if (tag === 'r') {
    const t = _ommlEl(node, 't');
    return t ? t.textContent : '';
  }

  // Superscript
  if (tag === 'sSup') {
    const e = _ommlEl(node, 'e');
    const sup = _ommlEl(node, 'sup');
    const base = _walkOmml(e);
    const s = _walkOmml(sup);
    return `${base}^{${s}}`;
  }

  // Subscript
  if (tag === 'sSub') {
    const e = _ommlEl(node, 'e');
    const sub = _ommlEl(node, 'sub');
    const base = _walkOmml(e);
    const s = _walkOmml(sub);
    return `${base}_{${s}}`;
  }

  // Sub-superscript
  if (tag === 'sSubSup') {
    const e = _ommlEl(node, 'e');
    const sub = _ommlEl(node, 'sub');
    const sup = _ommlEl(node, 'sup');
    const base = _walkOmml(e);
    return `${base}_{${_walkOmml(sub)}}^{${_walkOmml(sup)}}`;
  }

  // Pre-sub-superscript
  if (tag === 'sPre') {
    const e = _ommlEl(node, 'e');
    const sub = _ommlEl(node, 'sub');
    const sup = _ommlEl(node, 'sup');
    return `_{${_walkOmml(sub)}}^{${_walkOmml(sup)}}${_walkOmml(e)}`;
  }

  // Fraction
  if (tag === 'f') {
    const num = _ommlEl(node, 'num');
    const den = _ommlEl(node, 'den');
    return `\\frac{${_walkOmml(num)}}{${_walkOmml(den)}}`;
  }

  // Radical
  if (tag === 'rad') {
    const deg = _ommlEl(node, 'deg');
    const e = _ommlEl(node, 'e');
    const degText = deg ? _walkOmml(deg).trim() : '';
    if (degText && degText !== '2') {
      return `\\sqrt[${degText}]{${_walkOmml(e)}}`;
    }
    return `\\sqrt{${_walkOmml(e)}}`;
  }

  // N-ary (sum, integral, product, etc.)
  if (tag === 'nary') {
    const chr = _ommlEl(node, 'chr');
    const sub = _ommlEl(node, 'sub');
    const sup = _ommlEl(node, 'sup');
    const e = _ommlEl(node, 'e');
    const charAttr = node.getElementsByTagNameNS(OMML_NS, 'chr')[0];
    let op = '\u222B'; // default integral
    if (charAttr) {
      const val = charAttr.getAttribute('m:val') || charAttr.getAttribute('val');
      if (val) op = String.fromCodePoint(parseInt(val.replace('0x', ''), 16) || val.charCodeAt(0));
    }
    const opMap = {
      '\u222B': '\\int', '\u222C': '\\iint', '\u222D': '\\iiint', '\u222E': '\\oint',
      '\u2211': '\\sum', '\u220F': '\\prod', '\u2210': '\\coprod',
      '\u222F': '\\oiint', '\u2230': '\\oiiint',
    };
    const opCmd = opMap[op] || op;
    let result = opCmd;
    if (sub) result += `_{${_walkOmml(sub)}}`;
    if (sup) result += `^{${_walkOmml(sup)}}`;
    result += ` ${_walkOmml(e)}`;
    return result;
  }

  // Delimiter (parentheses, brackets, etc.)
  if (tag === 'd') {
    const dPr = _ommlEl(node, 'dPr');
    let beg = '(', end = ')';
    if (dPr) {
      const bCh = _ommlEl(dPr, 'begChr');
      const eCh = _ommlEl(dPr, 'endChr');
      if (bCh) {
        const v = bCh.getAttribute('m:val') || bCh.getAttribute('val');
        if (v) beg = String.fromCharCode(parseInt(v.replace('0x', ''), 16) || v.charCodeAt(0));
      }
      if (eCh) {
        const v = eCh.getAttribute('m:val') || eCh.getAttribute('val');
        if (v) end = String.fromCharCode(parseInt(v.replace('0x', ''), 16) || v.charCodeAt(0));
      }
    }
    const elems = _ommlChildren(node, 'e');
    const inner = elems.map(_walkOmml).join(', ');
    const delimMap = { '(': ')', '[': ']', '{': '}', '|': '|', '\u27E8': '\u27E9', '\u230A': '\u230B', '\u2308': '\u2309' };
    const close = delimMap[beg] || end;
    return `${beg}${inner}${close}`;
  }

  // Function
  if (tag === 'func') {
    const fName = _ommlEl(node, 'fName');
    const e = _ommlEl(node, 'e');
    const name = _walkOmml(fName).trim();
    const funcMap = {
      'sin': '\\sin', 'cos': '\\cos', 'tan': '\\tan',
      'sec': '\\sec', 'csc': '\\csc', 'cot': '\\cot',
      'arcsin': '\\arcsin', 'arccos': '\\arccos', 'arctan': '\\arctan',
      'sinh': '\\sinh', 'cosh': '\\cosh', 'tanh': '\\tanh',
      'log': '\\log', 'ln': '\\ln', 'exp': '\\exp',
      'lim': '\\lim', 'max': '\\max', 'min': '\\min',
      'det': '\\det', 'gcd': '\\gcd', 'Pr': '\\Pr',
    };
    const cmd = funcMap[name.toLowerCase()] || `\\mathrm{${name}}`;
    return `${cmd}\\left(${_walkOmml(e)}\\right)`;
  }

  // Bar (overline, underline)
  if (tag === 'bar') {
    const barPr = _ommlEl(node, 'barPr');
    const e = _ommlEl(node, 'e');
    let pos = 'top';
    if (barPr) {
      const posEl = _ommlEl(barPr, 'pos');
      if (posEl) pos = posEl.getAttribute('m:val') || posEl.getAttribute('val') || 'top';
    }
    if (pos === 'bot') return `\\underline{${_walkOmml(e)}}`;
    return `\\overline{${_walkOmml(e)}}`;
  }

  // Accent
  if (tag === 'acc') {
    const accPr = _ommlEl(node, 'accPr');
    const e = _ommlEl(node, 'e');
    let chr = '\u0302'; // default hat
    if (accPr) {
      const chrEl = _ommlEl(accPr, 'chr');
      if (chrEl) {
        const v = chrEl.getAttribute('m:val') || chrEl.getAttribute('val');
        if (v) chr = String.fromCharCode(parseInt(v.replace('0x', ''), 16) || v.charCodeAt(0));
      }
    }
    const accentMap = {
      '\u0302': '\\hat', '\u0303': '\\tilde', '\u0304': '\\bar',
      '\u0305': '\\overrightarrow', '\u0307': '\\dot', '\u0308': '\\ddot',
      '\u20D7': '\\vec', '\u030C': '\\check',
      '\u0060': '\\grave', '\u00B4': '\\acute',
    };
    const cmd = accentMap[chr];
    if (cmd) return `${cmd}{${_walkOmml(e)}}`;
    return `\\accentset{${chr}}{${_walkOmml(e)}}`;
  }

  // Equation array
  if (tag === 'eqArr') {
    const elems = _ommlChildren(node, 'e');
    const rows = elems.map(_walkOmml);
    return `\\begin{aligned}${rows.join('\\\\')}\\end{aligned}`;
  }

  // Matrix
  if (tag === 'm') {
    const rows = _ommlChildren(node, 'mr');
    const mRows = rows.map(mr => {
      const cells = _ommlChildren(mr, 'e');
      return cells.map(_walkOmml).join(' & ');
    });
    return `\\begin{matrix}${mRows.join('\\\\')}\\end{matrix}`;
  }

  // Limit below
  if (tag === 'limLow') {
    const e = _ommlEl(node, 'e');
    const lim = _ommlEl(node, 'lim');
    return `\\lim_{${_walkOmml(lim)}}{${_walkOmml(e)}}`;
  }

  // Limit above
  if (tag === 'limUpp') {
    const e = _ommlEl(node, 'e');
    const lim = _ommlEl(node, 'lim');
    return `\\overset{${_walkOmml(lim)}}{${_walkOmml(e)}}`;
  }

  // Group character
  if (tag === 'groupChr') {
    const e = _ommlEl(node, 'e');
    return _walkOmml(e);
  }

  // Box
  if (tag === 'box' || tag === 'borderBox' || tag === 'phantom' || tag === 'sPre') {
    const e = _ommlEl(node, 'e');
    return _walkOmml(e);
  }

  // Control properties - skip
  if (tag === 'ctrlPr' || tag === 'rPr' || tag === 'dPr' || tag === 'fPr' ||
      tag === 'radPr' || tag === 'naryPr' || tag === 'funcPr' ||
      tag === 'limLowPr' || tag === 'limUppPr' || tag === 'accPr' ||
      tag === 'barPr' || tag === 'groupChrPr') {
    return '';
  }

  // Default: recurse into children
  return Array.from(node.childNodes).map(_walkOmml).join('');
}

// ═══════════════════════════════════════════
// MathML → LaTeX
// ═══════════════════════════════════════════
function mathmlToLatex(mathml) {
  if (!mathml) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<math xmlns="http://www.w3.org/1998/Math/MathML">${mathml}</math>`,
    'application/xml'
  );
  const root = doc.querySelector('math');
  if (!root) return mathml;
  return _walkMathml(root);
}

function _walkMathml(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';

  const tag = node.localName;

  if (tag === 'mi') {
    const t = node.textContent.trim();
    const greek = {
      '\u03B1':'\\alpha','\u03B2':'\\beta','\u03B3':'\\gamma','\u03B4':'\\delta',
      '\u03B5':'\\epsilon','\u03B6':'\\zeta','\u03B7':'\\eta','\u03B8':'\\theta',
      '\u03B9':'\\iota','\u03BA':'\\kappa','\u03BB':'\\lambda','\u03BC':'\\mu',
      '\u03BD':'\\nu','\u03BE':'\\xi','\u03C0':'\\pi','\u03C1':'\\rho',
      '\u03C3':'\\sigma','\u03C4':'\\tau','\u03C5':'\\upsilon','\u03C6':'\\phi',
      '\u03C7':'\\chi','\u03C8':'\\psi','\u03C9':'\\omega',
      '\u0393':'\\Gamma','\u0394':'\\Delta','\u0398':'\\Theta','\u039B':'\\Lambda',
      '\u039E':'\\Xi','\u03A0':'\\Pi','\u03A3':'\\Sigma','\u03A6':'\\Phi',
      '\u03A8':'\\Psi','\u03A9':'\\Omega',
      '\u221E':'\\infty','\u2202':'\\partial','\u2207':'\\nabla',
      '\u2205':'\\emptyset','\u2200':'\\forall','\u2203':'\\exists',
      '\u2208':'\\in','\u2209':'\\notin',
    };
    if (greek[t]) return greek[t];
    if (t.length === 1 && node.getAttribute('mathvariant') === 'bold') return `\\mathbf{${t}}`;
    if (t.length === 1 && node.getAttribute('mathvariant') === 'italic') return t;
    if (/^[A-Z]$/.test(t) && node.getAttribute('mathvariant') === 'normal') return `\\mathrm{${t}}`;
    return t;
  }

  if (tag === 'mo') {
    const t = node.textContent.trim();
    const ops = {
      '\u00D7':'\\times','\u00B1':'\\pm','\u2213':'\\mp','\u22C5':'\\cdot',
      '\u2264':'\\leq','\u2265':'\\geq','\u2260':'\\neq','\u2248':'\\approx',
      '\u2261':'\\equiv','\u223C':'\\sim','\u221D':'\\propto',
      '\u2192':'\\rightarrow','\u2190':'\\leftarrow','\u2194':'\\leftrightarrow',
      '\u21D2':'\\Rightarrow','\u21D0':'\\Leftarrow',
      '\u222B':'\\int','\u222C':'\\iint','\u222E':'\\oint',
      '\u2211':'\\sum','\u220F':'\\prod','\u2210':'\\coprod',
      '\u2227':'\\wedge','\u2228':'\\vee','\u00AC':'\\neg',
      '\u2229':'\\cap','\u222A':'\\cup','\u2216':'\\setminus',
      '\u2282':'\\subset','\u2283':'\\supset','\u2286':'\\subseteq','\u2287':'\\supseteq',
      '\u2234':'\\therefore','\u2235':'\\because',
      '\u27E8':'\\langle','\u27E9':'\\rangle',
      '\u230A':'\\lfloor','\u230B':'\\rfloor','\u2308':'\\lceil','\u2309':'\\rceil',
      '\u00AF':'\\overline','\u0307':'\\dot','\u0308':'\\ddot',
      '\u20D7':'\\vec','\u005E':'\\hat',
      '\u2026':'\\ldots','\u22EF':'\\cdots','\u22EE':'\\vdots','\u22F1':'\\ddots',
      '\u2223':'\\mid','\u2225':'\\parallel',
    };
    if (ops[t]) return ops[t];
    if (t === '\u00B2') return '^{2}';
    if (t === '\u00B3') return '^{3}';
    if (t === '\u00B9') return '^{1}';
    return t;
  }

  if (tag === 'mn') return node.textContent.trim();
  if (tag === 'mtext') return `\\text{${node.textContent}}`;
  if (tag === 'ms') return `\\text{${node.textContent}}`;

  if (tag === 'mfrac') {
    const children = _getMathmlChildren(node);
    const num = children[0] ? _walkMathml(children[0]) : '';
    const den = children[1] ? _walkMathml(children[1]) : '';
    return `\\frac{${num}}{${den}}`;
  }

  if (tag === 'msup') {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : '';
    const sup = children[1] ? _walkMathml(children[1]) : '';
    return `${base}^{${sup}}`;
  }

  if (tag === 'msub') {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : '';
    const sub = children[1] ? _walkMathml(children[1]) : '';
    return `${base}_{${sub}}`;
  }

  if (tag === 'msubsup') {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : '';
    const sub = children[1] ? _walkMathml(children[1]) : '';
    const sup = children[2] ? _walkMathml(children[2]) : '';
    return `${base}_{${sub}}^{${sup}}`;
  }

  if (tag === 'munder') {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : '';
    const under = children[1] ? _walkMathml(children[1]) : '';
    return `\\underbrace{${base}}_{${under}}`;
  }

  if (tag === 'mover') {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : '';
    const over = children[1] ? _walkMathml(children[1]) : '';
    const overText = over.trim();
    if (overText === '\\overline') return `\\overline{${base}}`;
    if (overText === '\\hat') return `\\hat{${base}}`;
    if (overText === '\\vec') return `\\vec{${base}}`;
    if (overText === '\\dot') return `\\dot{${base}}`;
    if (overText === '\\ddot') return `\\ddot{${base}}`;
    return `\\overbrace{${base}}^{${over}}`;
  }

  if (tag === 'munderover') {
    const children = _getMathmlChildren(node);
    const base = children[0] ? _walkMathml(children[0]) : '';
    const under = children[1] ? _walkMathml(children[1]) : '';
    const over = children[2] ? _walkMathml(children[2]) : '';
    return `\\underset{${under}}{\\overset{${over}}{${base}}}`;
  }

  if (tag === 'msqrt') {
    const children = _getMathmlChildren(node);
    const inner = children[0] ? _walkMathml(children[0]) : '';
    return `\\sqrt{${inner}}`;
  }

  if (tag === 'mroot') {
    const children = _getMathmlChildren(node);
    const inner = children[0] ? _walkMathml(children[0]) : '';
    const deg = children[1] ? _walkMathml(children[1]) : '';
    return `\\sqrt[${deg}]{${inner}}`;
  }

  if (tag === 'mtable') {
    const rows = [];
    for (const tr of node.children) {
      if (tr.localName === 'mtr') {
        const cells = [];
        for (const td of tr.children) {
          if (td.localName === 'mtd') {
            cells.push(_walkMathml(td));
          }
        }
        rows.push(cells.join(' & '));
      }
    }
    return `\\begin{matrix}\n${rows.join(' \\\\\n')}\n\\end{matrix}`;
  }

  if (tag === 'menclose') {
    const children = _getMathmlChildren(node);
    const inner = children[0] ? _walkMathml(children[0]) : '';
    const notation = node.getAttribute('notation') || '';
    if (notation.includes('roundedbox')) return `\\boxed{${inner}}`;
    if (notation.includes('actuarial')) return `\\overline{${inner}}\\rule{0.5pt}{1em}`;
    return inner;
  }

  if (tag === 'mstyle') {
    const children = _getMathmlChildren(node);
    if (children.length === 1) return _walkMathml(children[0]);
    return children.map(_walkMathml).join('');
  }

  if (tag === 'mpadded' || tag === 'mphantom' || tag === 'merror' || tag === 'maction') {
    const children = _getMathmlChildren(node);
    if (children.length === 1) return _walkMathml(children[0]);
    return children.map(_walkMathml).join('');
  }

  if (tag === 'mlabeledtr') {
    const children = _getMathmlChildren(node);
    return children.map(_walkMathml).join('');
  }

  // mrow, math, etc: recurse into children
  if (node.children) {
    return Array.from(node.children).map(_walkMathml).join('');
  }
  return '';
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
    Logger.info('UIController initializing...');
    this.currentSection = 'editor';
    this.editor = new FormulaEditor();
    this.library = new FormulaLibrary();
    this.themeManager = new ThemeManager();
    this.settingsManager = new SettingsManager();
    this.platformOperations = new Set();

    this.initCustomSelects();
    this.initEventListeners();
    this.initLibrary();
    this.applySettings();
    this.themeManager.updateButton();
    this.loadPlatforms();
    this.renderPlatformList();
    this.updateOfficeInsertButton();
    this.updateMdCopyButton();

    this.initHistoryDb();
    
    Logger.info('UIController ready');
  }

  initCustomSelects() {
    document.querySelectorAll('.custom-select').forEach(el => {
      el._selectInstance = new CustomSelect(el);
    });
  }

  initEventListeners() {
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchSection(e.target.id.replace('Btn', ''));
      });
    });

    const sidebarPanel = document.getElementById('sidebarPanel');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebarTrigger = document.getElementById('sidebarTrigger');
    const sidebarClose = document.getElementById('sidebarClose');

    const openSidebar = () => {
      sidebarPanel?.classList.add('open');
      sidebarOverlay?.classList.add('visible');
      sidebarTrigger.style.display = 'none';
    };

    const closeSidebar = () => {
      sidebarPanel?.classList.remove('open');
      sidebarOverlay?.classList.remove('visible');
      sidebarTrigger.style.display = 'flex';
    };

    sidebarTrigger?.addEventListener('click', openSidebar);
    sidebarClose?.addEventListener('click', closeSidebar);
    sidebarOverlay?.addEventListener('click', closeSidebar);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebarPanel?.classList.contains('open')) {
        closeSidebar();
      }
    });

    let isDragging = false;
    let dragStartY = 0;
    let triggerStartY = 0;

    sidebarTrigger?.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartY = e.clientY;
      triggerStartY = sidebarTrigger.offsetTop;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const delta = e.clientY - dragStartY;
      const newTop = triggerStartY + delta;
      const minTop = 60;
      const maxTop = window.innerHeight - 110;
      const clampedTop = Math.max(minTop, Math.min(maxTop, newTop));
      sidebarTrigger.style.top = clampedTop + 'px';
      sidebarTrigger.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    let openTimeout = null;
    let closeTimeout = null;

    document.addEventListener('mousemove', (e) => {
      if (isDragging) return;
      const threshold = 30;
      const isNearRightEdge = e.clientX >= window.innerWidth - threshold;
      const isInsideSidebar = sidebarPanel?.contains(e.target);
      const isOnTrigger = sidebarTrigger?.contains(e.target);

      if (openTimeout) { clearTimeout(openTimeout); openTimeout = null; }
      if (closeTimeout) { clearTimeout(closeTimeout); closeTimeout = null; }

      if (sidebarPanel?.classList.contains('open')) {
        if (!isInsideSidebar && !isOnTrigger && !isNearRightEdge) {
          closeTimeout = setTimeout(closeSidebar, 500);
        }
      } else {
        if (isNearRightEdge && sidebarTrigger?.style.display !== 'none') {
          openTimeout = setTimeout(openSidebar, 300);
        }
      }
    });

    sidebarPanel?.addEventListener('mouseenter', () => {
      if (closeTimeout) { clearTimeout(closeTimeout); closeTimeout = null; }
    });

    sidebarTrigger?.addEventListener('mouseleave', () => {
      if (openTimeout) { clearTimeout(openTimeout); openTimeout = null; }
    });

    document.querySelectorAll('.settings-item').forEach(item => {
      item.addEventListener('click', () => {
        const pageId = item.dataset.page;
        document.getElementById('settingsList').style.display = 'none';
        document.getElementById(pageId)?.classList.add('active');
        Logger.debug(`Settings: open ${pageId}`);
      });
    });

    document.querySelectorAll('.settings-back').forEach(btn => {
      btn.addEventListener('click', () => {
        const subpage = btn.closest('.settings-subpage');
        subpage.style.animation = 'none';
        subpage.offsetHeight;
        subpage.style.animation = 'fadeSlideLeft 0.25s ease';
        subpage.classList.remove('active');
        const list = document.getElementById('settingsList');
        list.style.animation = 'none';
        list.offsetHeight;
        list.style.animation = 'fadeSlideIn 0.25s ease';
        list.style.display = 'block';
        Logger.debug('Settings: back to list');
      });
    });

    document.getElementById('testBridgeBtn')?.addEventListener('click', async () => {
      const resultEl = document.getElementById('bridgeTestResult');
      if (resultEl) {
        resultEl.textContent = '测试中...';
        resultEl.className = 'settings-hint';
      }
      
      const connected = await this.connectBridge();
      if (resultEl) {
        if (connected) {
          resultEl.textContent = '连接成功';
          resultEl.className = 'settings-hint success';
        } else {
          resultEl.textContent = '连接失败';
          resultEl.className = 'settings-hint error';
        }
      }
    });

    document.getElementById('themeToggle')?.addEventListener('click', () => {
      this.themeManager.toggle();
    });

    document.getElementById('copyLatex')?.addEventListener('click', () => this.copyFormula('latex'));
    document.getElementById('copyMathml')?.addEventListener('click', () => this.copyFormula('mathml'));
    document.getElementById('copySvg')?.addEventListener('click', () => this.copyFormula('svg'));
    document.getElementById('copyMd')?.addEventListener('click', () => this.copyFormula('md'));

    document.getElementById('insertToWord')?.addEventListener('click', () => this.insertToWord());
    document.getElementById('loadFromWord')?.addEventListener('click', () => this.loadFromWord());
    document.getElementById('insertTableBtn')?.addEventListener('click', () => this.insertTableToWord());
    document.getElementById('readTableBtn')?.addEventListener('click', () => this.readTableFromWord());
    this.updateOfficeInsertButton();
    this.updateMdCopyButton();
    this.updateMdCopyButton();

    document.getElementById('quickCopy')?.addEventListener('click', () => {
      const enabledPlatform = this.platforms.find(p => p.enabled);
      if (enabledPlatform) {
        this.copyFormula(enabledPlatform.format);
        this.showToast(`已复制 ${enabledPlatform.name} 格式`);
      } else {
        this.copyFormula('latex');
      }
    });

    document.getElementById('fontStyleSelect')?.addEventListener('change', (e) => {
      this.updateFontStyle(e.detail.value);
    });

    document.getElementById('fontColor')?.addEventListener('input', (e) => {
      this.updateFontColor(e.target.value);
    });
    
    document.getElementById('colorPreview')?.addEventListener('click', () => {
      document.getElementById('fontColor')?.click();
    });

    document.getElementById('displayMode')?.addEventListener('change', (e) => {
      const display = e.target.checked;
      Logger.info(`displayMode: ${display}`);
      const latex = this.editor.getLatex();
      if (latex) {
        this.editor.updatePreview(latex);
      }
    });

    document.getElementById('latexSource')?.addEventListener('input', (e) => {
      let latex = e.target.value;

      latex = latex.replace(/^\$\$\s*/m, '').replace(/\s*\$\$\s*$/m, '');
      latex = latex.replace(/^\$\s*/, '').replace(/\s*\$/, '');

      this.editor.setLatex(latex);
      this.editor.updatePreview(latex);
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.copyFormula('latex');
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        const latex = this.editor.getLatex();
        if (latex) {
          navigator.clipboard.writeText(latex).catch(() => {});
          this.switchSection('editor');
          this.showToast('已复制，可粘贴到目标编辑器');
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const latex = this.editor.getLatex();
        if (latex) {
          ExportHelper.exportToTex(latex);
          this.showToast('已导出 .tex 文件');
        }
      }
    });

    document.getElementById('librarySearch')?.addEventListener('input', (e) => {
      this.searchLibrary(e.target.value);
    });

    document.getElementById('screenshotBtn')?.addEventListener('click', () => {
      this.startScreenshot();
    });
    document.getElementById('ocrInsertBtn')?.addEventListener('click', () => {
      this.insertOcrResult();
    });
    document.getElementById('ocrCopyBtn')?.addEventListener('click', () => {
      this.copyOcrResult();
    });

    document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
      this.clearAllHistory(false);
    });
    document.getElementById('clearHistoryBtn2')?.addEventListener('click', () => {
      this.clearAllHistory(false);
    });

    document.querySelectorAll('.history-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.history-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.historyFilter = btn.dataset.filter;
        this.renderHistoryList();
      });
    });

    document.getElementById('defaultDisplayModeSelect')?.addEventListener('change', (e) => {
      this.settingsManager.set('displayMode', e.detail.value);
      Logger.info(`Settings: displayMode = ${e.detail.value}`);
    });
    document.getElementById('defaultFontStyleSelect')?.addEventListener('change', (e) => {
      this.settingsManager.set('fontStyle', e.detail.value);
      Logger.info(`Settings: fontStyle = ${e.detail.value}`);
    });
    document.getElementById('bridgeUrlInput')?.addEventListener('change', (e) => {
      this.settingsManager.set('bridgeUrl', e.target.value);
      Logger.info(`Settings: bridgeUrl = ${e.target.value}`);
    });

    document.getElementById('ocrEnabledToggle')?.addEventListener('change', (e) => {
      this.settingsManager.set('ocrEnabled', e.target.checked);
      this.updateTabVisibility();
      Logger.info(`Settings: ocrEnabled = ${e.target.checked}`);
    });

    Logger.debug('Event listeners ready');

    this.initNativeOffice();
  }

  initNativeOffice() {
    window.__app = this;

    // Host selector state
    this._selectedSessionId = null;
    this._sessions = [];

    // Update host selector dropdown
    this.updateOfficeHostSelector = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const sessions = await invoke('native_office_sessions');
        this._sessions = sessions || [];

        const selector = document.getElementById('officeTargetHost');
        const selectorContainer = document.getElementById('officeHostSelector');
        if (!selector || !selectorContainer) return;

        if (this._sessions.length === 0) {
          selector.innerHTML = '';
          selectorContainer.style.display = 'none';
          this._selectedSessionId = null;
          return;
        }

        selectorContainer.style.display = 'inline-block';
        selector.innerHTML = '';

        for (const session of this._sessions) {
          const opt = document.createElement('div');
          opt.className = 'custom-select-option';
          opt.dataset.value = session.session_id;
          opt.textContent = `${session.host_type} - ${session.document_title || '未命名'}`;
          opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const trigger = selectorContainer.querySelector('.custom-select-trigger');
            trigger.querySelector('span').textContent = opt.textContent;
            trigger.dataset.value = opt.dataset.value;
            this._selectedSessionId = opt.dataset.value;
            selectorContainer.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            selectorContainer.classList.remove('open');
            Logger.info(`Office target: ${this._selectedSessionId || 'none'}`);
          });
          selector.appendChild(opt);
        }

        // Auto-select: keep previous selection if still valid, else pick first
        const trigger = selectorContainer.querySelector('.custom-select-trigger');
        let selectedOption = null;
        if (this._selectedSessionId) {
          selectedOption = selector.querySelector(`[data-value="${this._selectedSessionId}"]`);
        }
        if (!selectedOption) {
          selectedOption = selector.querySelector('.custom-select-option');
        }
        if (selectedOption) {
          trigger.querySelector('span').textContent = selectedOption.textContent;
          trigger.dataset.value = selectedOption.dataset.value;
          selectedOption.classList.add('selected');
          this._selectedSessionId = selectedOption.dataset.value;
        }

        // Toggle dropdown
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
          selectorContainer.classList.toggle('open');
        });
      } catch (e) {
        Logger.error('Failed to update host selector:', e);
      }
    };

    // Close dropdown on outside click
    document.addEventListener('click', () => {
      document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
    });

    // Listen for session changes
    this.initNativeOfficeEvents();

    // Initial selector update
    this.updateOfficeHostSelector();

    // Insert formula via Native Office Pipe
    window.insertFormula = async () => {
      const latex = this.editor?.getLatex();
      if (!latex) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');

        // Get selected session from dropdown
        const sessionId = this._selectedSessionId;
        if (!sessionId) {
          this.showToast('请先选择目标 Office 宿主');
          return;
        }

        const session = this._sessions.find(s => s.session_id === sessionId);
        if (!session) {
          this.showToast('所选会话不存在');
          return;
        }

        // Get OMML from Rust
        console.log(`[Insert] Converting LaTeX: "${latex}"`);
        const omml = await invoke('latex_to_omml', { latex });
        console.log(`[Insert] OMML length: ${omml?.length || 0}`);

        // Render SVG for Excel/PPT (Word uses OMML directly)
        let svg = null;
        let widthPt = 0;
        let heightPt = 0;
        if (session.host_type !== 'word') {
          try {
            if (!window.MathJax) {
              await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = './public/mathjax/tex-svg.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
              });
            }
            if (window.MathJax) {
              await window.MathJax.startup.promise;
              const node = await window.MathJax.tex2svgPromise(latex, { display: true });
              const svgElement = node.querySelector('svg');
              if (svgElement) {
                svg = svgElement.outerHTML;
                const viewBox = svgElement.getAttribute('viewBox');
                if (viewBox) {
                  const parts = viewBox.split(' ');
                  widthPt = parseFloat(parts[2]) || 120;
                  heightPt = parseFloat(parts[3]) || 30;
                }
              }
            }
          } catch (e) {
            Logger.error('SVG render error:', e);
          }
        }

        console.log(`[Insert] Sending to session ${sessionId} (${session.host_type})`);
        await invoke('native_office_insert_formula', {
          sessionId: sessionId,
          formulaId: crypto.randomUUID(),
          latex: latex,
          omml: omml,
          display: 'block',
          mode: 'display',
          svg: svg,
          widthPt: widthPt,
          heightPt: heightPt
        });
        this.showToast(`已发送到 ${session.host_type}`);
        this.addHistoryItem(latex);
      } catch (e) {
        this.showToast('发送失败: ' + e.message);
      }
    };

    window.loadSelection = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const sessionId = this._selectedSessionId;
        if (!sessionId) {
          this.showToast('请先选择目标 Office 宿主');
          return;
        }
        this.showToast('正在读取选区...');
        await invoke('native_office_request_read_selection', { sessionId });
      } catch (e) {
        this.showToast('读取失败: ' + e.message);
      }
    };

    window.deleteSelection = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const sessionId = this._selectedSessionId;
        if (!sessionId) {
          this.showToast('请先选择目标 Office 宿主');
          return;
        }
        await invoke('native_office_delete_current', {
          sessionId: sessionId,
          formulaId: null
        });
        this.showToast('已删除');
      } catch (e) {
        this.showToast('删除失败: ' + e.message);
      }
    };
  }

  async initNativeOfficeEvents() {
    try {
      const { listen } = await import('@tauri-apps/api/event');

      // Office loaded formula from selection
      listen('native-office-latex-loaded', async (event) => {
        const { latex, sessionId } = event.payload;
        Logger.info(`Native Office: loaded latex from ${sessionId}: ${latex}`);
        if (latex) {
          this.switchSection('editor');
          this.editor.setLatex(latex);
          this.showToast('已加载选中的公式');
        }
      });

      // Office loaded table
      listen('native-office-table-loaded', async (event) => {
        const { table, xml, sessionId } = event.payload;
        Logger.info(`Native Office: loaded table from ${sessionId}`);

        if (table) {
          // Structured TablePayload - handle nested structure
          // Rust sends: { tableId, table: { rows: [...] }, formulas: {...} }
          const tableData = table.table || table;
          const rows = tableData.rows || [];
          const formulas = table.formulas || {};

          let markdown = '| ';
          for (const row of rows) {
            const cells = row.cells || [];
            const cellTexts = cells.map(cell => {
              const inlines = cell.inlines || [];
              return inlines.map(inline => {
                if (inline.type === 'formula') {
                  // Check inline formula first, then formulas dict
                  const formula = inline.formula || formulas[inline.formulaRef];
                  return formula?.latex || `[${inline.formulaRef}]`;
                }
                return inline.text || '';
              }).join(' ');
            });
            markdown += cellTexts.join(' | ') + ' |\n';
          }
          this.switchSection('editor');
          this.editor.setLatex(markdown);
          this.showToast('已加载表格');
        } else if (xml) {
          // Fallback: raw XML
          this.showToast('已加载表格 (原始格式)');
        }
      });

      // Office insert result
      listen('native-office-insert-result', async (event) => {
        const { success, formulaId, error, sessionId } = event.payload;
        if (success) {
          Logger.info(`Native Office: formula inserted (id=${formulaId})`);
        } else {
          Logger.error(`Native Office: insert failed: ${error}`);
          this.showToast('插入失败: ' + error);
        }
      });

      // Office error
      listen('native-office-error', async (event) => {
        const { error, errorCode, sessionId } = event.payload;
        Logger.error(`Native Office error [${errorCode}]: ${error}`);
        this.showToast('Office 错误: ' + error);
      });

      // Open editor requested from Office
      listen('native-office-open-editor', async (event) => {
        const { sessionId } = event.payload;
        Logger.info(`Native Office: open editor requested from ${sessionId}`);
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        await win.show();
        await win.setFocus();
      });

      // Session added/updated/removed - refresh selector
      listen('native-office-session-added', async () => {
        await this.updateOfficeHostSelector();
      });
      listen('native-office-session-updated', async () => {
        await this.updateOfficeHostSelector();
      });
      listen('native-office-session-removed', async () => {
        await this.updateOfficeHostSelector();
      });

      // Context changed
      listen('native-office-context-changed', async (event) => {
        const { sessionId, documentTitle } = event.payload;
        Logger.info(`Native Office: context changed for ${sessionId}: ${documentTitle}`);
        // Update session title in local list immediately
        const session = this._sessions?.find(s => s.session_id === sessionId);
        if (session && documentTitle) {
          session.document_title = documentTitle;
        }
        await this.updateOfficeHostSelector();
      });

      Logger.info('Native Office events initialized');
    } catch (e) {
      Logger.error('Failed to init Native Office events:', e);
    }
  }

  latexToMathML(latex) {
    const result = this._parseLatex(latex, 0);
    return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow>${result.xml}</mrow></math>`;
  }

  _parseLatex(tex, pos) {
    let xml = '';
    while (pos < tex.length) {
      const ch = tex[pos];
      if (ch === '}' || ch === ']') { pos++; break; }
      if (ch === '{') {
        pos++;
        const inner = this._parseLatex(tex, pos);
        xml += inner.xml;
        pos = inner.pos;
      } else if (ch === '\\') {
        pos++;
        const cmd = this._readCommand(tex, pos);
        pos = cmd.pos;
        const name = cmd.name;

        const greekMap = {
          alpha:'\u03B1',beta:'\u03B2',gamma:'\u03B3',delta:'\u03B4',
          epsilon:'\u03B5',zeta:'\u03B6',eta:'\u03B7',theta:'\u03B8',
          iota:'\u03B9',kappa:'\u03BA',lambda:'\u03BB',mu:'\u03BC',
          nu:'\u03BD',xi:'\u03BE',pi:'\u03C0',rho:'\u03C1',sigma:'\u03C3',
          tau:'\u03C4',upsilon:'\u03C5',phi:'\u03C6',chi:'\u03C7',psi:'\u03C8',
          omega:'\u03C9',Gamma:'\u0393',Delta:'\u0394',Theta:'\u0398',
          Lambda:'\u039B',Xi:'\u039E',Pi:'\u03A0',Sigma:'\u03A3',
          Phi:'\u03A6',Psi:'\u03A8',Omega:'\u03A9',
          infty:'\u221E',partial:'\u2202',nabla:'\u2207',emptyset:'\u2205',
          forall:'\u2200',exists:'\u2203',neg:'\u00AC',
          int:'\u222B',iint:'\u222C',oint:'\u222E',sum:'\u2211',prod:'\u220F',
          times:'\u00D7',cdot:'\u22C5',pm:'\u00B1',mp:'\u2213',
          leq:'\u2264',geq:'\u2265',neq:'\u2260',approx:'\u2248',equiv:'\u2261',
          sim:'\u223C',propto:'\u221D',
          rightarrow:'\u2192',leftarrow:'\u2190',leftrightarrow:'\u2194',
          subset:'\u2282',supset:'\u2283',subseteq:'\u2286',supseteq:'\u2287',
          in:'\u2208',notin:'\u2209',cap:'\u2229',cup:'\u222A',
          langle:'\u27E8',rangle:'\u27E9',
          lfloor:'\u230A',rfloor:'\u230B',lceil:'\u2308',rceil:'\u2309',
        };

        if (greekMap[name]) {
          xml += `<mi>${greekMap[name]}</mi>`;
        } else if (name === 'bm' || name === 'mathbf') {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mstyle font-weight="bold"><mrow>${body.xml}</mrow></mstyle>`;
        } else if (name === 'mathit') {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mstyle font-style="italic"><mrow>${body.xml}</mrow></mstyle>`;
        } else if (name === 'text') {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mtext>${body.xml}</mtext>`;
        } else if (name === 'textcolor') {
          const color = this._readBrace(tex, pos);
          pos = color.pos;
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mstyle mathcolor="${color.xml}"><mrow>${body.xml}</mrow></mstyle>`;
        } else if (name === 'colorbox') {
          const color = this._readBrace(tex, pos);
          pos = color.pos;
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<menclose notation="roundbox"><mstyle mathbackground="${color.xml}"><mrow>${body.xml}</mrow></mstyle></menclose>`;
        } else if (name === 'color') {
          const color = this._readBrace(tex, pos);
          pos = color.pos;
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mstyle mathcolor="${color.xml}"><mrow>${body.xml}</mrow></mstyle>`;
        } else if (name === 'frac') {
          const num = this._parseGroup(tex, pos);
          pos = num.pos;
          const den = this._parseGroup(tex, pos);
          pos = den.pos;
          xml += `<mfrac><mrow>${num.xml}</mrow><mrow>${den.xml}</mrow></mfrac>`;
        } else if (name === 'sqrt') {
          if (tex[pos] === '[') {
            pos++;
            const deg = this._readBrace(tex, pos);
            pos = deg.pos
            const body = this._parseGroup(tex, pos);
            pos = body.pos;
            xml += `<mroot><mrow>${body.xml}</mrow><mrow>${deg.xml}</mrow></mroot>`;
          } else {
            const body = this._parseGroup(tex, pos);
            pos = body.pos;
            xml += `<msqrt><mrow>${body.xml}</mrow></msqrt>`;
          }
        } else if (name === 'overline') {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u00AF</mo></mover>`;
        } else if (name === 'underline') {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<munder><mrow>${body.xml}</mrow><mo>\u0332</mo></munder>`;
        } else if (name === 'hat' || name === 'widehat') {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u005E</mo></mover>`;
        } else if (name === 'vec') {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u20D7</mo></mover>`;
        } else if (name === 'dot' || name === 'ddot') {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u0307</mo></mover>`;
        } else if (name === 'quad' || name === 'qquad') {
          xml += '<mspace width="1em"/>';
        } else if (name === 'mathrm' || name === 'mathsf' || name === 'mathtt' || name === 'mathcal' || name === 'mathbb' || name === 'mathfrak') {
          const body = this._parseGroup(tex, pos);
          pos = body.pos;
          const variant = {
            mathrm: 'normal', mathbf: 'bold', mathit: 'italic',
            mathsf: 'sans-serif', mathtt: 'monospace',
            mathcal: 'script', mathbb: 'double-struck', mathfrak: 'fraktur'
          }[name] || 'normal';
          xml += `<mstyle mathvariant="${variant}"><mrow>${body.xml}</mrow></mstyle>`;
        } else if (name === 'begin') {
          const env = this._readBrace(tex, pos);
          pos = env.pos;
          if (env.xml === 'matrix' || env.xml === 'pmatrix' || env.xml === 'bmatrix' || env.xml === 'vmatrix' || env.xml === 'cases') {
            const delim = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], vmatrix: ['|', '|'], cases: ['{', ''] }[env.xml] || ['', ''];
            const rows = [];
            let row = [];
            while (pos < tex.length) {
              if (tex[pos] === '\\' && tex.substr(pos + 1, 3) === 'end') { pos += 4; if (tex[pos] === '{') { while (pos < tex.length && tex[pos] !== '}') pos++; pos++; } break; }
              if (tex[pos] === '&') { row.push(''); pos++; }
              else if (tex[pos] === '\\' && tex[pos+1] === '\\') { rows.push(row.join('<mo>&#x2062;</mo>')); row = []; pos += 2; }
              else { row.push(tex[pos]); pos++; }
            }
            if (row.length > 0) rows.push(row.join('<mo>&#x2062;</mo>'));
            xml += `<mrow>${delim[0]}<mtable>${rows.map(r => `<mtr><mtd>${r}</mtd></mtr>`).join('')}</mtable>${delim[1]}</mrow>`;
          } else {
            xml += `\\begin{${env.xml}}`;
          }
        } else if (name === 'end') {
          if (tex[pos] === '{') { while (pos < tex.length && tex[pos] !== '}') pos++; pos++; }
        } else {
          xml += `<mi>${name}</mi>`;
        }
      } else if (ch === '^') {
        pos++;
        const sup = this._parseGroup(tex, pos);
        pos = sup.pos;
        xml = `<msup><mrow>${xml}</mrow><mrow>${sup.xml}</mrow></msup>`;
      } else if (ch === '_') {
        pos++;
        const sub = this._parseGroup(tex, pos);
        pos = sub.pos;
        xml = `<msub><mrow>${xml}</mrow><mrow>${sub.xml}</mrow></msub>`;
      } else if (ch === ' ') {
        pos++;
        xml += '<mspace width="0.33em"/>';
      } else if (ch >= '0' && ch <= '9') {
        let num = '';
        while (pos < tex.length && tex[pos] >= '0' && tex[pos] <= '9') { num += tex[pos]; pos++; }
        xml += `<mn>${num}</mn>`;
      } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
        let ident = '';
        while (pos < tex.length && ((tex[pos] >= 'a' && tex[pos] <= 'z') || (tex[pos] >= 'A' && tex[pos] <= 'Z'))) {
          ident += tex[pos]; pos++;
        }
        xml += `<mi>${ident}</mi>`;
      } else if ('+-*/=()[]|!.,;:<>'.includes(ch)) {
        xml += `<mo>${ch}</mo>`;
        pos++;
      } else {
        pos++;
      }
    }
    return { xml, pos };
  }

  _parseGroup(tex, pos) {
    if (pos < tex.length && tex[pos] === '{') {
      pos++;
      return this._parseLatex(tex, pos);
    }
    let ident = '';
    while (pos < tex.length && tex[pos] !== ' ' && tex[pos] !== '{' && tex[pos] !== '}' && tex[pos] !== '\\') {
      ident += tex[pos]; pos++;
    }
    return { xml: `<mi>${ident}</mi>`, pos };
  }

  _readBrace(tex, pos) {
    if (tex[pos] === '{') {
      pos++;
      let depth = 1;
      let content = '';
      while (pos < tex.length && depth > 0) {
        if (tex[pos] === '{') depth++;
        if (tex[pos] === '}') depth--;
        if (depth > 0) content += tex[pos];
        pos++;
      }
      return { xml: content, pos };
    }
    let content = '';
    while (pos < tex.length && tex[pos] !== ' ' && tex[pos] !== '{' && tex[pos] !== '}' && tex[pos] !== '\\') {
      content += tex[pos]; pos++;
    }
    return { xml: content, pos };
  }

  _readCommand(tex, pos) {
    if (pos >= tex.length) return { name: '', pos };
    if (!tex[pos].match(/[a-zA-Z]/)) return { name: tex[pos], pos: pos + 1 };
    let name = '';
    while (pos < tex.length && tex[pos].match(/[a-zA-Z]/)) {
      name += tex[pos]; pos++;
    }
    return { name, pos };
  }

  _parseLatex(tex, pos) {
    let xml = '';
    while (pos < tex.length) {
      const ch = tex[pos];
      if (ch === '}' || ch === ']') { pos++; break; }
      if (ch === '{') {
        pos++;
        const inner = this._parseLatex(tex, pos);
        xml += inner.xml;
        pos = inner.pos;
      } else if (ch === '\\') {
        pos++;
        const cmd = this._readCommand(tex, pos);
        pos = cmd.pos;
        const name = cmd.name;
        const greekMap = { alpha:'\u03B1', beta:'\u03B2', gamma:'\u03B3', delta:'\u03B4', epsilon:'\u03B5', zeta:'\u03B6', eta:'\u03B7', theta:'\u03B8', iota:'\u03B9', kappa:'\u03BA', lambda:'\u03BB', mu:'\u03BC', nu:'\u03BD', xi:'\u03BE', pi:'\u03C0', rho:'\u03C1', sigma:'\u03C3', tau:'\u03C4', upsilon:'\u03C5', phi:'\u03C6', chi:'\u03C7', psi:'\u03C8', omega:'\u03C9', Gamma:'\u0393', Delta:'\u0394', Theta:'\u0398', Lambda:'\u039B', Xi:'\u039E', Pi:'\u03A0', Sigma:'\u03A3', Phi:'\u03A6', Psi:'\u03A8', Omega:'\u03A9', infty:'\u221E', partial:'\u2202', nabla:'\u2207', prime:'\u2032', emptyset:'\u2205', forall:'\u2200', exists:'\u2203', neg:'\u00AC', ldots:'\u2026', cdots:'\u22EF', int:'\u222B', iint:'\u222C', oint:'\u222E', sum:'\u2211', prod:'\u220F', coprod:'\u2210', sqrt:'\u221A', times:'\u00D7', cdot:'\u22C5', pm:'\u00B1', mp:'\u2213', leq:'\u2264', geq:'\u2265', neq:'\u2260', approx:'\u2248', equiv:'\u2261', sim:'\u223C', propto:'\u221D', mid:'\u2223', nmid:'\u2224', subset:'\u2282', supset:'\u2283', in:'\u2208', notin:'\u2209', cap:'\u2229', cup:'\u222A', setminus:'\u2216', alpha:'\u03B1', langle:'\u27E8', rangle:'\u27E9', lceil:'\u2308', rceil:'\u2309', lfloor:'\u230A', rfloor:'\u230B', arrow:'\u2192', leftarrow:'\u2190', Leq:'\u2A7D', Geq:'\u2A7E' };
        if (name === 'frac') {
          const num = this._parseLatex(tex, pos);
          pos = num.pos;
          const den = this._parseLatex(tex, pos);
          pos = den.pos;
          xml += `<mfrac><mrow>${num.xml}</mrow><mrow>${den.xml}</mrow></mfrac>`;
        } else if (name === 'sqrt') {
          if (tex[pos] === '[') {
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
        } else if (name === 'mathrm' || name === 'mathbf' || name === 'mathit' || name === 'mathsf' || name === 'mathtt') {
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mstyle mathvariant="${name.replace('math', '')}">${body.xml}</mstyle>`;
        } else if (name === 'text') {
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mtext>${body.xml}</mtext>`;
        } else if (name === 'left' || name === 'right' || name === 'middle') {
          pos++;
        } else if (name === 'quad' || name === 'qquad') {
          xml += '<mspace width="1em"/>';
        } else if (name === ',' || name === ';' || name === ':' || name === '!') {
          xml += '<mspace width="0.17em"/>';
        } else if (greekMap[name]) {
          xml += `<mi>${greekMap[name]}</mi>`;
        } else if (name === 'cdot') {
          xml += '<mo>\u22C5</mo>';
        } else if (name === 'times') {
          xml += '<mo>\u00D7</mo>';
        } else if (name === 'div') {
          xml += '<mo>\u00F7</mo>';
        } else if (name === 'pm') {
          xml += '<mo>\u00B1</mo>';
        } else if (name === 'mp') {
          xml += '<mo>\u2213</mo>';
        } else if (name === 'leq' || name === 'le') {
          xml += '<mo>\u2264</mo>';
        } else if (name === 'geq' || name === 'ge') {
          xml += '<mo>\u2265</mo>';
        } else if (name === 'neq' || name === 'ne') {
          xml += '<mo>\u2260</mo>';
        } else if (name === 'approx') {
          xml += '<mo>\u2248</mo>';
        } else if (name === 'equiv') {
          xml += '<mo>\u2261</mo>';
        } else if (name === 'rightarrow' || name === 'to') {
          xml += '<mo>\u2192</mo>';
        } else if (name === 'leftarrow') {
          xml += '<mo>\u2190</mo>';
        } else if (name === 'subset') {
          xml += '<mo>\u2282</mo>';
        } else if (name === 'supset') {
          xml += '<mo>\u2283</mo>';
        } else if (name === 'in') {
          xml += '<mo>\u2208</mo>';
        } else if (name === 'cup') {
          xml += '<mo>\u222A</mo>';
        } else if (name === 'cap') {
          xml += '<mo>\u2229</mo>';
        } else if (name === 'forall') {
          xml += '<mo>\u2200</mo>';
        } else if (name === 'exists') {
          xml += '<mo>\u2203</mo>';
        } else if (name === 'nabla') {
          xml += '<mo>\u2207</mo>';
        } else if (name === 'partial') {
          xml += '<mo>\u2202</mo>';
        } else if (name === 'infty') {
          xml += '<mi>\u221E</mi>';
        } else if (name === 'emptyset') {
          xml += '<mi>\u2205</mi>';
        } else if (name === 'sum') {
          xml += '<mo>\u2211</mo>';
        } else if (name === 'prod') {
          xml += '<mo>\u220F</mo>';
        } else if (name === 'int') {
          xml += '<mo>\u222B</mo>';
        } else if (name === 'oint') {
          xml += '<mo>\u222E</mo>';
        } else if (name === 'ldots') {
          xml += '<mo>\u2026</mo>';
        } else if (name === 'langle') {
          xml += '<mo>\u27E8</mo>';
        } else if (name === 'rangle') {
          xml += '<mo>\u27E9</mo>';
        } else if (name === 'overline') {
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u00AF</mo></mover>`;
        } else if (name === 'underline') {
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<munder><mrow>${body.xml}</mrow><mo>\u0332</mo></munder>`;
        } else if (name === 'hat') {
          const body = this._parseLatex(tex, pos);
          pos = body.pos;
          xml += `<mover><mrow>${body.xml}</mrow><mo>\u005E</mo></mover>`;
        } else {
          xml += `<mi>${name}</mi>`;
        }
      } else if (ch === '^') {
        pos++;
        if (tex[pos] === '{') {
          pos++;
          const sup = this._parseLatex(tex, pos);
          pos = sup.pos;
          xml = `<msup><mrow>${xml}</mrow><mrow>${sup.xml}</mrow></msup>`;
        } else {
          const sup = this._parseLatex(tex, pos);
          pos = sup.pos;
          xml = `<msup><mrow>${xml}</mrow><mrow>${sup.xml}</mrow></msup>`;
        }
      } else if (ch === '_') {
        pos++;
        if (tex[pos] === '{') {
          pos++;
          const sub = this._parseLatex(tex, pos);
          pos = sub.pos;
          xml = `<msub><mrow>${xml}</mrow><mrow>${sub.xml}</mrow></msub>`;
        } else {
          const sub = this._parseLatex(tex, pos);
          pos = sub.pos;
          xml = `<msub><mrow>${xml}</mrow><mrow>${sub.xml}</mrow></msub>`;
        }
      } else if (ch === ' ') {
        pos++;
        xml += '<mspace width="0.33em"/>';
      } else if (ch === '~') {
        pos++;
        xml += '<mspace width="0.33em"/>';
      } else if (ch >= '0' && ch <= '9') {
        let num = '';
        while (pos < tex.length && tex[pos] >= '0' && tex[pos] <= '9') {
          num += tex[pos]; pos++;
        }
        xml += `<mn>${num}</mn>`;
      } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
        let ident = ch;
        pos++;
        while (pos < tex.length && ((tex[pos] >= 'a' && tex[pos] <= 'z') || (tex[pos] >= 'A' && tex[pos] <= 'Z'))) {
          ident += tex[pos]; pos++;
        }
        xml += `<mi>${ident}</mi>`;
      } else if ('+-*/=()[]|!.,;:<>'.includes(ch)) {
        xml += `<mo>${ch}</mo>`;
        pos++;
      } else {
        pos++;
      }
    }
    return { xml, pos };
  }

  _readCommand(tex, pos) {
    if (pos >= tex.length) return { name: '', pos };
    const ch = tex[pos];
    if (!ch.match(/[a-zA-Z]/)) return { name: tex[pos], pos: pos + 1 };
    let name = '';
    while (pos < tex.length && tex[pos].match(/[a-zA-Z]/)) {
      name += tex[pos]; pos++;
    }
    return { name, pos };
  }

  async initLibrary() {
    Logger.debug('Initializing formula library...');

    await this.library.load();

    Logger.debug(`Library loaded: ${this.library.categories.length} categories`);

    const categorySelect = document.getElementById('categorySelect');
    const categoryDropdown = document.getElementById('categoryDropdown');
    const grid = document.getElementById('libraryGrid');

    if (!categorySelect || !categoryDropdown || !grid) {
      Logger.warn('Library UI elements not found');
      return;
    }

    this.library.getCategories().forEach((cat, i) => {
      const option = document.createElement('div');
      option.className = `custom-select-option${i === 0 ? ' selected' : ''}`;
      option.textContent = cat.name;
      option.dataset.value = cat.id;
      option.addEventListener('click', () => {
        Logger.debug(`Category selected: ${cat.name}`);
        categorySelect.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        categorySelect.querySelector('.custom-select-trigger span').textContent = cat.name;
        categorySelect.querySelector('.custom-select-trigger').dataset.value = cat.id;
        categorySelect.classList.remove('open');
        this.renderFormulas(cat.id);
      });
      categoryDropdown.appendChild(option);
    });

    if (this.library.getCategories().length > 0) {
      const firstCategory = this.library.getCategories()[0];
      categorySelect.querySelector('.custom-select-trigger span').textContent = firstCategory.name;
      categorySelect.querySelector('.custom-select-trigger').dataset.value = firstCategory.id;
      Logger.debug(`Rendering first category: ${firstCategory.name}`);
      this.renderFormulas(firstCategory.id);
    }

    Logger.info('Formula library initialized');
  }

  renderFormulas(categoryId) {
    Logger.debug(`renderFormulas: categoryId=${categoryId}`);
    const grid = document.getElementById('libraryGrid');
    if (!grid) {
      Logger.warn('libraryGrid not found');
      return;
    }

    const formulas = this.library.getFormulas(categoryId);
    Logger.debug(`Found ${formulas.length} formulas for ${categoryId}`);

    grid.innerHTML = '';

    if (formulas.length === 0) {
      grid.innerHTML = '<div style="color: var(--muted); text-align: center; padding: 1rem; grid-column: 1/-1;">暂无公式</div>';
      return;
    }

    formulas.forEach(formula => {
      const item = document.createElement('div');
      item.className = 'formula-item';
      item.title = formula.latex;
      item.innerHTML = `
        <div class="formula-label">${formula.label}</div>
        <div class="formula-latex">${formula.latex}</div>
      `;
      item.addEventListener('click', () => this.insertFormula(formula.latex));
      grid.appendChild(item);
    });

    Logger.debug(`Rendered ${formulas.length} formula items`);
  }

  searchLibrary(query) {
    const grid = document.getElementById('libraryGrid');
    if (!grid) return;

    if (!query) {
      const categorySelect = document.getElementById('categorySelect');
      const currentCategory = categorySelect?.querySelector('.custom-select-trigger')?.dataset?.value;
      if (currentCategory) {
        this.renderFormulas(currentCategory);
      }
      return;
    }

    const results = this.library.search(query);
    grid.innerHTML = '';

    if (results.length === 0) {
      grid.innerHTML = '<div style="color: var(--muted); text-align: center; padding: 1rem; grid-column: 1/-1;">未找到匹配公式</div>';
      return;
    }

    results.forEach(({ formula, category }) => {
      const item = document.createElement('div');
      item.className = 'formula-item';
      item.title = `${formula.latex}\n分类: ${category}`;
      item.innerHTML = `
        <div class="formula-label">${formula.label}</div>
        <div class="formula-latex">${formula.latex}</div>
      `;
      item.addEventListener('click', () => this.insertFormula(formula.latex));
      grid.appendChild(item);
    });

    Logger.debug(`Search results: ${results.length}`);
  }

  insertFormula(latex) {
    Logger.info(`insertFormula: ${latex}`);

    this.addHistoryItem(latex);

    const mfLatex = latex.replace(/#\?/g, '#{}');

    if (this.mathfield) {
      this.mathfield.insert(mfLatex, { mode: 'math', focus: true, format: 'latex' });
      const newLatex = this.mathfield.getValue('latex');
      this.editor.updatePreview(newLatex);
      const source = document.getElementById('latexSource');
      if (source) source.value = newLatex;
    } else {
      const currentLatex = this.editor.getLatex();
      const newLatex = currentLatex ? currentLatex + mfLatex : mfLatex;
      this.editor.setLatex(newLatex);
      this.editor.updatePreview(newLatex);
    }

    this.showToast('已插入公式');
  }

  // ═══════════════════════════════════════════
  // History Management
  // ═══════════════════════════════════════════
  historyDb = null;
  historyFilter = 'all';

  async initHistoryDb() {
    try {
      this.historyDb = await new Promise((resolve, reject) => {
        const request = indexedDB.open('latexsnipper-office-history', 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('results')) {
            const store = db.createObjectStore('results', {
              keyPath: 'id',
              autoIncrement: true,
            });
            store.createIndex('createdAt', 'createdAt');
            store.createIndex('favorite', 'favorite');
          }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
      });
      Logger.info('History DB initialized');
    } catch (e) {
      Logger.warn('IndexedDB not available, using localStorage fallback');
    }
  }

  async addHistoryItem(latex) {
    const item = {
      latex,
      type: 'formula',
      source: 'editor',
      favorite: false,
      createdAt: Date.now(),
    };

    if (this.historyDb) {
      await new Promise((resolve, reject) => {
        const tx = this.historyDb.transaction('results', 'readwrite');
        tx.objectStore('results').add(item);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    } else {
      const history = JSON.parse(localStorage.getItem('formulaHistory') || '[]');
      history.unshift({ ...item, id: Date.now() });
      localStorage.setItem('formulaHistory', JSON.stringify(history.slice(0, 50)));
    }
    this.renderHistoryList();
  }

  async getHistoryItems(filter = 'all') {
    if (this.historyDb) {
      const items = await new Promise((resolve, reject) => {
        const tx = this.historyDb.transaction('results', 'readonly');
        const request = tx.objectStore('results').index('createdAt').getAll();
        request.onsuccess = () => resolve(request.result.reverse());
        request.onerror = (e) => reject(e.target.error);
      });
      if (filter === 'favorites') return items.filter(r => r.favorite);
      return items;
    }
    const history = JSON.parse(localStorage.getItem('formulaHistory') || '[]');
    if (filter === 'favorites') return history.filter(r => r.favorite);
    return history;
  }

  async toggleFavoriteHistory(id) {
    if (this.historyDb) {
      return await new Promise((resolve, reject) => {
        const tx = this.historyDb.transaction('results', 'readwrite');
        const store = tx.objectStore('results');
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
        const tx = this.historyDb.transaction('results', 'readwrite');
        tx.objectStore('results').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    } else {
      const history = JSON.parse(localStorage.getItem('formulaHistory') || '[]');
      localStorage.setItem('formulaHistory', JSON.stringify(history.filter(h => h.id !== id)));
    }
  }

  async clearAllHistory(keepFavorites = true) {
    if (this.historyDb) {
      await new Promise((resolve, reject) => {
        const tx = this.historyDb.transaction('results', 'readwrite');
        const store = tx.objectStore('results');
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
        const history = JSON.parse(localStorage.getItem('formulaHistory') || '[]');
        localStorage.setItem('formulaHistory', JSON.stringify(history.filter(h => h.favorite)));
      } else {
        localStorage.removeItem('formulaHistory');
      }
    }
    this.renderHistoryList();
    this.showToast('历史记录已清空');
  }

  async renderHistoryList() {
    const listEl = document.getElementById('historyList');
    if (!listEl) return;

    const items = await this.getHistoryItems(this.historyFilter);

    if (items.length === 0) {
      listEl.innerHTML = '<div class="history-empty">暂无历史记录<br>使用编辑器或 OCR 添加公式</div>';
      return;
    }

    listEl.innerHTML = items.map(item => {
      const time = new Date(item.createdAt).toLocaleString('zh-CN');
      const sourceMap = { editor: '编辑器', ocr: 'OCR', formula: '公式库' };
      const srcLabel = sourceMap[item.source] || '编辑器';
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
              <button class="hi-fav ${item.favorite ? 'active' : ''}" data-action="fav" title="收藏">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${item.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.history-item').forEach(card => {
      this.initSwipe(card);
      // Click to quickly insert formula to editor
      card.addEventListener('click', async (e) => {
        if (e.target.closest('.hi-fav')) return;
        // Skip if card is in swiped position
        if (card.style.transform && card.style.transform !== 'none' && card.style.transform !== '') return;
        const id = Number(card.dataset.id);
        const items = await this.getHistoryItems();
        const item = items.find(x => x.id === id);
        if (!item) return;
        this.editor.setLatex(item.latex);
        this.editor.updatePreview(item.latex);
        const source = document.getElementById('latexSource');
        if (source) source.value = item.latex;
        this.switchSection('editor');
        this.showToast('已加载公式');
      });
    });

    listEl.addEventListener('click', (e) => {
      if (!e.target.closest('.history-item') && !e.target.closest('.hi-swipe-delete') && !e.target.closest('.hi-swipe-btn') && !e.target.closest('.hi-fav')) {
        listEl.querySelectorAll('.history-item').forEach(card => {
          if (card.style.transform && card.style.transform !== 'none') {
            card.style.transition = 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)';
            card.style.transform = '';
            const wrap = card.parentElement;
            const dz = wrap?.querySelector('.hi-swipe-delete');
            const az = wrap?.querySelector('.hi-swipe-actions');
            if (dz) dz.style.width = '0';
            if (az) {
              az.style.width = '0';
              az.classList.remove('fav-mode');
              az.querySelectorAll('.hi-swipe-btn').forEach(b => b.classList.remove('visible'));
            }
            setTimeout(() => { card.style.transition = ''; }, 300);
          }
        });
      }
    });

    listEl.querySelectorAll('.hi-fav').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.closest('.history-item').dataset.id);
        await this.toggleFavoriteHistory(id);
        this.renderHistoryList();
      });
    });
  }

  // ═══════════════════════════════════════════
  // Swipe Gesture Handling
  // ═══════════════════════════════════════════
  initSwipe(card) {
    let startX = 0, startY = 0, startTime = 0;
    let tracking = false, currentDx = 0;

    const wrap = card.parentElement;
    const bg = wrap.querySelector('.hi-swipe-bg');
    const deleteZone = bg?.querySelector('.hi-swipe-delete');
    const actionZone = bg?.querySelector('.hi-swipe-actions');
    const actionBtns = actionZone ? [...actionZone.querySelectorAll('.hi-swipe-btn')] : [];

    const setZoneWidths = (dx) => {
      if (!bg) return;
      const dz = bg.querySelector('.hi-swipe-delete');
      const az = bg.querySelector('.hi-swipe-actions');
      const favLabel = az?.querySelector('.hi-swipe-fav-label');
      const wrapWidth = wrap.offsetWidth;
      const abs = Math.abs(dx);

      if (dx > 0) {
        if (dz) dz.style.width = Math.round(Math.min(dx, wrapWidth * 0.3)) + 'px';
        if (az) { az.style.width = '0'; az.classList.remove('fav-mode'); }
        actionBtns.forEach(b => b.classList.remove('visible'));
        if (favLabel) favLabel.style.opacity = '0';
        if (dz) dz.style.pointerEvents = dx > 50 ? 'auto' : 'none';
      } else if (dx < 0) {
        if (az) az.style.width = Math.round(Math.min(abs, wrapWidth * 0.5)) + 'px';
        if (dz) dz.style.width = '0';

        if (abs > wrapWidth * 0.55) {
          if (az) az.classList.add('fav-mode');
          actionBtns.forEach(b => b.classList.remove('visible'));
          if (favLabel) favLabel.style.opacity = '1';
        } else if (abs > wrapWidth * 0.2) {
          if (az) az.classList.remove('fav-mode');
          actionBtns.forEach(b => b.classList.add('visible'));
          if (favLabel) favLabel.style.opacity = '0';
        } else {
          if (az) az.classList.remove('fav-mode');
          actionBtns.forEach(b => b.classList.remove('visible'));
          if (favLabel) favLabel.style.opacity = '0';
        }
      } else {
        if (dz) dz.style.width = '0';
        if (az) {
          az.style.width = '0';
          az.classList.remove('fav-mode');
          actionBtns.forEach(b => b.classList.remove('visible'));
          if (favLabel) favLabel.style.opacity = '0';
        }
      }
    };

    const returnToOrigin = (smooth = true) => {
      if (smooth) {
        card.classList.remove('swiping');
        card.classList.add('returning');
        card.style.transform = '';
        if (deleteZone) deleteZone.classList.remove('no-transition');
        if (actionZone) actionZone.classList.remove('no-transition');
      } else {
        card.style.transition = 'none';
        card.style.transform = '';
        if (deleteZone) deleteZone.classList.add('no-transition');
        if (actionZone) actionZone.classList.add('no-transition');
        requestAnimationFrame(() => { card.style.transition = ''; });
      }
      setZoneWidths(0);
      setTimeout(() => card.classList.remove('returning'), 300);
    };

    const snapTo = (dir) => {
      const wrapWidth = wrap.offsetWidth;
      const pos = dir > 0 ? 100 : -160;
      card.style.transition = 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)';
      card.style.transform = `translateX(${pos}px)`;
      if (deleteZone) deleteZone.classList.remove('no-transition');
      if (actionZone) { actionZone.classList.remove('no-transition'); actionZone.classList.remove('fav-mode'); }
      if (dir > 0 && deleteZone) {
        deleteZone.style.width = '100px';
        actionBtns.forEach(b => b.classList.remove('visible'));
      } else if (dir < 0 && actionZone) {
        actionZone.style.width = '160px';
        actionBtns.forEach(b => b.classList.add('visible'));
      }
      setTimeout(() => { card.style.transition = ''; }, 300);
    };

    const doDelete = () => {
      const id = Number(card.dataset.id);
      card.classList.add('deleting');
      card.style.transform = 'translateX(100%)';
      card.style.opacity = '0';
      setTimeout(async () => {
        await this.deleteHistoryItem(id);
        this.renderHistoryList();
      }, 300);
    };

    const doAction = async (action) => {
      const id = Number(card.dataset.id);
      returnToOrigin(true);
      const items = await this.getHistoryItems();
      const item = items.find(x => x.id === id);
      if (!item) return;
      if (action === 'copy') {
        navigator.clipboard.writeText(item.latex);
        this.showToast('已复制');
      } else if (action === 'insert') {
        this.editor.setLatex(item.latex);
        this.editor.updatePreview(item.latex);
        const source = document.getElementById('latexSource');
        if (source) source.value = item.latex;
        this.switchSection('editor');
        this.showToast('已加载公式');
      }
    };

    const onStart = (x, y) => {
      startX = x; startY = y; startTime = Date.now();
      tracking = true; currentDx = 0;
      card.classList.add('swiping');
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
      card.classList.remove('swiping');

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

    card.addEventListener('mousedown', (e) => {
      if (e.target.closest('.hi-fav')) return;
      onStart(e.clientX, e.clientY);
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (tracking) onMove(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', () => {
      if (tracking) onEnd();
    });

    card.addEventListener('touchstart', (e) => {
      if (e.target.closest('.hi-fav')) return;
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    card.addEventListener('touchmove', (e) => {
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    card.addEventListener('touchend', () => onEnd());

    actionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        doAction(btn.dataset.action);
      });
    });

    if (deleteZone) {
      deleteZone.addEventListener('click', (e) => {
        e.stopPropagation();
        doDelete();
      });
    }
  }

  _escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  switchSection(section) {
    Logger.debug(`switchSection: ${section}`);

    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(`${section}Section`)?.classList.add('active');

    document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`${section}Btn`)?.classList.add('active');

    this.currentSection = section;

    const sidebarTrigger = document.getElementById('sidebarTrigger');
    const sidebarPanel = document.getElementById('sidebarPanel');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (section === 'editor') {
      sidebarTrigger?.classList.remove('hidden');
      // Restore sidebar open state if it was open before leaving
      if (this._sidebarWasOpen) {
        sidebarPanel?.classList.add('open');
        sidebarOverlay?.classList.add('visible');
        this._sidebarWasOpen = false;
      }
    } else {
      // Save sidebar state before hiding
      this._sidebarWasOpen = sidebarPanel?.classList.contains('open') || false;
      sidebarTrigger?.classList.add('hidden');
      sidebarPanel?.classList.remove('open');
      sidebarOverlay?.classList.remove('visible');
    }

    if (section === 'history') {
      this.renderHistoryList();
    }

    if (section === 'settings') {
      this.renderPlatformList();
    }

    if (section === 'ocr') {
      this.checkBridgeStatus();
    }
  }

  updateTabVisibility() {
    Logger.debug('Updating tab visibility...');
    const settings = this.settingsManager.settings;

    const ocrTab = document.getElementById('ocrBtn');
    if (ocrTab) {
      ocrTab.style.display = settings.ocrEnabled ? '' : 'none';
    }
    
    Logger.debug('Tab visibility updated');
  }

  async checkBridgeStatus() {
    const statusEl = document.getElementById('ocrBridgeStatus');
    if (!statusEl) return;

    const connected = await this.connectBridge();
    if (connected) {
      statusEl.textContent = '已连接到桌面端 LaTeXSnipper';
      statusEl.style.color = 'var(--accent)';
    } else {
      statusEl.textContent = '未检测到桌面端，请先启动 LaTeXSnipper';
      statusEl.style.color = '#ef4444';
    }
  }

  async copyFormula(format) {
    Logger.info(`copyFormula: ${format}`);
    const latex = this.editor.getLatex();
    if (!latex) {
      this.showStatus('请先输入公式');
      return;
    }

    let textToCopy = latex;

    try {
      if (format === 'mathml') {
        textToCopy = `<math xmlns="http://www.w3.org/1998/Math/MathML">${this._latexToMathml(latex)}</math>`;
      } else if (format === 'svg') {
        const svg = await this.editor.renderer.render(latex, false);
        textToCopy = svg || latex;
      } else if (format === 'md') {
        const isDisplay = document.getElementById('displayMode')?.checked || false;
        textToCopy = isDisplay ? `$$\n${latex}\n$$` : `$${latex}$`;
      }

      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);

      const labelMap = { latex: 'LaTeX', mathml: 'MathML', svg: 'SVG', md: 'Markdown' };
      if (ok) {
        this.showToast(`已复制 ${labelMap[format] || format.toUpperCase()}`);
        this.addHistoryItem(latex);
        Logger.info(`Copy successful: ${format}`);
      } else {
        this.showToast('复制失败');
      }
    } catch (e) {
      Logger.error('Copy failed:', e);
      this.showToast('复制失败');
    }
  }

  async insertToWord() {
    const latex = this.editor.getLatex();
    console.log('[Insert] latex:', latex);
    if (!latex) {
      this.showStatus('请先输入公式');
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const isDisplay = document.getElementById('displayMode')?.checked || false;

      // Get selected session from dropdown
      const sessionId = this._selectedSessionId;
      if (!sessionId) {
        this.showToast('请先选择目标 Office 宿主');
        return;
      }

      const session = this._sessions.find(s => s.session_id === sessionId);
      if (!session) {
        this.showToast('所选会话不存在');
        return;
      }

      console.log('[Insert] Converting LaTeX to OMML...');
      const omml = await invoke('latex_to_omml', { latex });
      console.log('[Insert] OMML length:', omml?.length || 0);

      // Render SVG for Excel/PPT (Word uses OMML directly)
      let svg = null;
      let widthPt = 0;
      let heightPt = 0;
      if (session.host_type !== 'word') {
        try {
          if (!window.MathJax) {
            await new Promise((resolve, reject) => {
              const script = document.createElement('script');
              script.src = './public/mathjax/tex-svg.js';
              script.onload = resolve;
              script.onerror = reject;
              document.head.appendChild(script);
            });
          }

          if (window.MathJax) {
            await window.MathJax.startup.promise;
            const node = await window.MathJax.tex2svgPromise(latex, { display: isDisplay });
            const svgElement = node.querySelector('svg');
            if (svgElement) {
              svg = svgElement.outerHTML;
              const viewBox = svgElement.getAttribute('viewBox');
              if (viewBox) {
                const parts = viewBox.split(' ');
                widthPt = parseFloat(parts[2]) || 120;
                heightPt = parseFloat(parts[3]) || 30;
              }
            }
          }
        } catch (e) {
          Logger.error('SVG render error:', e);
          this.showToast('SVG 渲染失败，Excel/PPT 插入可能不完整');
        }
      }

      console.log('[Insert] Sending to session:', sessionId);
      await invoke('native_office_insert_formula', {
        sessionId: sessionId,
        formulaId: crypto.randomUUID(),
        latex: latex,
        omml: omml,
        display: isDisplay ? 'block' : 'inline',
        mode: isDisplay ? 'display' : 'inline',
        svg: svg,
        widthPt: widthPt,
        heightPt: heightPt
      });
      console.log('[Insert] Success');
      this.showToast(`已插入到 ${session.host_type}`);
      this.addHistoryItem(latex);
    } catch (error) {
      this.showToast(`插入失败: ${error.message || error}`);
    }
  }

  async loadFromWord() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');

      // Get selected session from dropdown
      const sessionId = this._selectedSessionId;
      if (!sessionId) {
        this.showToast('请先选择目标 Office 宿主');
        return;
      }

      const session = this._sessions.find(s => s.session_id === sessionId);
      if (!session) {
        this.showToast('所选会话不存在');
        return;
      }

      this.showToast(`正在从 ${session.host_type} 读取选区...`);
      await invoke('native_office_request_read_selection', { sessionId });
    } catch (e) {
      Logger.error('loadFromWord failed:', e);
      this.showToast('加载失败: ' + (e.message || e));
    }
  }

  async insertTableToWord() {
    const sessionId = this._selectedSessionId;
    if (!sessionId) {
      this.showToast('请先选择目标 Office 宿主');
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const latex = this.editor?.getLatex();
      const content = latex ? `${latex}` : "x";

      // Build a minimal 2x2 test table with formula in cell
      const table = {
        tableId: crypto.randomUUID(),
        table: {
          rows: [
            { cells: [{ inlines: [{ type: "text", text: "Cell 1" }] }, { inlines: [{ type: "text", text: "Cell 2" }] }] },
            { cells: [{ inlines: [{ type: "text", text: "Cell 3" }] }, { inlines: [{ type: "text", text: content }] }] }
          ]
        }
      };

      await invoke('native_office_insert_table', {
        sessionId,
        tableJson: JSON.stringify(table)
      });
      this.showToast('表格已发送');
    } catch (e) {
      this.showToast('插入表格失败: ' + (e.message || e));
    }
  }

  async readTableFromWord() {
    const sessionId = this._selectedSessionId;
    if (!sessionId) {
      this.showToast('请先选择目标 Office 宿主');
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('native_office_request_read_table', { sessionId });
      this.showToast('表格读取请求已发送');
    } catch (e) {
      this.showToast('读取表格失败: ' + (e.message || e));
    }
  }

  updateOfficeInsertButton() {
    const officePlatform = this.platforms.find(p => p.id === 'office');
    const enabled = officePlatform?.enabled;
    const btn = document.getElementById('insertToWord');
    if (btn) btn.style.display = enabled ? '' : 'none';
    const loadBtn = document.getElementById('loadFromWord');
    if (loadBtn) loadBtn.style.display = enabled ? '' : 'none';
    const tableInsert = document.getElementById('insertTableBtn');
    if (tableInsert) tableInsert.style.display = enabled ? '' : 'none';
    const tableRead = document.getElementById('readTableBtn');
    if (tableRead) tableRead.style.display = enabled ? '' : 'none';
  }

  updateMdCopyButton() {
    const hasMdPlatform = this.platforms.some(p => p.enabled && p.copyAsMd);
    const btn = document.getElementById('copyMd');
    if (btn) {
      btn.style.display = hasMdPlatform ? '' : 'none';
    }
  }

  updateFontStyle(style) {
    Logger.info(`fontStyle: ${style}`);

    const previewHost = document.getElementById('previewHost');
    if (previewHost) {
      previewHost.style.fontStyle = style === 'italic' ? 'italic' : 'normal';
      previewHost.style.fontWeight = style === 'bold' ? 'bold' : 'normal';
      previewHost.style.fontFamily = style === 'roman' ? 'serif' : '';
    }
    
    this.showStatus(`字体样式: ${style}`);
  }

  updateFontColor(color) {
    Logger.info(`fontColor: ${color}`);

    const previewHost = document.getElementById('previewHost');
    if (previewHost) {
      previewHost.style.color = color;
    }
    
    this.showStatus(`颜色已更新`);
  }

  showStatus(message) {
    Logger.debug(`showStatus: ${message}`);
    const statusText = document.getElementById('statusText');
    if (statusText) {
      statusText.textContent = message;
      setTimeout(() => { statusText.textContent = '就绪'; }, 2000);
    }
  }

  showToast(message, duration = 1500) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  // ═══════════════════════════════════════════
  // Platform Management
  // ═══════════════════════════════════════════
  platforms = [
    {
      id: 'office',
      name: 'Microsoft Office',
      desc: 'Word / PowerPoint',
      icon: '/icons/platforms/office.svg',
      color: '#d83b01',
      enabled: false,
      format: 'omml',
      shortcut: null,
    },
    {
      id: 'obsidian',
      name: 'Obsidian',
      desc: 'Markdown 笔记编辑器',
      icon: '/icons/platforms/obsidian.svg',
      color: '#7c3aed',
      enabled: false,
      format: 'markdown_inline',
      copyAsMd: true,
      shortcut: null,
    },
    {
      id: 'vscode',
      name: 'VS Code',
      desc: '代码编辑器',
      icon: '/icons/platforms/vscode.svg',
      color: '#007acc',
      enabled: false,
      format: 'latex',
      shortcut: null,
    },
    {
      id: 'wps',
      name: 'WPS Office',
      desc: '办公套件（自动检测）',
      icon: '/icons/platforms/wps.svg',
      color: '#00a651',
      enabled: false,
      format: 'omml',
      copyAsMd: true,
      shortcut: null,
    },
    {
      id: 'typora',
      name: 'Typora',
      desc: 'Markdown 编辑器',
      icon: '/icons/platforms/typora.svg',
      color: '#4a90d9',
      enabled: false,
      format: 'latex',
      shortcut: null,
    },
    {
      id: 'notion',
      name: 'Notion',
      desc: '知识管理工具',
      icon: '/icons/platforms/notion.svg',
      color: '#000000',
      enabled: false,
      format: 'latex',
      copyAsMd: true,
      shortcut: null,
    },
    {
      id: 'libreoffice',
      name: 'LibreOffice',
      desc: '开源办公套件',
      icon: '/icons/platforms/libreoffice.svg',
      color: '#18a303',
      enabled: false,
      format: 'mathml',
      copyAsMd: true,
      shortcut: null,
    },
  ];

  loadPlatforms() {
    try {
      const saved = JSON.parse(localStorage.getItem('platforms') || '[]');
      this.platforms.forEach(p => {
        const s = saved.find(x => x.id === p.id);
        if (s) {
          p.enabled = s.enabled;
          p.shortcut = s.shortcut;
        }
      });
    } catch {}
  }

  savePlatforms() {
    const data = this.platforms.map(p => ({
      id: p.id,
      enabled: p.enabled,
      shortcut: p.shortcut,
    }));
    localStorage.setItem('platforms', JSON.stringify(data));
  }

  _officeStatusCache = null;

  async getOfficeStatus() {
    if (this._officeStatusCache) return this._officeStatusCache;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      this._officeStatusCache = await invoke('detect_office');
      return this._officeStatusCache;
    } catch (e) {
      Logger.warn('Office detection failed:', e);
      return { installed: false, word: { available: false }, powerpoint: { available: false } };
    }
  }

  clearOfficeStatusCache() {
    this._officeStatusCache = null;
  }

  async getPlatformIntegrationStatus(platformId) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke('check_platform_integration', { platformId });
    } catch (e) {
      Logger.warn(`Platform status failed for ${platformId}:`, e);
      return { success: false, message: e?.message || String(e) };
    }
  }

  async renderPlatformList(options = {}) {
    const { refreshStatus = false } = options;
    const listEl = document.getElementById('platformList');
    if (!listEl) return;

    const officeStatus = refreshStatus ? await this.getOfficeStatus() : this._officeStatusCache;
    const officePlatform = this.platforms.find(p => p.id === 'office');
    if (officePlatform && officeStatus) {
      if (officeStatus.installed) {
        const parts = [];
        if (officeStatus.word && officeStatus.word.available) parts.push('Word');
        if (officeStatus.excel && officeStatus.excel.available) parts.push('Excel');
        if (officeStatus.powerpoint && officeStatus.powerpoint.available) parts.push('PowerPoint');
        officePlatform.desc = parts.join(' / ');
        if (officeStatus.word && officeStatus.word.plugin_installed) officePlatform.desc += ' · 已安装';
      } else {
        officePlatform.desc = '未检测到 Office';
      }
    }

    if (refreshStatus) {
      const wpsPlatform = this.platforms.find(p => p.id === 'wps');
      if (wpsPlatform) {
        const wpsStatus = await this.getPlatformIntegrationStatus('wps');
        if (wpsStatus.success) {
          wpsPlatform.desc = 'JSAddIn · 已安装';
        } else if (wpsStatus.message) {
          wpsPlatform.desc = wpsStatus.message;
        }
      }
    }

    listEl.innerHTML = this.platforms.map(p => {
      const busy = this.platformOperations.has(p.id);
      return `
      <div class="platform-item ${busy ? 'is-busy' : ''}">
        <div class="platform-icon" style="background:${p.color}15;">
          <img src="${p.icon}" alt="${p.name}" style="width:18px;height:18px;">
        </div>
        <div class="platform-info">
          <div class="platform-name">${p.name}</div>
          <div class="platform-desc">${busy ? '处理中...' : p.desc}${p.enabled ? ' · 已启用' : ''}</div>
        </div>
        <label class="custom-toggle ${busy ? 'is-busy' : ''}">
          <input type="checkbox" class="platform-toggle" data-platform="${p.id}" ${p.enabled ? 'checked' : ''} ${busy ? 'disabled' : ''}>
          <span class="toggle-track"></span>
        </label>
      </div>
    `;
    }).join('');

    listEl.querySelectorAll('.platform-toggle').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const platformId = e.target.dataset.platform;
        const platform = this.platforms.find(p => p.id === platformId);
        if (platform) {
          if (this.platformOperations.has(platformId)) {
            e.target.checked = platform.enabled;
            return;
          }

          const requestedEnabled = e.target.checked;
          const previousEnabled = platform.enabled;
          platform.enabled = requestedEnabled;
          this.platformOperations.add(platformId);
          await this.renderPlatformList();

          let ok = false;
          if (requestedEnabled) {
            ok = await this.registerPlatform(platform);
          } else {
            ok = await this.unregisterPlatform(platform);
          }

          if (!ok) {
            platform.enabled = previousEnabled;
          }

          this.savePlatforms();
          this.platformOperations.delete(platformId);
          await this.renderPlatformList({ refreshStatus: platformId === 'office' || platformId === 'wps' });
          this.updateOfficeInsertButton();
    this.updateMdCopyButton();
        }
      });
    });
  }

  platformSupport = {
    office: { ready: true, message: '' },
    obsidian: { ready: true, message: 'Obsidian 插件开发中，敬请期待' },
    vscode: { ready: false, message: 'VS Code 扩展开发中，敬请期待' },
    wps: { ready: true, message: '' },
    typora: { ready: true, message: 'Typora 集成开发中，敬请期待' },
    notion: { ready: true, message: 'Notion 集成开发中，敬请期待' },
    libreoffice: { ready: false, message: 'LibreOffice 扩展开发中，敬请期待' },
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

    if (platform.id === 'office' || platform.id === 'wps') {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        if (platform.id === 'office') {
          const status = await this.getOfficeStatus();
          if (!status.installed) {
          this.showToast('未检测到 Microsoft Office，请先安装 Office');
          platform.enabled = false;
            return false;
          }

          // Use Native Office install command
          const { invoke } = await import('@tauri-apps/api/core');
          const result = await invoke('native_office_install');
          this.clearOfficeStatusCache();
          if (result.operation_id) {
            this.showToast('安装已启动，请按照安装程序提示操作');
            return true;
          } else {
            this.showToast('安装启动失败: ' + (result.message || result.error));
            return false;
          }
        }

        const result = await invoke('install_platform_integration', { platformId: platform.id });
        this.clearOfficeStatusCache();
        if (result.success) {
          this.showToast(`${platform.name} 插件已安装，请重启对应应用加载插件`);
          return true;
        } else {
          this.showToast('安装失败: ' + result.message);
          platform.enabled = false;
          return false;
        }
      } catch (e) {
        Logger.error('Platform registration failed:', e);
        this.showToast('安装失败: ' + e.message);
        platform.enabled = false;
        return false;
      }
    }

    this.showToast(`${platform.name} 已注册`);
    return true;
  }

  async unregisterPlatform(platform) {
    Logger.info(`Unregistering platform: ${platform.name}`);

    if (platform.id === 'office') {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke('native_office_uninstall');
        this.clearOfficeStatusCache();
        if (result.operation_id) {
          this.showToast('卸载已启动，请按照安装程序提示操作');
          return true;
        } else {
          this.showToast('卸载启动失败: ' + (result.message || result.error));
          return false;
        }
      } catch (e) {
        Logger.error('Platform unregister failed:', e);
        this.showToast('卸载失败: ' + e.message);
        return false;
      }
    } else if (platform.id === 'wps') {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke('uninstall_platform_integration', { platformId: platform.id });
        this.clearOfficeStatusCache();
        if (result.success) {
          this.showToast(`${platform.name} 插件已卸载，请重启对应应用`);
          return true;
        } else {
          this.showToast('卸载失败: ' + result.message);
          return false;
        }
      } catch (e) {
        Logger.error('Platform unregister failed:', e);
        this.showToast('卸载失败: ' + e.message);
        return false;
      }
    }

    this.showToast(`${platform.name} 已取消注册`);
    return true;
  }

  ocrLatex = '';
  bridgeConfig = null;

  async connectBridge() {
    Logger.info('Connecting to LaTeXSnipper Bridge...');
    try {
      const response = await fetch('/bridge/config', {
        signal: AbortSignal.timeout(3000),
      });
      const data = await response.json();
      const result = data.result || data;
      this.bridgeConfig = {
        url: result.bridge_url || 'http://127.0.0.1:28765',
        token: result.token,
      };
      Logger.info(`Bridge connected, token: ${this.bridgeConfig.token?.substring(0, 10)}...`);
      return true;
    } catch (e) {
      Logger.warn('Bridge connection failed:', e.message);
      Logger.warn('Make sure LaTeXSnipper desktop app is running');
      return false;
    }
  }

  async startScreenshot() {
    Logger.info('startScreenshot');
    this.showStatus('正在连接桌面端...');

    const connected = await this.connectBridge();
    if (!connected) {
      this.showStatus('无法连接 LaTeXSnipper，请确保桌面端正在运行');
      return;
    }

    try {
      await fetch('/bridge/recognize/screenshot/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.bridgeConfig.token}`,
        },
        body: '{}',
      });
      Logger.debug('Cancelled previous screenshot request');
    } catch (e) {
      Logger.debug('No previous request to cancel');
    }

    this.showStatus('已发起截图请求，请切换到桌面端操作截图');

    try {
      const response = await fetch('/bridge/recognize/screenshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.bridgeConfig.token}`,
        },
        body: JSON.stringify({ timeout: 120 }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.ok && data.result) {
        this.ocrLatex = data.result.latex || '';
        const ocrResult = document.getElementById('ocrResult');
        const ocrInsertBtn = document.getElementById('ocrInsertBtn');
        const ocrCopyBtn = document.getElementById('ocrCopyBtn');

        if (ocrResult) ocrResult.textContent = this.ocrLatex || '未识别到公式';
        if (ocrInsertBtn) ocrInsertBtn.disabled = !this.ocrLatex;
        if (ocrCopyBtn) ocrCopyBtn.disabled = !this.ocrLatex;

        this.showStatus(this.ocrLatex ? '识别完成' : '未识别到公式');
        Logger.info(`OCR result: ${this.ocrLatex}`);
      } else {
        const errMsg = data.error?.message || '识别失败';
        this.showStatus(errMsg);
        Logger.error('OCR failed:', errMsg);
      }
    } catch (e) {
      Logger.error('Screenshot OCR failed:', e);
      this.showStatus('截图识别失败，请确保桌面端正在运行');
    }
  }

  insertOcrResult() {
    Logger.info(`insertOcrResult: ${this.ocrLatex}`);
    if (this.ocrLatex) {
      this.insertFormula(this.ocrLatex);
      this.switchSection('editor');
    }
  }

  copyOcrResult() {
    Logger.info('copyOcrResult');
    if (this.ocrLatex) {
      this.editor.copyToClipboard(this.ocrLatex);
      this.showStatus('已复制 LaTeX');
    }
  }

  applySettings() {
    const settings = this.settingsManager.settings;
    Logger.debug('Applying settings:', settings);

    const bridgeInput = document.getElementById('bridgeUrlInput');
    if (bridgeInput && settings.bridgeUrl) {
      bridgeInput.value = settings.bridgeUrl;
    }

    const displayMode = document.getElementById('displayMode');
    if (displayMode) {
      displayMode.checked = settings.displayMode === 'display';
    }

    const officeToggle = document.getElementById('officeEnabledToggle');
    if (officeToggle) {
      officeToggle.checked = settings.officeEnabled;
    }
    const ocrToggle = document.getElementById('ocrEnabledToggle');
    if (ocrToggle) {
      ocrToggle.checked = settings.ocrEnabled;
    }

    this.updateTabVisibility();
  }
}

// ═══════════════════════════════════════════
// Initialize App
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  Logger.info('DOM loaded');
  new UIController();
  Logger.info('App ready');
  Logger.info('Global shortcut: Ctrl/Cmd+Shift+L (registered in Rust backend)');
});
