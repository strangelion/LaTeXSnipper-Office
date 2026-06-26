/**
 * Formula Editor Types
 * @module @latexsnipper/formula-editor
 */

import type { MathfieldElement } from 'mathlive';

/**
 * Formula editor options
 */
export interface FormulaEditorOptions {
  /** Container element */
  container: HTMLElement;
  /** Initial value (LaTeX) */
  value?: string;
  /** Display mode (true for display, false for inline) */
  displayMode?: boolean;
  /** Font family */
  fontFamily?: string;
  /** Font size in px */
  fontSize?: number;
  /** Enable virtual keyboard */
  virtualKeyboard?: boolean;
  /** Change callback */
  onChange?: (value: string) => void;
}

/**
 * Formula editor interface
 */
export interface FormulaEditor {
  /** Get the underlying MathLive element */
  readonly element: MathfieldElement;
  
  /** Set the LaTeX value */
  setValue(value: string): void;
  
  /** Get the LaTeX value */
  getValue(): string;
  
  /** Set display mode */
  setDisplayMode(display: boolean): void;
  
  /** Get display mode */
  getDisplayMode(): boolean;
  
  /** Set font family */
  setFontFamily(family: string): void;
  
  /** Set font size */
  setFontSize(size: number): void;
  
  /** Focus the editor */
  focus(): void;
  
  /** Blur the editor */
  blur(): void;
  
  /** Insert text at cursor */
  insertText(text: string): void;
  
  /** Register event listener */
  on(event: 'change', callback: (value: string) => void): void;
  
  /** Unregister event listener */
  off(event: 'change', callback: (value: string) => void): void;
  
  /** Destroy the editor */
  destroy(): void;
}

/**
 * Formula editor event map
 */
export interface FormulaEditorEvents {
  change: (value: string) => void;
  focus: () => void;
  blur: () => void;
}
