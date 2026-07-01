// LaTeXSnipper Office - Main JavaScript

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// 鏃ュ織绯荤粺
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?const Logger = {
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// MathLive 涓枃缈昏瘧
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?const MATHLIVE_I18N = {
  'keyboard.tooltip.symbols': '绗﹀彿',
  'keyboard.tooltip.greek': '甯岃厞瀛楁瘝',
  'keyboard.tooltip.numeric': '鏁板瓧',
  'keyboard.tooltip.alphabetic': '缃楅┈瀛楁瘝',
  'tooltip.copy to clipboard': '澶嶅埗鍒板壀璐存澘',
  'tooltip.cut to clipboard': '鍓垏鍒板壀璐存澘',
  'tooltip.paste from clipboard': '浠庡壀璐存澘绮樿创',
  'tooltip.redo': '閲嶅仛',
  'tooltip.toggle virtual keyboard': '鍒囨崲铏氭嫙閿洏',
  'tooltip.menu': '鑿滃崟',
  'tooltip.undo': '鎾ら攢',
  'menu.borders': '鐭╅樀杈规',
  'menu.insert matrix': '鎻掑叆鐭╅樀',
  'menu.array.add row above': '涓婃柟娣诲姞琛?,
  'menu.array.add row below': '涓嬫柟娣诲姞琛?,
  'menu.array.add column after': '鍙充晶娣诲姞鍒?,
  'menu.array.add column before': '宸︿晶娣诲姞鍒?,
  'menu.array.delete row': '鍒犻櫎琛?,
  'menu.array.delete rows': '鍒犻櫎閫変腑琛?,
  'menu.array.delete column': '鍒犻櫎鍒?,
  'menu.array.delete columns': '鍒犻櫎閫変腑鍒?,
  'menu.mode': '妯″紡',
  'menu.mode-math': '鏁板',
  'menu.mode-text': '鏂囨湰',
  'menu.mode-latex': 'LaTeX',
  'menu.insert': '鎻掑叆',
  'menu.insert.abs': '缁濆鍊?,
  'menu.insert.nth-root': 'n 娆℃牴鍙?,
  'menu.insert.log-base': '瀵规暟 (log)',
  'menu.insert.heading-calculus': '寰Н鍒?,
  'menu.insert.derivative': '瀵兼暟',
  'menu.insert.nth-derivative': 'n 闃跺鏁?,
  'menu.insert.integral': '绉垎',
  'menu.insert.sum': '姹傚拰',
  'menu.insert.product': '涔樼Н',
  'menu.insert.heading-complex-numbers': '澶嶆暟',
  'menu.insert.modulus': '妯?,
  'menu.insert.argument': '杈愯',
  'menu.insert.real-part': '瀹為儴',
  'menu.insert.imaginary-part': '铏氶儴',
  'menu.insert.conjugate': '鍏辫江',
  'tooltip.blackboard': '榛戞澘绮椾綋',
  'tooltip.bold': '绮椾綋',
  'tooltip.italic': '鏂滀綋',
  'tooltip.fraktur': '鍝ョ壒浣?,
  'tooltip.script': '鎵嬪啓浣?,
  'tooltip.caligraphic': '涔︽硶浣?,
  'tooltip.typewriter': '绛夊',
  'tooltip.roman-upright': '缃楅┈姝ｄ綋',
  'tooltip.row-by-col': '%@ 脳 %@',
  'menu.font-style': '瀛椾綋椋庢牸',
  'menu.accent': '閲嶉煶/淇グ',
  'menu.decoration': '瑁呴グ',
  'menu.color': '棰滆壊',
  'menu.background-color': '鑳屾櫙',
  'menu.evaluate': '璁＄畻',
  'menu.simplify': '鍖栫畝',
  'menu.solve': '姹傝В',
  'menu.solve-for': '姹傝В %@',
  'menu.cut': '鍓垏',
  'menu.copy': '澶嶅埗',
  'menu.copy-as-latex': '澶嶅埗涓?LaTeX',
  'menu.copy-as-typst': '澶嶅埗涓?Typst',
  'menu.copy-as-ascii-math': '澶嶅埗涓?ASCII Math',
  'menu.copy-as-mathml': '澶嶅埗涓?MathML',
  'menu.paste': '绮樿创',
  'menu.select-all': '鍏ㄩ€?,
  'color.red': '绾㈣壊',
  'color.orange': '姗欒壊',
  'color.yellow': '榛勮壊',
  'color.lime': '闈掓煚鑹?,
  'color.green': '缁胯壊',
  'color.teal': '钃濈豢鑹?,
  'color.cyan': '闈掕壊',
  'color.blue': '钃濊壊',
  'color.indigo': '闈涜摑鑹?,
  'color.purple': '绱壊',
  'color.magenta': '鍝佺孩鑹?,
  'color.black': '榛戣壊',
  'color.dark-grey': '娣辩伆鑹?,
  'color.grey': '鐏拌壊',
  'color.light-grey': '娴呯伆鑹?,
  'color.white': '鐧借壊',
};

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// Temml 娓叉煋鍣?(鏇夸唬 MathJax)
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?class TemmlRenderer {
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

  // LaTeX 鈫?MathML (鐢ㄤ簬 Office 鎻掑叆)
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// 鑷畾涔変笅鎷夎彍鍗?// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?class CustomSelect {
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// 鍏紡缂栬緫鍣?(MathLive)
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?class FormulaEditor {
  constructor() {
    Logger.info('FormulaEditor initializing...');
    this.mathfield = null;
    this.renderer = new TemmlRenderer();
    this.init();
  }

  async init() {
    Logger.debug('FormulaEditor init');
    
    try {
      // 鍔ㄦ€佸鍏?MathLive
      const { MathfieldElement } = await import('mathlive');
      
      // 鍒涘缓 MathLive 鍏冪礌
      const container = document.getElementById('mathfieldHost');
      if (container) {
        this.mathfield = new MathfieldElement();
        this.mathfield.setAttribute('virtual-keyboard-mode', 'manual');
        container.appendChild(this.mathfield);
        
        // 鐩戝惉杈撳叆鍙樺寲
        this.mathfield.addEventListener('input', () => {
          const latex = this.mathfield.getValue('latex');
          Logger.debug(`MathLive input: ${latex.substring(0, 30)}...`);
          
          // 鍚屾鍒?LaTeX 婧愮爜
          const source = document.getElementById('latexSource');
          if (source) {
            source.value = latex;
          }
          
          // 鏇存柊棰勮
          this.updatePreview(latex);
        });

        // 鐩戝惉閿洏浜嬩欢
        this.mathfield.addEventListener('keystroke', (e) => {
          Logger.debug(`MathLive keystroke: ${e.key}`);
        });
        
        Logger.info('MathLive editor initialized');
      }
      
      // 棰勫姞杞?Temml
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
      previewHost.innerHTML = '<span style="color: var(--muted);">杈撳叆鍏紡鍚庨瑙?/span>';
      return;
    }

    const display = document.getElementById('displayMode')?.checked || false;
    Logger.debug(`updatePreview: display=${display}`);
    
    // 绛夊緟 Temml 鍔犺浇瀹屾垚
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// 鍏紡搴?// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?class FormulaLibrary {
  constructor() {
    Logger.info('FormulaLibrary initializing...');
    this.categories = [];
    this.formulas = {};
    this.loaded = false;
  }

  async load() {
    Logger.debug('Loading formula data...');
    
    try {
      // 鍔犺浇鍒嗙被绱㈠紩
      const indexResponse = await fetch('/formulas/_index.json');
      const indexData = await indexResponse.json();
      
      // 鍔犺浇姣忎釜鍒嗙被鐨勫叕寮?      for (const categoryId of indexData.order) {
        try {
          const response = await fetch(`/formulas/${categoryId}.json`);
          const data = await response.json();
          
          this.categories.push({
            id: categoryId,
            name: this._getCategoryName(categoryId),
          });
          
          // 澶勭悊鏁扮粍鏍煎紡 [label, latex]锛岃烦杩?section 瀵硅薄
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
      // 浣跨敤鍐呯疆鏁版嵁浣滀负澶囩敤
      this._loadFallbackData();
    }
  }

  _getCategoryName(id) {
    const names = {
      'greek': '甯岃厞瀛楁瘝',
      'structures': '缁撴瀯',
      'delimiters': '瀹氱晫绗?,
      'analysis': '鍒嗘瀽',
      'algebra': '浠ｆ暟',
      'geometry': '鍑犱綍',
      'topology': '鎷撴墤',
      'numberTheory': '鏁拌',
      'relations': '鍏崇郴',
      'operators': '杩愮畻绗?,
      'bigops': '澶ц繍绠楃',
      'arrows': '绠ご',
      'sets': '闆嗗悎',
      'functions': '鍑芥暟',
      'probability': '姒傜巼',
      'physics': '鐗╃悊',
      'chemistry': '鍖栧',
      'misc': '鍏朵粬',
    };
    return names[id] || id;
  }

  _loadFallbackData() {
    Logger.info('Loading fallback formula data...');
    this.categories = [
      { id: 'greek', name: '甯岃厞瀛楁瘝' },
      { id: 'structures', name: '缁撴瀯' },
      { id: 'operators', name: '杩愮畻绗? },
      { id: 'relations', name: '鍏崇郴' },
      { id: 'misc', name: '鍏朵粬' },
    ];
    this.formulas = {
      greek: [
        { latex: '\\alpha', label: '伪' },
        { latex: '\\beta', label: '尾' },
        { latex: '\\gamma', label: '纬' },
        { latex: '\\delta', label: '未' },
        { latex: '\\pi', label: '蟺' },
        { latex: '\\sigma', label: '蟽' },
        { latex: '\\omega', label: '蠅' },
      ],
      structures: [
        { latex: '\\frac{a}{b}', label: '鍒嗘暟' },
        { latex: '\\sqrt{x}', label: '鏍瑰彿' },
        { latex: 'x^{n}', label: '涓婃爣' },
        { latex: 'x_{n}', label: '涓嬫爣' },
        { latex: '\\int_{a}^{b}', label: '绉垎' },
        { latex: '\\sum_{i=1}^{n}', label: '姹傚拰' },
      ],
      operators: [
        { latex: '+', label: '鍔? },
        { latex: '-', label: '鍑? },
        { latex: '\\times', label: '涔? },
        { latex: '\\div', label: '闄? },
        { latex: '\\pm', label: '卤' },
        { latex: '\\infty', label: '鏃犵┓' },
      ],
      relations: [
        { latex: '=', label: '绛変簬' },
        { latex: '\\neq', label: '涓嶇瓑浜? },
        { latex: '<', label: '灏忎簬' },
        { latex: '>', label: '澶т簬' },
        { latex: '\\leq', label: '鈮? },
        { latex: '\\geq', label: '鈮? },
        { latex: '\\in', label: '鈭? },
        { latex: '\\subset', label: '鈯? },
      ],
      misc: [
        { latex: '\\forall', label: '鈭€' },
        { latex: '\\exists', label: '鈭? },
        { latex: '\\ldots', label: '鈥? },
        { latex: '\\angle', label: '鈭? },
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

    // 鐩存帴鍖归厤鏍囩鎴?LaTeX
    if (label.includes(q) || latex.includes(q)) return true;

    // 鎷奸煶棣栧瓧姣嶅尮閰?    const py = this._pinyinInitials(query);
    if (py.length >= 2 && (label.includes(py) || latex.includes(py))) return true;

    // 鎼滅储鍒悕鍖归厤
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
      '鍒?:'f','鏁?:'s','鏋?:'j','闄?:'x','绉?:'j','姹?:'q','鍜?:'h',
      '鐭?:'j','闃?:'z','鍚?:'x','閲?:'l','鐗?:'t','寰?:'z','鍊?:'z','琛?:'h',
      '鍒?:'l','寮?:'s','绉?:'z','閫?:'n','杞?:'z','缃?:'z','姊?:'t','搴?:'d',
      '鏁?:'s','鏃?:'x','鎷?:'l','鏅?:'p','鏂?:'s','鏃?:'w','绌?:'q','绌?:'k',
      '闆?:'j','灞?:'s','浜?:'y','骞?:'b','浜?:'j','瀛?:'z','瓒?:'c','闈?:'f',
      '瀵?:'d','鏁?:'s','鎸?:'z','姝?:'z','浣?:'y','鍒?:'q','鍙?:'s','鏇?:'q',
      '鍙?:'f','鑷?:'z','鐒?:'r','鏈€':'z','澶?:'d','涓?:'s','纭?:'q','鐣?:'j',
      '鍒?:'f','娈?:'d','琛?:'h','鍒?:'l','杩?:'j','鍏?:'g','杞?:'e','鍋?:'p',
      '瀵?:'d','娆?:'o','绫?:'m','浼?:'j','椹?:'m','闃?:'a','灏?:'e','璐?:'b',
      '濉?:'t','寰?:'d','瑗?:'x','鏂?:'f','闄?:'t','鍗?:'k','鍏?:'k','鑹?:'a',
      '娉?:'z','鏅?:'p','鏌?:'r','娲?:'p','鏍?:'g','鎺?:'t','鍑?:'c','绛?:'d',
      '浠?:'j','璐?:'f','绾?:'y','鎭?:'h','灞?:'s','鍖?:'b','鍚?:'h','宸?:'z',
      '鍙?:'y','绠?:'j','澶?:'t','閫?:'l','杈?:'j','涓?:'y','鎴?:'h','涓?:'b',
      '绮?:'c','榛?:'h','鏉?:'b','涔?:'s','娉?:'f','鍝?:'g','鐗?:'t','缁?:'z',
      '鍚?:'h','鏂?:'w','鏈?:'b','杩?:'y','绠?:'s','绗?:'f','鐐?:'d','涔?:'c',
      '鍙?:'c','闄?:'c','寰?:'w','涓?:'s','瑙?:'j','鍑?:'h','鍑?:'j','浣?:'h',
      '浠?:'d','姒?:'g','鐜?:'l','鐗?:'w','鐞?:'l','鍖?:'h','瀛?:'x',
    };
    let r = '';
    for (const ch of str) {
      if (map[ch]) r += map[ch];
    }
    return r;
  }

  _getSearchAliases() {
    return {
      frac: ['鍒嗘暟', 'fraction'],
      sqrt: ['鏍瑰彿', '骞虫柟鏍?, 'square root'],
      lim: ['鏋侀檺', 'limit'],
      int: ['绉垎', 'integral'],
      sum: ['姹傚拰', 'summation'],
      prod: ['姹傜Н', 'product'],
      vec: ['鍚戦噺', 'vector'],
      dot: ['鐐逛箻', 'dot'],
      sin: ['姝ｅ鸡', 'sine'],
      cos: ['浣欏鸡', 'cosine'],
      tan: ['姝ｅ垏', 'tangent'],
      log: ['瀵规暟', 'logarithm'],
      ln: ['鑷劧瀵规暟'],
      exp: ['鎸囨暟', 'exponential'],
      max: ['鏈€澶у€?, 'maximum'],
      min: ['鏈€灏忓€?, 'minimum'],
      alpha: ['闃垮皵娉?],
      beta: ['璐濆'],
      gamma: ['浼介┈'],
      delta: ['寰峰皵濉?],
      epsilon: ['鑹炬櫘瑗块殕'],
      theta: ['瑗垮'],
      lambda: ['鎷夊杈?],
      mu: ['缂?],
      pi: ['娲?],
      sigma: ['瑗挎牸鐜?],
      phi: ['鏂?],
      omega: ['娆х背浼?],
      matrix: ['鐭╅樀', 'matrix'],
      det: ['琛屽垪寮?, 'determinant'],
      infty: ['鏃犵┓', 'infinity'],
      emptyset: ['绌洪泦', 'empty set'],
      forall: ['浠绘剰', 'for all'],
      exists: ['瀛樺湪', 'exists'],
      subset: ['瀛愰泦', 'subset'],
      cup: ['骞堕泦', 'union'],
      cap: ['浜ら泦', 'intersection'],
      in: ['灞炰簬', 'element of'],
      leq: ['灏忎簬绛変簬'],
      geq: ['澶т簬绛変簬'],
      neq: ['涓嶇瓑浜?],
      approx: ['绾︾瓑浜?, 'approximately'],
    };
  }
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// 璁剧疆绠＄悊
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?class SettingsManager {
  constructor() {
    this.defaults = {
      displayMode: 'inline',
      fontStyle: 'tex',
      fontColor: '#000000',
      bridgeUrl: 'http://127.0.0.1:28765',
      theme: 'light',
      // Tab 鍚敤璁剧疆
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// 瀵煎嚭宸ュ叿
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?class ExportHelper {
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// 涓婚绠＄悊
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?class ThemeManager {
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
    Logger.info(`Theme 鈫?${this.currentTheme}`);
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// UnicodeMath 鈫?LaTeX 杞崲
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?function unicodeMathToLatex(s) {
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// Extract OMML math element from Word document XML
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?function extractMathElement(xml) {
  // Step 1: Decode ALL HTML entities including numeric character references
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

  // Step 2: Find and extract <m:oMathPara> or <m:oMath>
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
      // Find the FIRST closing tag after start, not the last one in document
      const end = decoded.indexOf(closeTag, start);
      if (end > start) {
        let result = decoded.substring(start, end + closeTag.length);
        // Add namespaces if missing
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// OMML 鈫?LaTeX 杞崲 (绾?JS, 鏃?Python 渚濊禆)
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// MathML 鈫?LaTeX 杞崲
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?function mathmlToLatex(mathml) {
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

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// UI 鎺у埗鍣?// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?class UIController {
  constructor() {
    Logger.info('UIController initializing...');
    this.currentSection = 'editor';
    this.editor = new FormulaEditor();
    this.library = new FormulaLibrary();
    this.themeManager = new ThemeManager();
    this.settingsManager = new SettingsManager();

    this.initCustomSelects();
    this.initEventListeners();
    this.initLibrary();
    this.applySettings();
    this.themeManager.updateButton();
    this.loadPlatforms();
    this.renderPlatformList();
    this.updateOfficeInsertButton();

    // 鍒濆鍖栧巻鍙叉暟鎹簱
    this.initHistoryDb();
    
    Logger.info('UIController ready');
  }

  initCustomSelects() {
    document.querySelectorAll('.custom-select').forEach(el => {
      el._selectInstance = new CustomSelect(el);
    });
  }

  initEventListeners() {
    // 瀵艰埅
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchSection(e.target.id.replace('Btn', ''));
      });
    });

    // 渚ц竟鏍忔帶鍒?    const sidebarPanel = document.getElementById('sidebarPanel');
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

    // ESC 閿叧闂?    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebarPanel?.classList.contains('open')) {
        closeSidebar();
      }
    });

    // 瑙﹀彂鎸夐挳鎷栧姩
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

    // 榧犳爣闈犺繎鍙充晶杈圭紭鑷姩寮瑰嚭
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

    // 璁剧疆鍒楄〃 鈫?浜岀骇椤甸潰瀵艰埅
    document.querySelectorAll('.settings-item').forEach(item => {
      item.addEventListener('click', () => {
        const pageId = item.dataset.page;
        document.getElementById('settingsList').style.display = 'none';
        document.getElementById(pageId)?.classList.add('active');
        Logger.debug(`Settings: open ${pageId}`);
      });
    });

    // 浜岀骇椤甸潰 鈫?杩斿洖鍒楄〃
    document.querySelectorAll('.settings-back').forEach(btn => {
      btn.addEventListener('click', () => {
        const subpage = btn.closest('.settings-subpage');
        // 鍏堝姞杩斿洖鍔ㄧ敾锛屽啀鍒囨崲
        subpage.style.animation = 'none';
        subpage.offsetHeight; // 寮哄埗閲嶆帓
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

    // 娴嬭瘯 Bridge 杩炴帴
    document.getElementById('testBridgeBtn')?.addEventListener('click', async () => {
      const resultEl = document.getElementById('bridgeTestResult');
      if (resultEl) {
        resultEl.textContent = '娴嬭瘯涓?..';
        resultEl.className = 'settings-hint';
      }
      
      const connected = await this.connectBridge();
      if (resultEl) {
        if (connected) {
          resultEl.textContent = '鉁?杩炴帴鎴愬姛';
          resultEl.className = 'settings-hint success';
        } else {
          resultEl.textContent = '鉂?杩炴帴澶辫触';
          resultEl.className = 'settings-hint error';
        }
      }
    });

    // 涓婚
    document.getElementById('themeToggle')?.addEventListener('click', () => {
      this.themeManager.toggle();
    });

    // 澶嶅埗
    document.getElementById('copyLatex')?.addEventListener('click', () => this.copyFormula('latex'));
    document.getElementById('copyMathml')?.addEventListener('click', () => this.copyFormula('mathml'));
    document.getElementById('copySvg')?.addEventListener('click', () => this.copyFormula('svg'));

    // 鎻掑叆鍒?Word
    document.getElementById('insertToWord')?.addEventListener('click', () => this.insertToWord());
    this.updateOfficeInsertButton();

    // 蹇€熷鍒讹紙浣跨敤宸插惎鐢ㄥ钩鍙扮殑鏍煎紡锛?    document.getElementById('quickCopy')?.addEventListener('click', () => {
      const enabledPlatform = this.platforms.find(p => p.enabled);
      if (enabledPlatform) {
        this.copyFormula(enabledPlatform.format);
        this.showToast(`宸插鍒?${enabledPlatform.name} 鏍煎紡`);
      } else {
        this.copyFormula('latex');
      }
    });

    // 瀛椾綋鏍峰紡
    document.getElementById('fontStyleSelect')?.addEventListener('change', (e) => {
      this.updateFontStyle(e.detail.value);
    });

    // 瀛椾綋棰滆壊
    document.getElementById('fontColor')?.addEventListener('input', (e) => {
      this.updateFontColor(e.target.value);
    });
    
    document.getElementById('colorPreview')?.addEventListener('click', () => {
      document.getElementById('fontColor')?.click();
    });

    // 琛岄棿鍏紡鍒囨崲
    document.getElementById('displayMode')?.addEventListener('change', (e) => {
      const display = e.target.checked;
      Logger.info(`displayMode: ${display}`);
      const latex = this.editor.getLatex();
      if (latex) {
        this.editor.updatePreview(latex);
      }
    });

    // LaTeX 杈撳叆鍚屾
    document.getElementById('latexSource')?.addEventListener('input', (e) => {
      let latex = e.target.value;

      // 鍘绘帀 $$ 鍜?$ 鍒嗛殧绗?      latex = latex.replace(/^\$\$\s*/m, '').replace(/\s*\$\$\s*$/m, '');
      latex = latex.replace(/^\$\s*/, '').replace(/\s*\$/, '');

      this.editor.setLatex(latex);
      this.editor.updatePreview(latex);
    });

    // 閿洏蹇嵎閿?    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + Enter: 澶嶅埗 LaTeX 鍒板壀璐存澘
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.copyFormula('latex');
      }
      // Ctrl/Cmd + Shift + Enter: 鎻掑叆鍏紡鍒扮紪杈戝櫒
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        const latex = this.editor.getLatex();
        if (latex) {
          navigator.clipboard.writeText(latex).catch(() => {});
          this.switchSection('editor');
          this.showToast('宸插鍒讹紝鍙矘璐村埌鐩爣缂栬緫鍣?);
        }
      }
      // Ctrl/Cmd + S: 瀵煎嚭 .tex
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const latex = this.editor.getLatex();
        if (latex) {
          ExportHelper.exportToTex(latex);
          this.showToast('宸插鍑?.tex 鏂囦欢');
        }
      }
    });

    // 鍏紡搴撴悳绱?    document.getElementById('librarySearch')?.addEventListener('input', (e) => {
      this.searchLibrary(e.target.value);
    });

    // OCR
    document.getElementById('screenshotBtn')?.addEventListener('click', () => {
      this.startScreenshot();
    });
    document.getElementById('ocrInsertBtn')?.addEventListener('click', () => {
      this.insertOcrResult();
    });
    document.getElementById('ocrCopyBtn')?.addEventListener('click', () => {
      this.copyOcrResult();
    });

    // 娓呯┖鍘嗗彶
    document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
      this.clearAllHistory(false);
    });
    document.getElementById('clearHistoryBtn2')?.addEventListener('click', () => {
      this.clearAllHistory(false);
    });

    // 鍘嗗彶绛涢€?    document.querySelectorAll('.history-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.history-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.historyFilter = btn.dataset.filter;
        this.renderHistoryList();
      });
    });

    // 璁剧疆
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

    // Tab 鍚敤寮€鍏?    document.getElementById('officeEnabledToggle')?.addEventListener('change', (e) => {
      this.settingsManager.set('officeEnabled', e.target.checked);
      this.updateTabVisibility();
      Logger.info(`Settings: officeEnabled = ${e.target.checked}`);
    });
    document.getElementById('ocrEnabledToggle')?.addEventListener('change', (e) => {
      this.settingsManager.set('ocrEnabled', e.target.checked);
      this.updateTabVisibility();
      Logger.info(`Settings: ocrEnabled = ${e.target.checked}`);
    });

    Logger.debug('Event listeners ready');

    // Bridge Office events
    this.initOfficeBridge();

    // Office.js integration
    this.initOfficeJS();
  }

  initOfficeJS() {
    // Make app accessible for Office.js callbacks
    window.__app = this;

    // Initialize Office.js if available
    if (typeof Office !== 'undefined') {
      Office.onReady((info) => {
        Logger.info(`Office.js ready: ${info.host} ${info.platform}`);
      });
    } else {
      Logger.info('Office.js not available (not running in Office)');
    }

    // Register global functions for Office.js ExecuteFunction
    window.insertFormula = async () => {
      const latex = this.editor?.getLatex();
      if (!latex) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('write_pending_formula', { latex });
        this.showToast('宸插彂閫佸埌 Word');
      } catch (e) {
        this.showToast('鍙戦€佸け璐? ' + e.message);
      }
    };

    window.loadSelection = () => {
      // This is called from Office.js when user clicks "Load Selection"
      // The actual text comes from the bridge event
      Logger.info('loadSelection called from Office.js');
    };

    window.deleteSelection = () => {
      Logger.info('deleteSelection called from Office.js');
    };
  }

  async initOfficeBridge() {
    try {
      const { listen } = await import('@tauri-apps/api/event');

      listen('office-render-formula', async (event) => {
        const { id, latex } = event.payload;
        Logger.info(`Bridge: render ${id}: ${latex}`);
        try {
          await this.editor.renderer.init();
          const mathml = this.editor.renderer.toMathML(latex);
          Logger.info(`MathML (${mathml.length}b): ${mathml.substring(0, 100)}...`);
          await fetch('http://localhost:19876/api/office/render-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, mathml })
          });
        } catch (e) { Logger.error('Bridge render error:', e); }
      });

      listen('office-insert-formula', async (event) => {
        const { latex, type } = event.payload;
        Logger.info(`Bridge: insert formula: ${latex}`);
        this.editor.setLatex(latex);
        this.showToast(`鍏紡宸插姞杞? ${latex}`);
      });

      listen('office-load-selection', async (event) => {
        const { text } = event.payload;
        Logger.info(`Bridge: load selection raw: ${text}`);
        if (text) {
          const latex = unicodeMathToLatex(text);
          Logger.info(`Bridge: load selection latex: ${latex}`);
          this.switchSection('editor');
          this.editor.setLatex(latex);
          this.showToast('宸插姞杞介€変腑鏂囨湰');
        }
      });

      listen('office-load-selection-mathml', async (event) => {
        const { mathml } = event.payload;
        Logger.info(`Bridge: load selection mathml: ${mathml.substring(0, 200)}...`);
        if (mathml) {
          const latex = mathmlToLatex(mathml);
          Logger.info(`Bridge: load selection latex from mathml: ${latex}`);
          this.switchSection('editor');
          this.editor.setLatex(latex);
          this.showToast('宸插姞杞介€変腑鏂囨湰');
        }
      });

      listen('office-load-selection-omml', async (event) => {
        const { omml } = event.payload;
        Logger.info(`Bridge: load selection omml (${omml.length}b): ${omml.substring(0, 200)}...`);
        if (omml) {
          // Extract <m:oMath> or <m:oMathPara> from full Word XML
          const mathXml = extractMathElement(omml);
          Logger.info(`Bridge: extracted math element (${mathXml.length}b): ${mathXml.substring(0, 200)}...`);

          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const latex = await invoke('omml_to_latex', { xml: mathXml });
            Logger.info(`Bridge: rust omml_to_latex result: '${latex}'`);
            if (latex && latex.length > 0) {
              this.switchSection('editor');
              this.editor.setLatex(latex);
              this.showToast('宸插姞杞介€変腑鏂囨湰');
              return;
            }
            Logger.warn('Rust returned empty, trying JS fallback');
          } catch (e) {
            Logger.error('Rust invoke failed:', e);
          }

          // JS fallback
          const latex = ommlToLatex(mathXml);
          Logger.info(`Bridge: JS ommlToLatex result: '${latex}'`);
          this.switchSection('editor');
          this.editor.setLatex(latex);
          this.showToast('宸插姞杞介€変腑鏂囨湰');
        }
      });

      listen('office-show-app', async () => {
        Logger.info('Bridge: show app');
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        await win.show();
        await win.setFocus();
      });

      Logger.info('Office bridge events initialized');
    } catch (e) {
      Logger.error('Failed to init office bridge:', e);
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

    // 鍔犺浇鍏紡鏁版嵁
    await this.library.load();

    Logger.debug(`Library loaded: ${this.library.categories.length} categories`);

    const categorySelect = document.getElementById('categorySelect');
    const categoryDropdown = document.getElementById('categoryDropdown');
    const grid = document.getElementById('libraryGrid');

    if (!categorySelect || !categoryDropdown || !grid) {
      Logger.warn('Library UI elements not found');
      return;
    }

    // 娓叉煋鍒嗙被涓嬫媺閫夐」
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

    // 娓叉煋绗竴涓垎绫荤殑鍏紡
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
      grid.innerHTML = '<div style="color: var(--muted); text-align: center; padding: 1rem; grid-column: 1/-1;">鏆傛棤鍏紡</div>';
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
      grid.innerHTML = '<div style="color: var(--muted); text-align: center; padding: 1rem; grid-column: 1/-1;">鏈壘鍒板尮閰嶅叕寮?/div>';
      return;
    }

    results.forEach(({ formula, category }) => {
      const item = document.createElement('div');
      item.className = 'formula-item';
      item.title = `${formula.latex}\n鍒嗙被: ${category}`;
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

    // 淇濆瓨鍒板巻鍙茶褰?    this.addHistoryItem(latex);

    // 灏?#? 杞崲涓?MathLive 鐨勫崰浣嶇鏍煎紡
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

    this.showToast('宸叉彃鍏ュ叕寮?);
  }

  // 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?  // 鍘嗗彶璁板綍绠＄悊 (鍘熺敓 IndexedDB)
  // 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?  historyDb = null;
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
    this.showToast('鍘嗗彶璁板綍宸叉竻绌?);
  }

  async renderHistoryList() {
    const listEl = document.getElementById('historyList');
    if (!listEl) return;

    const items = await this.getHistoryItems(this.historyFilter);

    if (items.length === 0) {
      listEl.innerHTML = '<div class="history-empty">鏆傛棤鍘嗗彶璁板綍<br>浣跨敤缂栬緫鍣ㄦ垨 OCR 娣诲姞鍏紡</div>';
      return;
    }

    listEl.innerHTML = items.map(item => {
      const time = new Date(item.createdAt).toLocaleString('zh-CN');
      const sourceMap = { editor: '缂栬緫鍣?, ocr: 'OCR', formula: '鍏紡搴? };
      const srcLabel = sourceMap[item.source] || '缂栬緫鍣?;
      return `
        <div class="history-item-wrap">
          <div class="hi-swipe-bg">
            <div class="hi-swipe-delete">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              鍒犻櫎
            </div>
            <div class="hi-swipe-actions">
              <span class="hi-swipe-fav-label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                宸叉敹钘?              </span>
              <button class="hi-swipe-btn" data-action="copy">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                澶嶅埗
              </button>
              <button class="hi-swipe-btn" data-action="insert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                鎻掑叆
              </button>
            </div>
          </div>
          <div class="history-item" data-id="${item.id}">
            <div class="hi-latex">${this._escapeHtml(item.latex)}</div>
            <div class="hi-meta">
              <span class="hi-tag">${srcLabel}</span>
              <span>${time}</span>
              <button class="hi-fav ${item.favorite ? 'active' : ''}" data-action="fav" title="鏀惰棌">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${item.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 鍒濆鍖栨粦鍔?    listEl.querySelectorAll('.history-item').forEach(card => {
      this.initSwipe(card);
    });

    // 鐐瑰嚮绌虹櫧鍖哄煙鏀跺洖鎵€鏈夋粦鍔?    listEl.addEventListener('click', (e) => {
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

    // 鏀惰棌鎸夐挳
    listEl.querySelectorAll('.hi-fav').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.closest('.history-item').dataset.id);
        await this.toggleFavoriteHistory(id);
        this.renderHistoryList();
      });
    });
  }

  // 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?  // 婊戝姩鎺у埗鍣?(瀛︿範 LaTeXSnipper_mobile)
  // 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?  initSwipe(card) {
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
        // 鍙虫粦锛氭樉绀哄垹闄?        if (dz) dz.style.width = Math.round(Math.min(dx, wrapWidth * 0.3)) + 'px';
        if (az) { az.style.width = '0'; az.classList.remove('fav-mode'); }
        actionBtns.forEach(b => b.classList.remove('visible'));
        if (favLabel) favLabel.style.opacity = '0';
        if (dz) dz.style.pointerEvents = dx > 50 ? 'auto' : 'none';
      } else if (dx < 0) {
        // 宸︽粦
        if (az) az.style.width = Math.round(Math.min(abs, wrapWidth * 0.5)) + 'px';
        if (dz) dz.style.width = '0';

        if (abs > wrapWidth * 0.55) {
          // 鏀惰棌妯″紡锛氶殣钘忔寜閽紝鏄剧ず鏀惰棌鎻愮ず
          if (az) az.classList.add('fav-mode');
          actionBtns.forEach(b => b.classList.remove('visible'));
          if (favLabel) favLabel.style.opacity = '1';
        } else if (abs > wrapWidth * 0.2) {
          // 鎿嶄綔妯″紡锛氭樉绀哄鍒跺拰鎻掑叆鎸夐挳
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
      // 璁剧疆鍥哄畾瀹藉害
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
        this.showToast('宸插鍒?);
      } else if (action === 'insert') {
        this.editor.setLatex(item.latex);
        this.editor.updatePreview(item.latex);
        const source = document.getElementById('latexSource');
        if (source) source.value = item.latex;
        this.switchSection('editor');
        this.showToast('宸插姞杞藉叕寮?);
      }
    };

    // 瑙︽懜/榧犳爣浜嬩欢
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

      // 鍙虫粦 鈫?鍒犻櫎
      if (currentDx > wrapWidth * 0.3) {
        doDelete();
      } else if (currentDx > wrapWidth * 0.12) {
        snapTo(1);

      // 宸︽粦 鈫?鏀惰棌锛堣秴杩?55% 瀹藉害鏃跺垏鎹负鏀惰棌妯″紡锛?      } else if (currentDx < -(wrapWidth * 0.55)) {
        // 宸茶繘鍏ユ敹钘忔ā寮忥紝鐩存帴瑙﹀彂鏀惰棌
        const id = Number(card.dataset.id);
        this.toggleFavoriteHistory(id).then(() => {
          this.renderHistoryList();
        });

      } else if (currentDx < -(wrapWidth * 0.2)) {
        snapTo(-1);

      // 鏈揪闃堝€?鈫?鍥炲脊
      } else {
        returnToOrigin(true);
      }
    };

    // 榧犳爣浜嬩欢
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

    // 瑙︽懜浜嬩欢
    card.addEventListener('touchstart', (e) => {
      if (e.target.closest('.hi-fav')) return;
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    card.addEventListener('touchmove', (e) => {
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    card.addEventListener('touchend', () => onEnd());

    // 婊戝姩鎸夐挳鐐瑰嚮
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

    // 鍏紡搴撹Е鍙戞寜閽彧鍦ㄧ紪杈戝櫒椤甸潰鏄剧ず
    const sidebarTrigger = document.getElementById('sidebarTrigger');
    const sidebarPanel = document.getElementById('sidebarPanel');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (section === 'editor') {
      sidebarTrigger?.classList.remove('hidden');
    } else {
      sidebarTrigger?.classList.add('hidden');
      sidebarPanel?.classList.remove('open');
      sidebarOverlay?.classList.remove('visible');
    }

    // 鍒囨崲鍒板巻鍙叉椂娓叉煋鍒楄〃
    if (section === 'history') {
      this.renderHistoryList();
    }

    // 鍒囨崲鍒拌缃椂娓叉煋骞冲彴鍒楄〃
    if (section === 'settings') {
      this.renderPlatformList();
    }

    // 鍒囨崲鍒?OCR 鏃舵娴?Bridge 杩炴帴
    if (section === 'ocr') {
      this.checkBridgeStatus();
    }
  }

  // 鏍规嵁璁剧疆鏇存柊 Tab 鏄剧ず/闅愯棌
  updateTabVisibility() {
    Logger.debug('Updating tab visibility...');
    const settings = this.settingsManager.settings;
    
    // OCR Tab
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
      statusEl.textContent = '鉁?宸茶繛鎺ュ埌妗岄潰绔?LaTeXSnipper';
      statusEl.style.color = 'var(--accent)';
    } else {
      statusEl.textContent = '鉂?鏈娴嬪埌妗岄潰绔紝璇峰厛鍚姩 LaTeXSnipper';
      statusEl.style.color = '#ef4444';
    }
  }

  async copyFormula(format) {
    Logger.info(`copyFormula: ${format}`);
    const latex = this.editor.getLatex();
    if (!latex) {
      this.showStatus('璇峰厛杈撳叆鍏紡');
      return;
    }

    let textToCopy = latex;

    try {
      if (format === 'mathml') {
        textToCopy = `<math xmlns="http://www.w3.org/1998/Math/MathML">${this._latexToMathml(latex)}</math>`;
      } else if (format === 'svg') {
        const svg = await this.editor.renderer.render(latex, false);
        textToCopy = svg || latex;
      }

      // 浣跨敤 textarea 闄嶇骇澶嶅埗锛堝吋瀹规€ф渶濂斤級
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

      if (ok) {
        this.showToast(`宸插鍒?${format.toUpperCase()}`);
        Logger.info(`Copy successful: ${format}`);
      } else {
        this.showToast('澶嶅埗澶辫触');
      }
    } catch (e) {
      Logger.error('Copy failed:', e);
      this.showToast('澶嶅埗澶辫触');
    }
  }

  async insertToWord() {
    const latex = this.editor.getLatex();
    if (!latex) {
      this.showStatus('璇峰厛杈撳叆鍏紡');
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const fontStyle = document.getElementById('fontStyleSelect')?.value || 'tex';
      const fontColor = document.getElementById('fontColor')?.value || '#000000';
      const result = await invoke('write_pending_formula', { latex, fontColor, fontStyle });
      this.showToast(result.message || '宸插彂閫佸埌 Word锛岃鍦?Word 涓偣鍑?Insert Formula');
    } catch (e) {
      this.showToast('鍙戦€佸け璐? ' + e.message);
    }
  }

  updateOfficeInsertButton() {
    const officePlatform = this.platforms.find(p => p.id === 'office');
    const btn = document.getElementById('insertToWord');
    if (btn) {
      btn.style.display = officePlatform?.enabled ? '' : 'none';
    }
  }

  updateFontStyle(style) {
    Logger.info(`fontStyle: ${style}`);
    
    // 鏇存柊棰勮瀛椾綋鏍峰紡
    const previewHost = document.getElementById('previewHost');
    if (previewHost) {
      previewHost.style.fontStyle = style === 'italic' ? 'italic' : 'normal';
      previewHost.style.fontWeight = style === 'bold' ? 'bold' : 'normal';
      previewHost.style.fontFamily = style === 'roman' ? 'serif' : '';
    }
    
    this.showStatus(`瀛椾綋鏍峰紡: ${style}`);
  }

  updateFontColor(color) {
    Logger.info(`fontColor: ${color}`);
    
    // 鏇存柊棰勮棰滆壊
    const previewHost = document.getElementById('previewHost');
    if (previewHost) {
      previewHost.style.color = color;
    }
    
    this.showStatus(`棰滆壊宸叉洿鏂癭);
  }

  showStatus(message) {
    Logger.debug(`showStatus: ${message}`);
    const statusText = document.getElementById('statusText');
    if (statusText) {
      statusText.textContent = message;
      setTimeout(() => { statusText.textContent = '灏辩华'; }, 2000);
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

  // 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?  // 骞冲彴绠＄悊
  // 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?  platforms = [
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
      desc: 'Markdown 绗旇缂栬緫鍣?,
      icon: '/icons/platforms/obsidian.svg',
      color: '#7c3aed',
      enabled: false,
      format: 'markdown_inline',
      shortcut: null,
    },
    {
      id: 'vscode',
      name: 'VS Code',
      desc: '浠ｇ爜缂栬緫鍣?,
      icon: '/icons/platforms/vscode.svg',
      color: '#007acc',
      enabled: false,
      format: 'latex',
      shortcut: null,
    },
    {
      id: 'wps',
      name: 'WPS Office',
      desc: '鍔炲叕濂椾欢',
      icon: '/icons/platforms/wps.svg',
      color: '#00a651',
      enabled: false,
      format: 'omml',
      shortcut: null,
    },
    {
      id: 'typora',
      name: 'Typora',
      desc: 'Markdown 缂栬緫鍣?,
      icon: '/icons/platforms/typora.svg',
      color: '#4a90d9',
      enabled: false,
      format: 'latex',
      shortcut: null,
    },
    {
      id: 'notion',
      name: 'Notion',
      desc: '鐭ヨ瘑绠＄悊宸ュ叿',
      icon: '/icons/platforms/notion.svg',
      color: '#000000',
      enabled: false,
      format: 'latex',
      shortcut: null,
    },
    {
      id: 'libreoffice',
      name: 'LibreOffice',
      desc: '寮€婧愬姙鍏浠?,
      icon: '/icons/platforms/libreoffice.svg',
      color: '#18a303',
      enabled: false,
      format: 'mathml',
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

  renderPlatformList() {
    const listEl = document.getElementById('platformList');
    if (!listEl) return;

    listEl.innerHTML = this.platforms.map(p => `
      <div class="platform-item">
        <div class="platform-icon" style="background:${p.color}15;">
          <img src="${p.icon}" alt="${p.name}" style="width:18px;height:18px;">
        </div>
        <div class="platform-info">
          <div class="platform-name">${p.name}</div>
          <div class="platform-desc">${p.desc}${p.enabled ? ' 路 宸插惎鐢? : ''}</div>
        </div>
        <label class="custom-toggle">
          <input type="checkbox" class="platform-toggle" data-platform="${p.id}" ${p.enabled ? 'checked' : ''}>
          <span class="toggle-track"></span>
        </label>
      </div>
    `).join('');

    // 缁戝畾寮€鍏充簨浠?    listEl.querySelectorAll('.platform-toggle').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const platformId = e.target.dataset.platform;
        const platform = this.platforms.find(p => p.id === platformId);
        if (platform) {
          platform.enabled = e.target.checked;
          this.savePlatforms();
          if (platform.enabled) {
            await this.registerPlatform(platform);
          } else {
            await this.unregisterPlatform(platform);
          }
          this.renderPlatformList();
          this.updateOfficeInsertButton();
        }
      });
    });
  }

  // Platform integration support state.
  platformSupport = {
    office: { ready: true, message: 'Office uses the native VSTO plugin from LaTeXSnipper/office_plugin.' },
    obsidian: { ready: true, message: 'Obsidian plugin package can be prepared automatically.' },
    vscode: { ready: true, message: 'VS Code unpacked extension can be installed automatically.' },
    wps: { ready: true, message: 'WPS uses the WpsAddIn JSAddIn package when available.' },
    typora: { ready: true, message: 'Typora uses Markdown clipboard integration.' },
    notion: { ready: true, message: 'Notion uses clipboard integration.' },
    libreoffice: { ready: true, message: 'LibreOffice integration scaffold can be prepared automatically.' },
  };

  async registerPlatform(platform) {
    Logger.info(`Registering platform: ${platform.name}`);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('install_platform_integration', { platformId: platform.id });
      if (result.success) {
        this.showToast(result.message || `${platform.name} enabled`, 3500);
        Logger.info(`${platform.id} integration installed: ${result.message}`);
      } else {
        this.showToast(result.message || `${platform.name} enable failed`, 3500);
        platform.enabled = false;
        this.savePlatforms();
      }
    } catch (e) {
      Logger.error(`${platform.id} registration failed:`, e);
      this.showToast(`${platform.name} enable failed: ${e.message || e}`, 3500);
      platform.enabled = false;
      this.savePlatforms();
    }
  }

  async unregisterPlatform(platform) {
    Logger.info(`Unregistering platform: ${platform.name}`);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('uninstall_platform_integration', { platformId: platform.id });
      if (result.success) {
        this.showToast(result.message || `${platform.name} disabled`, 3500);
        Logger.info(`${platform.id} integration removed: ${result.message}`);
      } else {
        this.showToast(result.message || `${platform.name} disable failed`, 3500);
      }
    } catch (e) {
      Logger.error(`${platform.id} unregister failed:`, e);
      this.showToast(`${platform.name} disable failed: ${e.message || e}`, 3500);
    }
  }

  // Runtime state.
  ocrLatex = '';
  bridgeConfig = null;

  async connectBridge() {
    Logger.info('Connecting to LaTeXSnipper Bridge...');
    try {
      const response = await fetch('/bridge/config', {
        signal: AbortSignal.timeout(3000),
      });
      const data = await response.json();
      // Bridge 杩斿洖鏍煎紡: { ok: true, result: { bridge_url, token } }
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
    this.showStatus('姝ｅ湪杩炴帴妗岄潰绔?..');

    const connected = await this.connectBridge();
    if (!connected) {
      this.showStatus('鏃犳硶杩炴帴 LaTeXSnipper锛岃纭繚妗岄潰绔鍦ㄨ繍琛?);
      return;
    }

    // 鍏堝彇娑堝彲鑳藉瓨鍦ㄧ殑鏃ц姹?    try {
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

    this.showStatus('宸插彂璧锋埅鍥捐姹傦紝璇峰垏鎹㈠埌妗岄潰绔搷浣滄埅鍥?);

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

        if (ocrResult) ocrResult.textContent = this.ocrLatex || '鏈瘑鍒埌鍏紡';
        if (ocrInsertBtn) ocrInsertBtn.disabled = !this.ocrLatex;
        if (ocrCopyBtn) ocrCopyBtn.disabled = !this.ocrLatex;

        this.showStatus(this.ocrLatex ? '璇嗗埆瀹屾垚' : '鏈瘑鍒埌鍏紡');
        Logger.info(`OCR result: ${this.ocrLatex}`);
      } else {
        const errMsg = data.error?.message || '璇嗗埆澶辫触';
        this.showStatus(errMsg);
        Logger.error('OCR failed:', errMsg);
      }
    } catch (e) {
      Logger.error('Screenshot OCR failed:', e);
      this.showStatus('鎴浘璇嗗埆澶辫触锛岃纭繚妗岄潰绔鍦ㄨ繍琛?);
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
      this.showStatus('宸插鍒?LaTeX');
    }
  }

  applySettings() {
    const settings = this.settingsManager.settings;
    Logger.debug('Applying settings:', settings);

    // 搴旂敤 Bridge URL
    const bridgeInput = document.getElementById('bridgeUrlInput');
    if (bridgeInput && settings.bridgeUrl) {
      bridgeInput.value = settings.bridgeUrl;
    }

    // 搴旂敤榛樿鏄剧ず妯″紡
    const displayMode = document.getElementById('displayMode');
    if (displayMode) {
      displayMode.checked = settings.displayMode === 'display';
    }

    // 搴旂敤 Tab 寮€鍏崇姸鎬?    const officeToggle = document.getElementById('officeEnabledToggle');
    if (officeToggle) {
      officeToggle.checked = settings.officeEnabled;
    }
    const ocrToggle = document.getElementById('ocrEnabledToggle');
    if (ocrToggle) {
      ocrToggle.checked = settings.ocrEnabled;
    }

    // 鏇存柊 Tab 鏄剧ず/闅愯棌
    this.updateTabVisibility();
  }
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?// 鍒濆鍖?// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?document.addEventListener('DOMContentLoaded', () => {
  Logger.info('DOM loaded');
  new UIController();
  Logger.info('App ready');
  Logger.info('Global shortcut: Ctrl/Cmd+Shift+L (registered in Rust backend)');
});
