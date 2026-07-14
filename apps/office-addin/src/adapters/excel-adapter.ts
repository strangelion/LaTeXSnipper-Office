import type {
  OfficeFormulaHostAdapter,
  OfficeHostCapabilities,
  FormulaOperationResult,
} from "./office-host-adapter";
import type {
  OfficeFormulaPayload,
  SelectedOfficeFormula,
} from "../model/formula-payload";
import {
  decodeFormulaMetadata,
  encodeFormulaMetadata,
  validateFormulaPayload,
} from "../model/formula-payload";
import { OfficeBridgeClient } from "./bridge-client";
import { isRequirementSetSupported } from "./host-detection";

const EXCEL_INSERT_API = "1.10";
const EXCEL_LIFECYCLE_API = "1.19";

export class ExcelFormulaAdapter implements OfficeFormulaHostAdapter {
  constructor(private readonly bridge = new OfficeBridgeClient()) {}

  async insertFormula(
    input: OfficeFormulaPayload,
  ): Promise<FormulaOperationResult<OfficeFormulaPayload>> {
    if (!this.supportsInsert()) {
      return this.unsupported(
        "EXCEL_INSERT_API_UNSUPPORTED",
        `ExcelApi ${EXCEL_INSERT_API} is required to insert formula images.`,
      );
    }
    try {
      const payload = validateFormulaPayload(input);
      const rendered = await this.bridge.convert(
        "latex",
        "png",
        payload.latex,
        payload.displayMode,
      );
      const base64 = this.imageBase64(rendered.content);
      await Excel.run(async (context: Excel.RequestContext) => {
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

  async getSelectedFormula(): Promise<
    FormulaOperationResult<SelectedOfficeFormula>
  > {
    if (!this.supportsLifecycle()) {
      return this.unsupported(
        "EXCEL_LIFECYCLE_API_UNSUPPORTED",
        `ExcelApi ${EXCEL_LIFECYCLE_API} is required to read selected formula shapes.`,
      );
    }
    try {
      return await Excel.run(async (context: Excel.RequestContext) => {
        const shape = context.workbook.getActiveShapeOrNullObject();
        shape.load(
          "isNullObject,name,altTextDescription,left,top,width,height",
        );
        await context.sync();
        if (shape.isNullObject) {
          return {
            ok: false,
            code: "NO_FORMULA_SELECTED",
            error: "Select one LaTeXSnipper formula image.",
          };
        }
        const payload = decodeFormulaMetadata(
          String(shape.altTextDescription ?? ""),
        );
        return { ok: true, data: { ...payload, source: "metadata" as const } };
      });
    } catch (error) {
      return this.failure("EXCEL_READ_FAILED", error);
    }
  }

  async replaceSelectedFormula(
    input: OfficeFormulaPayload,
  ): Promise<FormulaOperationResult<OfficeFormulaPayload>> {
    const selected = await this.getSelectedFormula();
    if (!selected.ok || !selected.data) return selected;
    try {
      const payload = validateFormulaPayload({
        ...input,
        formulaId: selected.data.formulaId,
        schemaVersion: 1,
      });
      const rendered = await this.bridge.convert(
        "latex",
        "png",
        payload.latex,
        payload.displayMode,
      );
      await Excel.run(async (context: Excel.RequestContext) => {
        const oldShape = context.workbook.getActiveShapeOrNullObject();
        oldShape.load("isNullObject,left,top,width,height");
        await context.sync();
        if (oldShape.isNullObject)
          throw new Error("The formula selection changed before replacement.");
        const worksheet = context.workbook.worksheets.getActiveWorksheet();
        const replacement = worksheet.shapes.addImage(
          this.imageBase64(rendered.content),
        );
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
    if (!this.supportsLifecycle()) {
      return this.unsupported(
        "EXCEL_LIFECYCLE_API_UNSUPPORTED",
        `ExcelApi ${EXCEL_LIFECYCLE_API} is required to delete selected formula shapes.`,
      );
    }
    try {
      return await Excel.run(async (context: Excel.RequestContext) => {
        const shape = context.workbook.getActiveShapeOrNullObject();
        shape.load("isNullObject,altTextDescription");
        await context.sync();
        if (shape.isNullObject) {
          return {
            ok: false,
            code: "NO_FORMULA_SELECTED",
            error: "Select one LaTeXSnipper formula image.",
          };
        }
        decodeFormulaMetadata(String(shape.altTextDescription ?? ""));
        shape.delete();
        await context.sync();
        return { ok: true };
      });
    } catch (error) {
      return this.failure("EXCEL_DELETE_FAILED", error);
    }
  }

  async insertEquationReference(): Promise<FormulaOperationResult> {
    return {
      ok: false,
      code: "REFERENCE_UNSUPPORTED",
      error: "Equation references are supported only in Word.",
    };
  }

  async getCapabilities(): Promise<OfficeHostCapabilities> {
    const insert = this.supportsInsert();
    const lifecycle = this.supportsLifecycle();
    const diagnostic = !insert
      ? `ExcelApi ${EXCEL_INSERT_API} is required for PNG formula insertion.`
      : !lifecycle
        ? `ExcelApi ${EXCEL_LIFECYCLE_API} is required for formula read, replace, and delete.`
        : undefined;
    return {
      host: "excel",
      insertFormula: insert,
      readFormula: lifecycle,
      replaceFormula: lifecycle,
      deleteFormula: lifecycle,
      numberedFormula: false,
      tableSupport: false,
      svgInsertion: false,
      pngInsertion: insert,
      persistentMetadata: insert,
      equationReference: false,
      diagnostic,
    };
  }

  private supportsInsert(): boolean {
    return (
      isRequirementSetSupported("ExcelApi", EXCEL_INSERT_API) &&
      typeof Excel !== "undefined" &&
      typeof Excel.run === "function"
    );
  }

  private supportsLifecycle(): boolean {
    return (
      isRequirementSetSupported("ExcelApi", EXCEL_LIFECYCLE_API) &&
      typeof Excel !== "undefined" &&
      typeof Excel.run === "function"
    );
  }

  private imageBase64(content: string): string {
    const value = content.replace(/^data:image\/png;base64,/, "");
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(value))
      throw new Error("Bridge returned invalid PNG data");
    return value;
  }

  private unsupported(
    code: string,
    error: string,
  ): FormulaOperationResult<never> {
    return { ok: false, code, error };
  }

  private failure(code: string, error: unknown): FormulaOperationResult<never> {
    return {
      ok: false,
      code,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
