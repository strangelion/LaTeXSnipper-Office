import type { OfficeFormulaHostAdapter, OfficeHostCapabilities, FormulaOperationResult } from "./office-host-adapter";
import type { OfficeFormulaPayload, SelectedOfficeFormula } from "../model/formula-payload";
import { formulaIdFromTag, validateFormulaPayload } from "../model/formula-payload";
import { bookmarkNameForFormula } from "../model/formula-payload";
import { getEquationLayoutProfile } from "../model/equation-layout";
import { OfficeBridgeClient } from "./bridge-client";
import { WordOoxmlHelper } from "./word-ooxml";

declare const Word: any;
declare const Office: any;

export class WordFormulaAdapter implements OfficeFormulaHostAdapter {
  constructor(
    private readonly bridge = new OfficeBridgeClient(),
    private readonly ooxml = new WordOoxmlHelper(),
  ) {}

  async insertFormula(input: OfficeFormulaPayload): Promise<FormulaOperationResult<OfficeFormulaPayload>> {
    try {
      const payload = validateFormulaPayload(input);
      const converted = await this.bridge.convert("latex", "omml", payload.latex, payload.displayMode);
      const packageXml = this.ooxml.buildFormulaOoxml(payload, converted.content, getEquationLayoutProfile(payload.layoutProfileId));
      await Word.run(async (context: any) => {
        const selection = context.document.getSelection();
        selection.insertOoxml(packageXml, "Replace");
        await context.sync();
      });
      return { ok: true, data: payload };
    } catch (error) {
      return this.failure("WORD_INSERT_FAILED", error);
    }
  }

  async getSelectedFormula(): Promise<FormulaOperationResult<SelectedOfficeFormula>> {
    try {
      const snapshot = await Word.run(async (context: any) => {
        const selected = await this.getSelectedControl(context);
        if (!selected) return null;
        const { control, tag } = selected;
        const ooxmlResult = control.getOoxml();
        await context.sync();
        return { tag, xml: String(ooxmlResult.value ?? "") };
      });
      if (!snapshot) return { ok: false, code: "NO_FORMULA_SELECTED", error: "Select or place the cursor inside a LaTeXSnipper formula." };
      const formulaId = formulaIdFromTag(snapshot.tag) ?? this.ooxml.extractFormulaId(snapshot.xml);
      if (!formulaId) return { ok: false, code: "FORMULA_METADATA_UNREADABLE", error: "The selected formula identifier is missing." };
      const inlineMetadata = this.ooxml.extractPayload(snapshot.xml);
      const metadata = inlineMetadata ?? await this.readMetadataPart(formulaId);
      if (metadata) return { ok: true, data: { ...metadata, source: "metadata" as const } };
      const omml = this.ooxml.extractOmml(snapshot.xml);
      if (omml) {
        const converted = await this.bridge.convert("omml", "latex", omml, snapshot.xml.includes("<m:oMathPara") ? "block" : "inline");
        return { ok: true, data: { schemaVersion: 1, formulaId, latex: converted.content,
          displayMode: snapshot.xml.includes("LaTeXSnipperEquation") ? "numbered" : snapshot.xml.includes("<m:oMathPara") ? "block" : "inline", source: "omml" as const } };
      }
      const text = this.ooxml.extractText(snapshot.xml).trim();
      if (text) return { ok: true, data: { schemaVersion: 1, formulaId, latex: text, displayMode: "inline", source: "text" as const } };
      return { ok: false, code: "FORMULA_METADATA_UNREADABLE", error: "The selected formula metadata is missing or invalid." };
    } catch (error) {
      return this.failure("WORD_READ_FAILED", error);
    }
  }

  async replaceSelectedFormula(input: OfficeFormulaPayload): Promise<FormulaOperationResult<OfficeFormulaPayload>> {
    const selected = await this.getSelectedFormula();
    if (!selected.ok || !selected.data) return selected;
    try {
      const payload = validateFormulaPayload({ ...input, formulaId: selected.data.formulaId, schemaVersion: 1 });
      const converted = await this.bridge.convert("latex", "omml", payload.latex, payload.displayMode);
      const packageXml = this.ooxml.buildFormulaOoxml(payload, converted.content, getEquationLayoutProfile(payload.layoutProfileId));
      await this.deleteMetadataPart(payload.formulaId);
      await Word.run(async (context: any) => {
        const selectedControl = await this.getSelectedControl(context);
        if (!selectedControl) throw new Error("The formula selection changed before replacement.");
        selectedControl.control.getRange().insertOoxml(packageXml, "Replace");
        await context.sync();
      });
      return { ok: true, data: payload };
    } catch (error) {
      return this.failure("WORD_REPLACE_FAILED", error);
    }
  }

  async deleteSelectedFormula(): Promise<FormulaOperationResult> {
    try {
      const formulaId = await Word.run(async (context: any) => {
        const selected = await this.getSelectedControl(context);
        if (!selected) return null;
        selected.control.delete(false);
        await context.sync();
        return formulaIdFromTag(selected.tag);
      });
      if (!formulaId) return { ok: false, code: "NO_FORMULA_SELECTED", error: "Select a LaTeXSnipper formula to delete." };
      await this.deleteMetadataPart(formulaId);
      return { ok: true };
    } catch (error) {
      return this.failure("WORD_DELETE_FAILED", error);
    }
  }

  async insertEquationReference(formulaId: string): Promise<FormulaOperationResult> {
    try {
      const bookmark = bookmarkNameForFormula(formulaId);
      await Word.run(async (context: any) => {
        const selection = context.document.getSelection();
        selection.insertField("Replace", "REF", `${bookmark} \\h`, true);
        await context.sync();
      });
      return { ok: true, data: { formulaId, bookmark } };
    } catch (error) {
      return this.failure("WORD_REFERENCE_FAILED", error);
    }
  }

  async getCapabilities(): Promise<OfficeHostCapabilities> {
    return {
      host: "word",
      insertFormula: true,
      readFormula: true,
      replaceFormula: true,
      deleteFormula: true,
      numberedFormula: true,
      tableSupport: false,
      svgInsertion: false,
      pngInsertion: false,
      persistentMetadata: true,
      equationReference: true,
      diagnostic: "Formula insertion inside existing table cells is supported; arbitrary table extraction is not.",
    };
  }

  private async readMetadataPart(formulaId: string): Promise<OfficeFormulaPayload | null> {
    const parts = await this.getMetadataParts();
    for (const part of parts) {
      const xml = await new Promise<string>((resolve) => part.getXmlAsync((result: any) =>
        resolve(result.status === "succeeded" ? String(result.value ?? "") : "")));
      if (!xml.includes(`formulaId="${formulaId}"`)) continue;
      const payload = this.ooxml.extractPayload(xml);
      if (payload?.formulaId === formulaId) return payload;
    }
    return null;
  }

  private async deleteMetadataPart(formulaId: string): Promise<void> {
    const parts = await this.getMetadataParts();
    for (const part of parts) {
      const xml = await new Promise<string>((resolve) => part.getXmlAsync((result: any) =>
        resolve(result.status === "succeeded" ? String(result.value ?? "") : "")));
      if (!xml.includes(`formulaId="${formulaId}"`)) continue;
      await new Promise<void>((resolve, reject) => part.deleteAsync((result: any) =>
        result.status === "succeeded" ? resolve() : reject(new Error(result.error?.message ?? "Unable to delete formula metadata"))));
    }
  }

  private getMetadataParts(): Promise<any[]> {
    const customXmlParts = Office.context?.document?.customXmlParts;
    if (!customXmlParts?.getByNamespaceAsync) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      customXmlParts.getByNamespaceAsync(
        "https://latexsnipper.com/office/formula/1",
        (result: any) => result.status === "succeeded"
          ? resolve(Array.isArray(result.value) ? result.value : [])
          : reject(new Error(result.error?.message ?? "Unable to read formula metadata")),
      );
    });
  }

  private async getSelectedControl(context: any): Promise<{ control: any; tag: string } | null> {
    const selection = context.document.getSelection();
    const parent = selection.parentContentControlOrNullObject;
    parent.load("tag,title,isNullObject");
    await context.sync();
    if (!parent.isNullObject && formulaIdFromTag(String(parent.tag ?? ""))) {
      return { control: parent, tag: String(parent.tag) };
    }
    const controls = selection.contentControls;
    controls.load("items/tag,items/title");
    await context.sync();
    const control = controls.items?.find((item: any) => formulaIdFromTag(String(item.tag ?? "")) !== null);
    return control ? { control, tag: String(control.tag) } : null;
  }

  private failure(code: string, error: unknown): FormulaOperationResult<never> {
    return { ok: false, code, error: error instanceof Error ? error.message : String(error) };
  }
}
