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

const POWERPOINT_METADATA_API = "1.10";

interface PreviewPictureAddOptions {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

interface PreviewShapeCollection {
  addPicture(
    base64EncodedImage: string,
    options?: PreviewPictureAddOptions,
  ): PowerPoint.Shape;
}

export class PowerPointFormulaAdapter implements OfficeFormulaHostAdapter {
  constructor(private readonly bridge = new OfficeBridgeClient()) {}

  async insertFormula(
    input: OfficeFormulaPayload,
  ): Promise<FormulaOperationResult<OfficeFormulaPayload>> {
    const previewAvailable = await this.supportsPreviewPictures();
    if (!previewAvailable) return this.previewUnsupported();
    try {
      const payload = validateFormulaPayload(input);
      const rendered = await this.bridge.convert(
        "latex",
        "png",
        payload.latex,
        payload.displayMode,
      );
      await PowerPoint.run(async (context: PowerPoint.RequestContext) => {
        const slides = context.presentation.getSelectedSlides();
        slides.load("items/id");
        await context.sync();
        if (slides.items.length !== 1)
          throw new Error("Select one slide before inserting a formula.");
        const dimensions = this.fitDimensions(
          rendered.widthPt ?? 240,
          rendered.heightPt ?? 72,
          600,
          400,
        );
        const shape = this.previewCollection(slides.items[0].shapes).addPicture(
          this.imageBase64(rendered.content),
          { left: 36, top: 36, ...dimensions },
        );
        shape.name = `LSN_${payload.formulaId}`;
        shape.altTextTitle = "LaTeXSnipper Formula";
        shape.altTextDescription = encodeFormulaMetadata(payload);
        await context.sync();
      });
      return { ok: true, data: payload };
    } catch (error) {
      return this.failure("POWERPOINT_INSERT_FAILED", error);
    }
  }

  async getSelectedFormula(): Promise<
    FormulaOperationResult<SelectedOfficeFormula>
  > {
    if (!this.supportsMetadataLifecycle()) return this.metadataUnsupported();
    try {
      return await PowerPoint.run(
        async (context: PowerPoint.RequestContext) => {
          const shapes = context.presentation.getSelectedShapes();
          shapes.load("items/name,items/altTextDescription");
          await context.sync();
          if (shapes.items.length !== 1)
            return {
              ok: false,
              code: "NO_FORMULA_SELECTED",
              error: "Select one LaTeXSnipper formula shape.",
            };
          const payload = decodeFormulaMetadata(
            String(shapes.items[0].altTextDescription ?? ""),
          );
          return {
            ok: true,
            data: { ...payload, source: "metadata" as const },
          };
        },
      );
    } catch (error) {
      return this.failure("POWERPOINT_READ_FAILED", error);
    }
  }

  async replaceSelectedFormula(
    input: OfficeFormulaPayload,
  ): Promise<FormulaOperationResult<OfficeFormulaPayload>> {
    if (!(await this.supportsPreviewPictures()))
      return this.previewUnsupported();
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
      await PowerPoint.run(async (context: PowerPoint.RequestContext) => {
        const shapes = context.presentation.getSelectedShapes();
        shapes.load("items/left,items/top,items/width,items/height");
        const slides = context.presentation.getSelectedSlides();
        slides.load("items/id");
        await context.sync();
        if (shapes.items.length !== 1 || slides.items.length !== 1)
          throw new Error("The formula selection changed before replacement.");
        const oldShape = shapes.items[0];
        const replacement = this.previewCollection(
          slides.items[0].shapes,
        ).addPicture(this.imageBase64(rendered.content), {
          left: oldShape.left,
          top: oldShape.top,
          width: oldShape.width,
          height: oldShape.height,
        });
        replacement.name = `LSN_${payload.formulaId}`;
        replacement.altTextTitle = "LaTeXSnipper Formula";
        replacement.altTextDescription = encodeFormulaMetadata(payload);
        replacement.load("name,altTextDescription,left,top,width,height");
        await context.sync();
        if (
          replacement.name !== `LSN_${payload.formulaId}` ||
          String(replacement.altTextDescription ?? "") !==
            encodeFormulaMetadata(payload)
        ) {
          replacement.delete();
          await context.sync();
          throw new Error("Candidate formula metadata readback failed.");
        }
        try {
          oldShape.delete();
          await context.sync();
        } catch (deleteError) {
          replacement.delete();
          await context.sync();
          throw deleteError;
        }
      });
      return { ok: true, data: payload };
    } catch (error) {
      return this.failure("POWERPOINT_REPLACE_FAILED", error);
    }
  }

  async deleteSelectedFormula(): Promise<FormulaOperationResult> {
    if (!this.supportsMetadataLifecycle()) return this.metadataUnsupported();
    try {
      return await PowerPoint.run(
        async (context: PowerPoint.RequestContext) => {
          const shapes = context.presentation.getSelectedShapes();
          shapes.load("items/altTextDescription");
          await context.sync();
          if (shapes.items.length !== 1)
            return {
              ok: false,
              code: "NO_FORMULA_SELECTED",
              error: "Select one LaTeXSnipper formula shape.",
            };
          decodeFormulaMetadata(
            String(shapes.items[0].altTextDescription ?? ""),
          );
          shapes.items[0].delete();
          await context.sync();
          return { ok: true };
        },
      );
    } catch (error) {
      return this.failure("POWERPOINT_DELETE_FAILED", error);
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
    const metadata = this.supportsMetadataLifecycle();
    const pictures = metadata && (await this.supportsPreviewPictures());
    return {
      host: "powerpoint",
      insertFormula: pictures,
      readFormula: metadata,
      replaceFormula: pictures,
      deleteFormula: metadata,
      numberedFormula: false,
      tableSupport: false,
      svgInsertion: false,
      pngInsertion: pictures,
      persistentMetadata: metadata,
      equationReference: false,
      diagnostic: pictures
        ? undefined
        : metadata
          ? "PowerPoint picture insertion requires the Preview/Beta addPicture API."
          : `PowerPointApi ${POWERPOINT_METADATA_API} is required for formula metadata operations.`,
    };
  }

  private supportsMetadataLifecycle(): boolean {
    return (
      isRequirementSetSupported("PowerPointApi", POWERPOINT_METADATA_API) &&
      typeof PowerPoint !== "undefined" &&
      typeof PowerPoint.run === "function"
    );
  }

  private async supportsPreviewPictures(): Promise<boolean> {
    if (!this.supportsMetadataLifecycle()) return false;
    try {
      return await PowerPoint.run(
        async (context: PowerPoint.RequestContext) => {
          const shapes = context.presentation.slides.getItemAt(0).shapes;
          return (
            typeof (shapes as unknown as Partial<PreviewShapeCollection>)
              .addPicture === "function"
          );
        },
      );
    } catch (error) {
      console.warn(
        "PowerPoint Preview picture capability check failed",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private previewCollection(
    shapes: PowerPoint.ShapeCollection,
  ): PreviewShapeCollection {
    const preview = shapes as unknown as Partial<PreviewShapeCollection>;
    if (typeof preview.addPicture !== "function")
      throw new Error("PowerPoint Preview addPicture API is unavailable.");
    return preview as PreviewShapeCollection;
  }

  private fitDimensions(
    width: number,
    height: number,
    maxWidth: number,
    maxHeight: number,
  ): { width: number; height: number } {
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 240;
    const safeHeight = Number.isFinite(height) && height > 0 ? height : 72;
    const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
    return { width: safeWidth * scale, height: safeHeight * scale };
  }

  private imageBase64(content: string): string {
    const value = content.replace(/^data:image\/png;base64,/, "");
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(value))
      throw new Error("Bridge returned invalid PNG data");
    return value;
  }

  private previewUnsupported(): FormulaOperationResult<never> {
    return {
      ok: false,
      code: "POWERPOINT_PREVIEW_API_REQUIRED",
      error:
        "PowerPoint formula pictures require the Preview/Beta addPicture API.",
    };
  }

  private metadataUnsupported(): FormulaOperationResult<never> {
    return {
      ok: false,
      code: "POWERPOINT_METADATA_API_UNSUPPORTED",
      error: `PowerPointApi ${POWERPOINT_METADATA_API} is required for formula metadata operations.`,
    };
  }

  private failure(code: string, error: unknown): FormulaOperationResult<never> {
    return {
      ok: false,
      code,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
