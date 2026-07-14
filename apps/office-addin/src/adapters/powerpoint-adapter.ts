import type { OfficeFormulaHostAdapter, OfficeHostCapabilities, FormulaOperationResult } from "./office-host-adapter";
import type { OfficeFormulaPayload, SelectedOfficeFormula } from "../model/formula-payload";
import { decodeFormulaMetadata, encodeFormulaMetadata, validateFormulaPayload } from "../model/formula-payload";
import { OfficeBridgeClient } from "./bridge-client";
import { isRequirementSetSupported } from "./host-detection";

declare const PowerPoint: any;

export class PowerPointFormulaAdapter implements OfficeFormulaHostAdapter {
  constructor(private readonly bridge = new OfficeBridgeClient()) {}

  async insertFormula(input: OfficeFormulaPayload): Promise<FormulaOperationResult<OfficeFormulaPayload>> {
    try {
      const payload = validateFormulaPayload(input);
      const rendered = await this.bridge.convert("latex", "png", payload.latex, payload.displayMode);
      await PowerPoint.run(async (context: any) => {
        const slides = context.presentation.getSelectedSlides();
        slides.load("items/id");
        await context.sync();
        if (slides.items.length !== 1) throw new Error("Select one slide before inserting a formula.");
        const slide = slides.items[0];
        const shape = slide.shapes.addImage(this.imageBase64(rendered.content));
        shape.name = `LSN_${payload.formulaId}`;
        shape.altTextTitle = "LaTeXSnipper Formula";
        shape.altTextDescription = encodeFormulaMetadata(payload);
        const width = Math.min(rendered.widthPt ?? 240, 600);
        const height = Math.min(rendered.heightPt ?? 72, 400);
        shape.width = width;
        shape.height = height;
        // PowerPointApi does not expose the active slide size consistently.
        // Use a stable inset instead of assuming a 10 x 7.5 inch slide.
        shape.left = 36;
        shape.top = 36;
        shape.lockAspectRatio = true;
        await context.sync();
      });
      return { ok: true, data: payload };
    } catch (error) {
      return this.failure("POWERPOINT_INSERT_FAILED", error);
    }
  }

  async getSelectedFormula(): Promise<FormulaOperationResult<SelectedOfficeFormula>> {
    try {
      return await PowerPoint.run(async (context: any) => {
        const shapes = context.presentation.getSelectedShapes();
        shapes.load("items/name,items/altTextDescription");
        await context.sync();
        if (shapes.items.length !== 1) return { ok: false, code: "NO_FORMULA_SELECTED", error: "Select one LaTeXSnipper formula shape." };
        const payload = decodeFormulaMetadata(String(shapes.items[0].altTextDescription ?? ""));
        return { ok: true, data: { ...payload, source: "metadata" as const } };
      });
    } catch (error) {
      return this.failure("POWERPOINT_READ_FAILED", error);
    }
  }

  async replaceSelectedFormula(input: OfficeFormulaPayload): Promise<FormulaOperationResult<OfficeFormulaPayload>> {
    const selected = await this.getSelectedFormula();
    if (!selected.ok || !selected.data) return selected;
    try {
      const payload = validateFormulaPayload({ ...input, formulaId: selected.data.formulaId, schemaVersion: 1 });
      const rendered = await this.bridge.convert("latex", "png", payload.latex, payload.displayMode);
      await PowerPoint.run(async (context: any) => {
        const shapes = context.presentation.getSelectedShapes();
        shapes.load("items/left,items/top,items/width,items/height");
        const slides = context.presentation.getSelectedSlides();
        slides.load("items/id");
        await context.sync();
        if (shapes.items.length !== 1 || slides.items.length !== 1) throw new Error("The formula selection changed before replacement.");
        const oldShape = shapes.items[0];
        const replacement = slides.items[0].shapes.addImage(this.imageBase64(rendered.content));
        replacement.name = `LSN_${payload.formulaId}`;
        replacement.altTextTitle = "LaTeXSnipper Formula";
        replacement.altTextDescription = encodeFormulaMetadata(payload);
        replacement.left = oldShape.left;
        replacement.top = oldShape.top;
        replacement.width = oldShape.width;
        replacement.height = oldShape.height;
        replacement.lockAspectRatio = true;
        oldShape.delete();
        await context.sync();
      });
      return { ok: true, data: payload };
    } catch (error) {
      return this.failure("POWERPOINT_REPLACE_FAILED", error);
    }
  }

  async deleteSelectedFormula(): Promise<FormulaOperationResult> {
    try {
      return await PowerPoint.run(async (context: any) => {
        const shapes = context.presentation.getSelectedShapes();
        shapes.load("items/altTextDescription");
        await context.sync();
        if (shapes.items.length !== 1) return { ok: false, code: "NO_FORMULA_SELECTED", error: "Select one LaTeXSnipper formula shape." };
        decodeFormulaMetadata(String(shapes.items[0].altTextDescription ?? ""));
        shapes.items[0].delete();
        await context.sync();
        return { ok: true };
      });
    } catch (error) {
      return this.failure("POWERPOINT_DELETE_FAILED", error);
    }
  }

  async insertEquationReference(): Promise<FormulaOperationResult> {
    return { ok: false, code: "REFERENCE_UNSUPPORTED", error: "Equation references are supported only in Word." };
  }

  async getCapabilities(): Promise<OfficeHostCapabilities> {
    const supported = isRequirementSetSupported("PowerPointApi", "1.5") && typeof PowerPoint?.run === "function";
    return {
      host: "powerpoint", insertFormula: supported, readFormula: supported, replaceFormula: supported, deleteFormula: supported,
      numberedFormula: false, tableSupport: false, svgInsertion: false, pngInsertion: supported, persistentMetadata: supported,
      equationReference: false, diagnostic: supported ? undefined : "PowerPointApi 1.5 shape support is required.",
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
