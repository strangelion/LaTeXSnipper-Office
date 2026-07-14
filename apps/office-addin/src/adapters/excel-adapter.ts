import type { OfficeFormulaHostAdapter, OfficeHostCapabilities, FormulaOperationResult } from "./office-host-adapter";
import type { OfficeFormulaPayload, SelectedOfficeFormula } from "../model/formula-payload";
import { decodeFormulaMetadata, encodeFormulaMetadata, validateFormulaPayload } from "../model/formula-payload";
import { OfficeBridgeClient } from "./bridge-client";
import { isRequirementSetSupported } from "./host-detection";

declare const Excel: any;

export class ExcelFormulaAdapter implements OfficeFormulaHostAdapter {
  constructor(private readonly bridge = new OfficeBridgeClient()) {}

  async insertFormula(input: OfficeFormulaPayload): Promise<FormulaOperationResult<OfficeFormulaPayload>> {
    try {
      const payload = validateFormulaPayload(input);
      const rendered = await this.bridge.convert("latex", "png", payload.latex, payload.displayMode);
      const base64 = this.imageBase64(rendered.content);
      await Excel.run(async (context: any) => {
        const range = context.workbook.getSelectedRange();
        range.load("left,top,width,height");
        await context.sync();
        const shape = range.worksheet.shapes.addImage(base64);
        shape.name = `LSN_${payload.formulaId}`;
        shape.altTextTitle = "LaTeXSnipper Formula";
        shape.altTextDescription = encodeFormulaMetadata(payload);
        shape.left = range.left;
        shape.top = range.top;
        if (rendered.widthPt && rendered.heightPt) {
          shape.width = rendered.widthPt;
          shape.height = rendered.heightPt;
        }
        shape.lockAspectRatio = true;
        shape.placement = "OneCell";
        await context.sync();
      });
      return { ok: true, data: payload };
    } catch (error) {
      return this.failure("EXCEL_INSERT_FAILED", error);
    }
  }

  async getSelectedFormula(): Promise<FormulaOperationResult<SelectedOfficeFormula>> {
    try {
      return await Excel.run(async (context: any) => {
        const shapes = context.workbook.getSelectedShapes();
        shapes.load("items/name,items/altTextDescription");
        await context.sync();
        if (shapes.items.length !== 1) return { ok: false, code: "NO_FORMULA_SELECTED", error: "Select one LaTeXSnipper formula image." };
        const payload = decodeFormulaMetadata(String(shapes.items[0].altTextDescription ?? ""));
        return { ok: true, data: { ...payload, source: "metadata" as const } };
      });
    } catch (error) {
      return this.failure("EXCEL_READ_FAILED", error);
    }
  }

  async replaceSelectedFormula(input: OfficeFormulaPayload): Promise<FormulaOperationResult<OfficeFormulaPayload>> {
    const selected = await this.getSelectedFormula();
    if (!selected.ok || !selected.data) return selected;
    try {
      const payload = validateFormulaPayload({ ...input, formulaId: selected.data.formulaId, schemaVersion: 1 });
      const rendered = await this.bridge.convert("latex", "png", payload.latex, payload.displayMode);
      await Excel.run(async (context: any) => {
        const shapes = context.workbook.getSelectedShapes();
        shapes.load("items/left,items/top,items/width,items/height");
        await context.sync();
        if (shapes.items.length !== 1) throw new Error("The formula selection changed before replacement.");
        const oldShape = shapes.items[0];
        const worksheet = context.workbook.worksheets.getActiveWorksheet();
        const replacement = worksheet.shapes.addImage(this.imageBase64(rendered.content));
        replacement.name = `LSN_${payload.formulaId}`;
        replacement.altTextTitle = "LaTeXSnipper Formula";
        replacement.altTextDescription = encodeFormulaMetadata(payload);
        replacement.left = oldShape.left;
        replacement.top = oldShape.top;
        replacement.width = oldShape.width;
        replacement.height = oldShape.height;
        replacement.lockAspectRatio = true;
        replacement.placement = "OneCell";
        oldShape.delete();
        await context.sync();
      });
      return { ok: true, data: payload };
    } catch (error) {
      return this.failure("EXCEL_REPLACE_FAILED", error);
    }
  }

  async deleteSelectedFormula(): Promise<FormulaOperationResult> {
    try {
      return await Excel.run(async (context: any) => {
        const shapes = context.workbook.getSelectedShapes();
        shapes.load("items/altTextDescription");
        await context.sync();
        if (shapes.items.length !== 1) return { ok: false, code: "NO_FORMULA_SELECTED", error: "Select one LaTeXSnipper formula image." };
        decodeFormulaMetadata(String(shapes.items[0].altTextDescription ?? ""));
        shapes.items[0].delete();
        await context.sync();
        return { ok: true };
      });
    } catch (error) {
      return this.failure("EXCEL_DELETE_FAILED", error);
    }
  }

  async insertEquationReference(): Promise<FormulaOperationResult> {
    return { ok: false, code: "REFERENCE_UNSUPPORTED", error: "Equation references are supported only in Word." };
  }

  async getCapabilities(): Promise<OfficeHostCapabilities> {
    const supported = isRequirementSetSupported("ExcelApi", "1.9") && typeof Excel?.run === "function";
    return {
      host: "excel", insertFormula: supported, readFormula: supported, replaceFormula: supported, deleteFormula: supported,
      numberedFormula: false, tableSupport: false, svgInsertion: false, pngInsertion: supported, persistentMetadata: supported,
      equationReference: false, diagnostic: supported ? undefined : "ExcelApi 1.9 shape support is required.",
    };
  }

  private imageBase64(content: string): string {
    const value = content.replace(/^data:image\/png;base64,/, "");
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(value)) throw new Error("Bridge returned invalid PNG data");
    return value;
  }

  private failure(code: string, error: unknown): FormulaOperationResult<never> {
    return { ok: false, code, error: error instanceof Error ? error.message : String(error) };
  }
}
