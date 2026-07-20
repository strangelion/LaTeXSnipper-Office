import type {
  OfficeFormulaPayload,
  SelectedOfficeFormula,
} from "../model/formula-payload";

export interface OfficeHostCapabilities {
  host: "word" | "excel" | "powerpoint" | "unknown";
  insertFormula: boolean;
  readFormula: boolean;
  replaceFormula: boolean;
  deleteFormula: boolean;
  numberedFormula: boolean;
  tableSupport: boolean;
  svgInsertion: boolean;
  pngInsertion: boolean;
  persistentMetadata: boolean;
  equationReference: boolean;
  diagnostic?: string;
}

export interface FormulaOperationResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface OfficeFormulaHostAdapter {
  insertFormula(
    payload: OfficeFormulaPayload,
  ): Promise<FormulaOperationResult<OfficeFormulaPayload>>;
  getSelectedFormula(): Promise<FormulaOperationResult<SelectedOfficeFormula>>;
  replaceSelectedFormula(
    payload: OfficeFormulaPayload,
  ): Promise<FormulaOperationResult<OfficeFormulaPayload>>;
  deleteSelectedFormula(): Promise<FormulaOperationResult>;
  insertEquationReference(formulaId: string): Promise<FormulaOperationResult>;
  getCapabilities(): Promise<OfficeHostCapabilities>;
}
