/**
 * FormulaStyle Module - 公式样式模块
 *
 * 功能：格式化所选、格式化全文
 */

export class FormulaStyleModule {
  constructor(formatter = null) {
    this.isInitialized = false;
    this.formatter = formatter;
    this.defaultStyle = {
      fontSize: 12,
      fontFamily: "Cambria Math",
      fontStyle: "italic",
      color: "#000000",
    };
  }

  async initialize() {
    console.log("[FormulaStyleModule] Initializing...");
    this.isInitialized = true;
  }

  dispose() {
    console.log("[FormulaStyleModule] Disposed");
  }

  /**
   * 格式化所选公式
   * 应用默认样式到选中的公式
   */
  async formatSelection() {
    console.log("[FormulaStyleModule] Formatting selection...");
    return this.runFormatter(
      "formatSelection",
      "当前 Office 主机尚未提供所选公式格式化能力",
    );
  }

  /**
   * 格式化全文公式
   * 应用默认样式到文档中的所有公式
   */
  async formatAll() {
    console.log("[FormulaStyleModule] Formatting all formulas...");
    return this.runFormatter(
      "formatAll",
      "当前 Office 主机尚未提供全文公式格式化能力",
    );
  }

  async runFormatter(method, unsupportedMessage) {
    const operation = this.formatter?.[method];
    if (typeof operation !== "function") {
      return {
        success: false,
        code: "FORMAT_UNSUPPORTED",
        message: unsupportedMessage,
      };
    }

    try {
      const result = await operation.call(
        this.formatter,
        this.getDefaultStyle(),
      );
      if (!result || result.success !== true) {
        return {
          success: false,
          code: result?.code || "FORMAT_FAILED",
          message: result?.message || "公式格式化失败",
        };
      }
      return result;
    } catch (error) {
      return {
        success: false,
        code: "FORMAT_FAILED",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 设置默认样式
   * @param {object} style - 样式配置
   */
  setDefaultStyle(style) {
    this.defaultStyle = { ...this.defaultStyle, ...style };
    console.log(
      "[FormulaStyleModule] Default style updated:",
      this.defaultStyle,
    );
  }

  /**
   * 获取默认样式
   */
  getDefaultStyle() {
    return { ...this.defaultStyle };
  }

  /**
   * 应用样式到公式
   * @param {object} formula - 公式对象
   * @param {object} style - 样式配置
   */
  applyStyle(formula, style) {
    const mergedStyle = { ...this.defaultStyle, ...style };
    return {
      ...formula,
      style: mergedStyle,
    };
  }
}
