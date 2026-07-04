/** Unified document fragment for transfer between OOXML and Editor */

export interface DocumentFragment {
  version: number;
  blocks: Block[];
  source?: SourceMetadata;
}

export type Block =
  | { type: 'paragraph'; content: Paragraph }
  | { type: 'equation'; math: MathIR; display: boolean; numbered: boolean }
  | { type: 'table'; table: TableIR }
  | { type: 'image'; src: string; alt: string };

export interface Paragraph {
  inlines: Inline[];
  properties?: ParagraphProperties;
}

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'formula'; formula: MathIR }
  | { type: 'image'; alt: string };

export interface MathIR {
  type: 'latex' | 'omml' | 'mathml';
  content: string;
}

export interface ParagraphProperties {
  alignment?: 'left' | 'center' | 'right';
}

export interface SourceMetadata {
  origin?: string;
  timestamp?: string;
}

/** Equation block */
export interface EquationBlock {
  math: MathIR;
  display: boolean;
  numbered: boolean;
}

/** Table IR — maps to Core's TableBlock */
export interface TableIR {
  rows: TableRow[];
  properties?: TableProperties;
}

export interface TableRow {
  cells: TableCell[];
  height?: number;
}

export interface TableCell {
  inlines: Inline[];
  colspan: number;
  rowspan: number;
  properties?: CellProperties;
}

export interface CellProperties {
  background?: string;
  borderStyle?: string;
  borderWidth?: number;
  borderColor?: string;
  alignment?: 'left' | 'center' | 'right';
  verticalAlignment?: 'top' | 'middle' | 'bottom';
  width?: number;
}

export interface TableProperties {
  width?: number;
  layout?: 'fixed' | 'autofit';
}

/** Insert Formula Request */
export interface InsertFormulaRequest {
  fragment: DocumentFragment;
  mode: 'inline' | 'display' | 'display-numbered';
}

export interface ReplaceFormulaRequest {
  formula: EquationBlock;
}

/** Host capabilities */
export interface HostCapabilities {
  host: 'word' | 'excel' | 'powerpoint';
  platform: 'windows' | 'mac' | 'web';
  version: string;
}

/** Office Document Adapter Interface */
export interface OfficeDocumentAdapter {
  getSelection(): Promise<DocumentFragment>;
  getSelectedFormula(): Promise<EquationBlock | null>;
  getSelectedTable(): Promise<TableIR | null>;
  insertFormula(request: InsertFormulaRequest): Promise<void>;
  replaceSelectedFormula(request: ReplaceFormulaRequest): Promise<void>;
  deleteCurrentBlock(): Promise<void>;
  getHostCapabilities(): Promise<HostCapabilities>;
}
