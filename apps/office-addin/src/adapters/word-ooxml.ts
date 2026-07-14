import {
  bookmarkNameForFormula,
  decodeFormulaMetadata,
  encodeFormulaMetadata,
  formulaTag,
  type OfficeFormulaPayload,
} from "../model/formula-payload";
import {
  DEFAULT_EQUATION_LAYOUT_PROFILE,
  type EquationLayoutProfile,
} from "../model/equation-layout";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const LSN_NS = "https://latexsnipper.com/office/formula/1";

export class WordOoxmlHelper {
  buildFormulaOoxml(
    payload: OfficeFormulaPayload,
    omml: string,
    profile: EquationLayoutProfile = DEFAULT_EQUATION_LAYOUT_PROFILE,
  ): string {
    const math = this.normalizeOmml(omml, payload.displayMode !== "inline");
    if (payload.displayMode === "numbered") {
      return this.wrapInFlatOpc(this.buildNumberedBody(payload, math, profile), payload);
    }
    if (payload.displayMode === "inline") {
      const inlineSdt = this.wrapInSdt(math, payload, "run");
      return this.wrapInFlatOpc(`<w:p>${inlineSdt}</w:p>`, payload);
    }
    const spacingBefore = Math.max(0, Math.round((profile.equationSpacingBeforePt ?? 0) * 20));
    const spacingAfter = Math.max(0, Math.round((profile.equationSpacingAfterPt ?? 0) * 20));
    const paragraph = `<w:p><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}"/><w:keepLines/><w:keepNext/></w:pPr>${math}</w:p>`;
    return this.wrapInFlatOpc(this.wrapInSdt(paragraph, payload, "block"), payload);
  }

  buildReplacementContent(
    payload: OfficeFormulaPayload,
    omml: string,
    profile: EquationLayoutProfile = DEFAULT_EQUATION_LAYOUT_PROFILE,
  ): string {
    const math = this.normalizeOmml(omml, payload.displayMode !== "inline");
    if (payload.displayMode === "numbered") return this.buildNumberedBody(payload, math, profile);
    if (payload.displayMode === "inline") return this.wrapInSdt(math, payload, "run");
    return this.wrapInSdt(`<w:p><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:keepLines/></w:pPr>${math}</w:p>`, payload, "block");
  }

  extractPayload(xml: string): OfficeFormulaPayload | null {
    const match = xml.match(/<lsn:payload>([A-Za-z0-9_:\-]+)<\/lsn:payload>/);
    if (!match) return null;
    try {
      return decodeFormulaMetadata(match[1]);
    } catch {
      return null;
    }
  }

  extractFormulaId(xml: string): string | null {
    const match = xml.match(/<w:tag\s+w:val="latexsnipper:formula:([^"<>]+)"\s*\/>/);
    return match?.[1] ?? null;
  }

  extractOmml(xml: string): string | null {
    const para = xml.match(/<m:oMathPara\b[\s\S]*?<\/m:oMathPara>/);
    if (para) return para[0];
    const inline = xml.match(/<m:oMath\b[\s\S]*?<\/m:oMath>/);
    return inline?.[0] ?? null;
  }

  extractText(xml: string): string {
    const texts: string[] = [];
    const regex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) texts.push(this.decodeXml(match[1]));
    return texts.join("");
  }

  escapeXml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  private buildNumberedBody(
    payload: OfficeFormulaPayload,
    math: string,
    profile: EquationLayoutProfile,
  ): string {
    const sideWidthTwips = Math.max(720, Math.round((profile.numberColumnMinWidthPt ?? 54) * 20));
    const centerWidthTwips = Math.max(1440, 9360 - sideWidthTwips * 2);
    const bookmark = bookmarkNameForFormula(payload.formulaId);
    const visible = profile.numberingScheme === "global"
      ? "1"
      : profile.numberingScheme === "chapter-dot" ? "2.1" : "2-1";
    const numberContent = this.buildNumberFields(profile, visible);
    const nilBorders = ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((edge) => `<w:${edge} w:val="nil"/>`).join("");
    const cellMargins = `<w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar>`;
    const cell = (width: number, alignment: "left" | "center" | "right", content: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/><w:tcBorders>${nilBorders}</w:tcBorders></w:tcPr>` +
      `<w:p><w:pPr><w:jc w:val="${alignment}"/><w:keepLines/><w:keepNext/></w:pPr>${content}</w:p></w:tc>`;
    const table = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/><w:tblBorders>${nilBorders}</w:tblBorders>${cellMargins}</w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="${sideWidthTwips}"/><w:gridCol w:w="${centerWidthTwips}"/><w:gridCol w:w="${sideWidthTwips}"/></w:tblGrid>` +
      `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(sideWidthTwips, "left", "")}${cell(centerWidthTwips, "center", math)}` +
      `${cell(sideWidthTwips, "right", `<w:bookmarkStart w:id="1" w:name="${bookmark}"/><w:r><w:t>(</w:t></w:r>${numberContent}<w:r><w:t>)</w:t></w:r><w:bookmarkEnd w:id="1"/>`)}</w:tr></w:tbl>`;
    return this.wrapInSdt(table, payload, "block");
  }

  private buildNumberFields(profile: EquationLayoutProfile, visible: string): string {
    if (profile.numberingScheme === "global") {
      return this.complexField(" SEQ LaTeXSnipperEquation \\* ARABIC ", visible);
    }
    const separator = profile.numberingScheme === "chapter-hyphen" ? "-" : ".";
    const heading = this.escapeXml(profile.chapterStyle ?? `Heading ${profile.chapterLevel ?? 1}`);
    const chapter = this.complexField(` STYLEREF "${heading}" \\s `, "2");
    const sequence = this.complexField(` SEQ LaTeXSnipperEquation \\s ${profile.chapterLevel ?? 1} \\* ARABIC `, "1");
    return `${chapter}<w:r><w:t>${separator}</w:t></w:r>${sequence}`;
  }

  private complexField(instruction: string, visibleResult: string): string {
    return `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve">${this.escapeXml(instruction)}</w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      `<w:r><w:t>${this.escapeXml(visibleResult)}</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  }

  private normalizeOmml(omml: string, display: boolean): string {
    const cleaned = omml.replace(/^<\?xml[^>]*>\s*/i, "").trim();
    if (!cleaned) throw new Error("Bridge returned empty OMML");
    if (display) {
      if (cleaned.startsWith("<m:oMathPara")) return cleaned;
      if (cleaned.startsWith("<m:oMath")) return `<m:oMathPara>${cleaned}</m:oMathPara>`;
      return `<m:oMathPara><m:oMath>${cleaned}</m:oMath></m:oMathPara>`;
    }
    if (cleaned.startsWith("<m:oMathPara")) {
      const inner = cleaned.replace(/^<m:oMathPara[^>]*>/, "").replace(/<\/m:oMathPara>$/, "");
      const match = inner.match(/<m:oMath\b[\s\S]*?<\/m:oMath>/);
      return match?.[0] ?? `<m:oMath>${inner}</m:oMath>`;
    }
    if (cleaned.startsWith("<m:oMath")) return cleaned;
    return `<m:oMath>${cleaned}</m:oMath>`;
  }

  private wrapInSdt(body: string, payload: OfficeFormulaPayload, level: "run" | "block"): string {
    return `<w:sdt><w:sdtPr><w:alias w:val="LaTeXSnipper Formula"/><w:tag w:val="${formulaTag(payload.formulaId)}"/><w:showingPlcHdr w:val="0"/></w:sdtPr><w:sdtContent>${body}</w:sdtContent></w:sdt>`;
  }

  private wrapInFlatOpc(body: string, payload: OfficeFormulaPayload): string {
    const metadata = encodeFormulaMetadata(payload);
    const itemName = `/customXml/latexsnipper-${payload.formulaId}.xml`;
    return `<?xml version="1.0" encoding="UTF-8"?>` +
      `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">` +
      `<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` +
      `</pkg:xmlData></pkg:part>` +
      `<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"><pkg:xmlData>` +
      `<w:document xmlns:w="${W_NS}" xmlns:m="${M_NS}"><w:body>${body}</w:body></w:document>` +
      `</pkg:xmlData></pkg:part>` +
      `<pkg:part pkg:name="/word/_rels/document.xml.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLsnMetadata" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/latexsnipper-${payload.formulaId}.xml"/></Relationships>` +
      `</pkg:xmlData></pkg:part>` +
      `<pkg:part pkg:name="${itemName}" pkg:contentType="application/xml"><pkg:xmlData>` +
      `<lsn:formula xmlns:lsn="${LSN_NS}" formulaId="${this.escapeXml(payload.formulaId)}"><lsn:payload>${metadata}</lsn:payload></lsn:formula>` +
      `</pkg:xmlData></pkg:part></pkg:package>`;
  }

  private decodeXml(value: string): string {
    return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }
}
