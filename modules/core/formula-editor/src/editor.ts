/**
 * Formula Editor Implementation
 * @module @latexsnipper/formula-editor
 */

import { MathfieldElement } from 'mathlive';
import type { FormulaEditor, FormulaEditorOptions } from './types';

/**
 * Create a formula editor
 * @param options - Editor options
 * @returns Formula editor instance
 */
export function createFormulaEditor(options: FormulaEditorOptions): FormulaEditor {
  const {
    container,
    value = '',
    displayMode = false,
    fontFamily = '',
    fontSize = 20,
    virtualKeyboard = true,
    onChange,
  } = options;

  // Create MathLive element
  const element = new MathfieldElement();
  element.mathVirtualKeyboardPolicy = virtualKeyboard ? 'auto' : 'off';
  element.defaultMode = displayMode ? 'displaymath' : 'math';
  
  // Apply styles
  if (fontFamily) {
    element.style.fontFamily = fontFamily;
  }
  element.style.fontSize = `${fontSize}px`;
  element.style.minHeight = '60px';
  element.style.width = '100%';

  // Add to container
  container.appendChild(element);

  // Set initial value
  if (value) {
    element.setValue(value, { silenceNotifications: true });
  }

  // Event handlers
  const changeListeners: Array<(value: string) => void> = [];
  const focusListeners: Array<() => void> = [];
  const blurListeners: Array<() => void> = [];

  const handleChange = () => {
    const currentValue = element.getValue('latex-expanded');
    changeListeners.forEach(cb => cb(currentValue));
    onChange?.(currentValue);
  };

  const handleFocus = () => {
    focusListeners.forEach(cb => cb());
  };

  const handleBlur = () => {
    blurListeners.forEach(cb => cb());
  };

  element.addEventListener('input', handleChange);
  element.addEventListener('focus', handleFocus);
  element.addEventListener('blur', handleBlur);

  // Create editor instance
  const editor: FormulaEditor = {
    get element() {
      return element;
    },

    setValue(value: string) {
      element.setValue(value, { silenceNotifications: true });
    },

    getValue(): string {
      return element.getValue('latex-expanded');
    },

    setDisplayMode(display: boolean) {
      element.defaultMode = display ? 'displaymath' : 'math';
    },

    getDisplayMode(): boolean {
      return element.defaultMode === 'displaymath';
    },

    setFontFamily(family: string) {
      element.style.fontFamily = family;
    },

    setFontSize(size: number) {
      element.style.fontSize = `${size}px`;
    },

    focus() {
      element.focus();
    },

    blur() {
      element.blur();
    },

    insertText(text: string) {
      element.insert(text);
    },

    on(event, callback) {
      switch (event) {
        case 'change':
          changeListeners.push(callback);
          break;
      }
    },

    off(event, callback) {
      switch (event) {
        case 'change':
          const index = changeListeners.indexOf(callback);
          if (index > -1) {
            changeListeners.splice(index, 1);
          }
          break;
      }
    },

    destroy() {
      element.removeEventListener('input', handleChange);
      element.removeEventListener('focus', handleFocus);
      element.removeEventListener('blur', handleBlur);
      container.removeChild(element);
      changeListeners.length = 0;
      focusListeners.length = 0;
      blurListeners.length = 0;
    },
  };

  return editor;
}

export type { FormulaEditor, FormulaEditorOptions };
