/**
 * Formula Renderer Types
 * @module @latexsnipper/formula-renderer
 */

/**
 * Render output format
 */
export type RenderFormat = 'mathml' | 'svg' | 'png' | 'omml';

/**
 * Render options
 */
export interface RenderOptions {
  /** Display mode (true for display, false for inline) */
  display?: boolean;
  /** Output formats to generate */
  formats?: RenderFormat[];
  /** Target DPI for PNG output */
  dpi?: number;
  /** Font scale factor */
  fontScale?: number;
  /** Font color */
  fontColor?: string;
  /** Theme (light or dark) */
  theme?: 'light' | 'dark';
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Render result
 */
export interface RenderResult {
  /** Original LaTeX */
  latex: string;
  /** Display mode */
  display: boolean;
  /** MathML output */
  mathml?: string;
  /** SVG output */
  svg?: string;
  /** PNG output (base64) */
  png?: string;
  /** OMML output */
  omml?: string;
  /** Warnings */
  warnings: string[];
  /** Renderer version */
  version: string;
}

/**
 * Formula renderer interface
 */
export interface FormulaRenderer {
  /** Render LaTeX to specified formats */
  render(latex: string, options?: RenderOptions): Promise<RenderResult>;
  
  /** Convert LaTeX to MathML */
  toMathML(latex: string, display?: boolean): Promise<string>;
  
  /** Convert LaTeX to SVG */
  toSVG(latex: string, display?: boolean): Promise<string>;
  
  /** Convert LaTeX to PNG (base64) */
  toPNG(latex: string, options?: PNGOptions): Promise<string>;
  
  /** Convert LaTeX to OMML */
  toOMML(latex: string, display?: boolean): Promise<string>;
  
  /** Warm up the renderer */
  warmup(): Promise<void>;
  
  /** Check if renderer is ready */
  isReady(): boolean;
  
  /** Destroy the renderer */
  destroy(): void;
}

/**
 * PNG options
 */
export interface PNGOptions {
  /** Display mode */
  display?: boolean;
  /** Target DPI */
  dpi?: number;
  /** Font scale */
  fontScale?: number;
  /** Background color */
  backgroundColor?: string;
}
