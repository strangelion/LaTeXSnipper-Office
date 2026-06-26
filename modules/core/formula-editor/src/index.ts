/**
 * @latexsnipper/formula-editor
 * 
 * MathLive-based formula editor for LaTeXSnipper Office
 * 
 * @example
 * ```typescript
 * import { createFormulaEditor } from '@latexsnipper/formula-editor';
 * 
 * const container = document.getElementById('editor');
 * const editor = createFormulaEditor({
 *   container,
 *   value: 'E = mc^2',
 *   displayMode: true,
 *   onChange: (value) => {
 *     console.log('Formula changed:', value);
 *   },
 * });
 * 
 * // Get current value
 * const latex = editor.getValue();
 * 
 * // Set new value
 * editor.setValue('x^2 + y^2 = z^2');
 * 
 * // Destroy editor
 * editor.destroy();
 * ```
 */

export { createFormulaEditor } from './editor';
export type { FormulaEditor, FormulaEditorOptions, FormulaEditorEvents } from './types';
