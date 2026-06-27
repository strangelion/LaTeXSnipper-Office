/**
 * Office Plugin Module
 * 
 * 复刻 LaTeXSnipper Office 插件的完整功能
 * 包含：公式、编辑、转换、交叉引用、编号、公式样式、工具
 */

import { FormulaModule } from './formula.js';
import { EditModule } from './edit.js';
import { ConvertModule } from './convert.js';
import { CrossRefModule } from './crossref.js';
import { NumberingModule } from './numbering.js';
import { FormulaStyleModule } from './formula-style.js';
import { ToolsModule } from './tools.js';

export class OfficePlugin {
  constructor() {
    this.formula = new FormulaModule();
    this.edit = new EditModule();
    this.convert = new ConvertModule();
    this.crossref = new CrossRefModule();
    this.numbering = new NumberingModule();
    this.formulaStyle = new FormulaStyleModule();
    this.tools = new ToolsModule();
  }

  async initialize() {
    console.log('[OfficePlugin] Initializing...');
    await Promise.all([
      this.formula.initialize(),
      this.edit.initialize(),
      this.convert.initialize(),
      this.crossref.initialize(),
      this.numbering.initialize(),
      this.formulaStyle.initialize(),
      this.tools.initialize(),
    ]);
    console.log('[OfficePlugin] Initialized successfully');
  }

  dispose() {
    this.formula.dispose();
    this.edit.dispose();
    this.convert.dispose();
    this.crossref.dispose();
    this.numbering.dispose();
    this.formulaStyle.dispose();
    this.tools.dispose();
  }
}

export { FormulaModule } from './formula.js';
export { EditModule } from './edit.js';
export { ConvertModule } from './convert.js';
export { CrossRefModule } from './crossref.js';
export { NumberingModule } from './numbering.js';
export { FormulaStyleModule } from './formula-style.js';
export { ToolsModule } from './tools.js';
