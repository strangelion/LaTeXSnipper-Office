/**
 * LaTeXSnipper Office — OOXML Builder
 *
 * Pure functions for constructing Word OOXML (Flat OPC) from LaTeX content.
 * Extracted from the old word.ts adapter. No Office.js dependency —
 * safe to import in any context.
 */

export class WordOoxmlHelper {
  /**
   * Build a Flat OPC OOXML package for inserting a formula into Word.
   * Falls back to wrapping LaTeX as plain text in an OMML run.
   */
  buildFormulaOoxml(latex: string, display: boolean): string {
    const mathTag = display ? "m:oMathPara" : "m:oMath";
    const mathContent = `<m:r><m:t xml:space="preserve">${this.escapeXml(latex)}</m:t></m:r>`;
    const body = this.wrapInSdt(`<w:p><${mathTag}>${mathContent}</${mathTag}></w:p>`);
    return this.wrapInFlatOpc(body);
  }

  /**
   * Build OOXML from pre-converted OMML (Bridge output).
   * The OMML should contain a complete <m:oMath>...</m:oMath> structure.
   */
  buildOoxmlFromOmml(omml: string, display: boolean): string {
    const mathTag = display ? "m:oMathPara" : "m:oMath";
    // Ensure OMML is wrapped in the right math tag
    const content = omml.startsWith("<m:oMath") ? omml : `<${mathTag}>${omml}</${mathTag}>`;
    const body = this.wrapInSdt(`<w:p>${content}</w:p>`);
    return this.wrapInFlatOpc(body);
  }

  /**
   * Build a numbered equation from pre-converted OMML (3-column table layout).
   */
  buildNumberedEquationOoxmlFromOmml(omml: string): string {
    const content = omml.startsWith("<m:oMath") ? omml : `<m:oMathPara>${omml}</m:oMathPara>`;
    const body = this.wrapInSdt(
      `<w:tbl><w:tr>` +
        `<w:tc><w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:jc w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${content}</w:p></w:tc>` +
        `<w:tc><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> SEQ \\\\* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:tc>` +
        `</w:tr></w:tbl>`,
    );
    return this.wrapInFlatOpc(body);
  }

  /**
   * Build an OOXML snippet for a numbered equation (3-column table layout).
   * Fallback: wraps LaTeX as plain text.
   */
  buildNumberedEquationOoxml(latex: string): string {
    const mathContent = `<m:r><m:t xml:space="preserve">${this.escapeXml(latex)}</m:t></m:r>`;
    const body = this.wrapInSdt(
      `<w:tbl><w:tr>` +
        `<w:tc><w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:jc w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMathPara>${mathContent}</m:oMathPara></w:p></w:tc>` +
        `<w:tc><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> SEQ \\\\* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:tc>` +
        `</w:tr></w:tbl>`,
    );
    return this.wrapInFlatOpc(body);
  }

  /**
   * Extract plain text from OOXML.
   */
  extractText(xml: string): string {
    const texts: string[] = [];
    const regex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      texts.push(match[1]);
    }
    return texts.join("");
  }

  /**
   * Extract raw OMML from a Flat OPC / OOXML string.
   */
  extractOmml(xml: string): string {
    const match = xml.match(/<m:oMath[^>]*>(.*?)<\/m:oMath>/s);
    return match ? match[1] : xml;
  }

  /**
   * Wrap content in a Word content control (w:sdt) so
   * selection.parentContentControl can find it for deletion.
   */
  wrapInSdt(body: string): string {
    const uuid = crypto.randomUUID();
    return (
      `<w:sdt>` +
      `<w:sdtPr>` +
      `<w:alias w:val="LaTeXSnipper Formula"/>` +
      `<w:tag w:val="latexsnipper:formula:${uuid}"/>` +
      `</w:sdtPr>` +
      `<w:sdtContent>${body}</w:sdtContent>` +
      `</w:sdt>`
    );
  }

  /**
   * Wrap body in a Flat OPC package for Word.insertOoxml.
   */
  wrapInFlatOpc(body: string): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">` +
      `<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml" pkg:padding="512">` +
      `<pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships></pkg:xmlData></pkg:part>` +
      `<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">` +
      `<pkg:xmlData><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}</w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`
    );
  }

  /**
   * Escape XML special characters.
   */
  escapeXml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
