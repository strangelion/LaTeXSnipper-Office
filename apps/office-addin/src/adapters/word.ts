import type {
  OfficeDocumentAdapter,
  DocumentFragment,
  EquationBlock,
  TableIR,
  InsertFormulaRequest,
  ReplaceFormulaRequest,
  HostCapabilities,
  Block,
  Inline,
} from '../types/index';

/**
 * Word Office.js Adapter
 * 
 * Implements OfficeDocumentAdapter using Word's JavaScript API.
 * Translates between Word OOXML and LaTeXSnipper's DocumentFragment.
 */
export class WordOfficeAdapter implements OfficeDocumentAdapter {
  private host: 'word' | 'excel' | 'powerpoint' = 'word';

  /**
   * Get the current selection as a DocumentFragment
   */
  async getSelection(): Promise<DocumentFragment> {
    return Word.run(async (context) => {
      const selection = context.document.getSelection();
      const ooxml = selection.getOoxml();
      await context.sync();

      return this.parseOoxml(ooxml.value);
    });
  }

  /**
   * Get the selected formula (if any)
   */
  async getSelectedFormula(): Promise<EquationBlock | null> {
    return Word.run(async (context) => {
      const selection = context.document.getSelection();
      const ooxml = selection.getOoxml();
      await context.sync();

      return this.extractFormulaFromOoxml(ooxml.value);
    });
  }

  /**
   * Get the selected table (if any)
   */
  async getSelectedTable(): Promise<TableIR | null> {
    try {
      return await Word.run(async (context) => {
        const selection = context.document.getSelection();
        const tables = selection.tables;
        await context.sync();

        if (tables.items.length === 0) return null;

        return this.extractTableData(tables.items[0], context);
      });
    } catch {
      return null; // Table extraction not yet implemented
    }
  }

  /**
   * Insert a formula into the current selection
   */
  async insertFormula(request: InsertFormulaRequest): Promise<void> {
    const ooxml = await this.buildFormulaOoxml(request);

    return Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.insertOoxml(ooxml, Word.InsertLocation.replace);
      await context.sync();
    });
  }

  /**
   * Replace the selected formula
   */
  async replaceSelectedFormula(request: ReplaceFormulaRequest): Promise<void> {
    const ooxml = await this.buildEquationOoxml(request.formula);

    return Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.insertOoxml(ooxml, Word.InsertLocation.replace);
      await context.sync();
    });
  }

  /**
   * Delete the current LaTeXSnipper block (ContentControl)
   */
  async deleteCurrentBlock(): Promise<void> {
    return Word.run(async (context) => {
      const selection = context.document.getSelection();
      const parentCc = selection.parentContentControl;
      await context.sync();

      if (parentCc) {
        parentCc.delete(true);
        await context.sync();
      }
    });
  }

  /**
   * Get host capabilities
   */
  async getHostCapabilities(): Promise<HostCapabilities> {
    const platform = await this.detectPlatform();
    return {
      host: 'word',
      platform,
      version: (Office && Office.context && Office.context.diagnostics) ? Office.context.diagnostics.version : '0.0.0',
    };
  }

  // ═══ Private helpers ═══

  /**
   * Parse raw OOXML into a DocumentFragment
   */
  private parseOoxml(xml: string): DocumentFragment {
    const blocks: Block[] = [];

    // Check for math elements
    if (xml.includes('<m:oMath') || xml.includes('<m:oMathPara')) {
      const mathContent = this.extractMathContent(xml);
      blocks.push({
        type: 'equation',
        math: { type: 'omml', content: mathContent },
        display: xml.includes('<m:oMathPara'),
        numbered: false,
      });
    }

    // Check for table elements
    if (xml.includes('<w:tbl') || xml.includes('<m:tbl')) {
      blocks.push({
        type: 'table',
        table: { rows: [] },
      });
    }

    // Default: treat as paragraph
    if (blocks.length === 0) {
      const text = this.extractText(xml);
      blocks.push({
        type: 'paragraph',
        content: { inlines: [{ type: 'text', text }] },
      });
    }

    return {
      version: 1,
      blocks,
      source: { origin: 'word' },
    };
  }

  /**
   * Extract formula OMML from OOXML
   */
  private extractMathContent(xml: string): string {
    const match = xml.match(/<m:oMath[^>]*>.*?<\/m:oMath>/s);
    return match ? match[0] : xml;
  }

  /**
   * Extract plain text from OOXML
   */
  private extractText(xml: string): string {
    const texts: string[] = [];
    const regex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      texts.push(match[1]);
    }
    return texts.join('');
  }

  /**
   * Extract formula from OOXML using Bridge API
   */
  private async extractFormulaFromOoxml(xml: string): Promise<EquationBlock | null> {
    const mathMatch = xml.match(/<m:oMath[^>]*>.*?<\/m:oMath>/s);
    if (!mathMatch) return null;

    const omml = mathMatch[0];
    const display = xml.includes('<m:oMathPara');

    try {
      // Convert OMML to LaTeX via Bridge (same origin)
      const response = await fetch('/api/office/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ omml, display }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.latex) {
          return { math: { type: 'latex' as const, content: data.latex }, display, numbered: false };
        }
      }
    } catch {}

    // Fallback: return raw OMML
    return { math: { type: 'omml' as const, content: omml }, display, numbered: false };
  }

  /**
   * Extract table data from Word Table object
   * NOTE: Not yet implemented. Requires table.getOoxml() → Rust OOXML Table Parser → TableIR.
   */
  private async extractTableData(
    _table: Word.Table,
    _context: Word.RequestContext
  ): Promise<TableIR> {
    throw new Error('Table extraction is not yet implemented');
  }

  /**
   * Build OOXML from a formula insert request
   */
  private async buildFormulaOoxml(request: InsertFormulaRequest): Promise<string> {
    if (request.mode === 'display-numbered') {
      return this.buildNumberedEquationOoxml(request);
    }

    const mathContent = await this.extractOmml(request.fragment);
    const mathTag = request.mode === 'display' ? 'm:oMathPara' : 'm:oMath';

    // Wrap in content control so deleteCurrentBlock() can find parentContentControl
    const body = this.wrapInSdt(
      `<w:p><${mathTag}>${mathContent}</${mathTag}></w:p>`
    );
    return this.wrapInFlatOpc(body);
  }

  /**
   * Build a numbered equation using 3-column table layout
   */
  private async buildNumberedEquationOoxml(request: InsertFormulaRequest): Promise<string> {
    const mathContent = await this.extractOmml(request.fragment);
    const body = this.wrapInSdt(
      `<w:tbl><w:tr>` +
      `<w:tc><w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:jc w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMathPara>${mathContent}</m:oMathPara></w:p></w:tc>` +
      `<w:tc><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> SEQ \\* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:tc>` +
      `</w:tr></w:tbl>`
    );
    return this.wrapInFlatOpc(body);
  }

  /**
   * Build OOXML for a single equation
   */
  private async buildEquationOoxml(formula: EquationBlock): Promise<string> {
    const mathTag = formula.display ? 'm:oMathPara' : 'm:oMath';
    let content: string;

    if (formula.math.type === 'omml') {
      content = formula.math.content;
    } else if (formula.math.type === 'latex') {
      content = await this.latexToOmml(formula.math.content, formula.display);
    } else {
      content = `<m:r><m:t>${this.escapeXml(formula.math.content)}</m:t></m:r>`;
    }

    const body = this.wrapInSdt(`<w:p><${mathTag}>${content}</${mathTag}></w:p>`);
    return this.wrapInFlatOpc(body);
  }

  /**
   * Extract OMML from a DocumentFragment, converting LaTeX via Bridge if needed
   */
  private async extractOmml(fragment: DocumentFragment): Promise<string> {
    for (const block of fragment.blocks) {
      if (block.type === 'equation') {
        if (block.math.type === 'omml') {
          return block.math.content;
        }
        if (block.math.type === 'latex') {
          // Convert LaTeX to OMML via Bridge API
          const omml = await this.latexToOmml(block.math.content, block.display);
          return omml;
        }
        // MathML fallback
        return `<m:r><m:t>${this.escapeXml(block.math.content)}</m:t></m:r>`;
      }
    }
    return '';
  }

  /**
   * Call Bridge API to convert LaTeX to OMML
   */
  private async latexToOmml(latex: string, display: boolean): Promise<string> {
    try {
      const response = await fetch('/api/office/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex, display }),
      });
      if (!response.ok) return this.fallbackOmml(latex);
      const data = await response.json();
      return data.omml || this.fallbackOmml(latex);
    } catch {
      return this.fallbackOmml(latex);
    }
  }

  /**
   * Fallback when Bridge is unreachable: wrap LaTeX in text run
   */
  private fallbackOmml(latex: string): string {
    return `<m:r><m:t>${this.escapeXml(latex)}</m:t></m:r>`;
  }

  /**
   * Wrap content in a Word content control (w:sdt) so deleteCurrentBlock()
   * can reliably find selection.parentContentControl.
   */
  private wrapInSdt(body: string): string {
    const uuid = crypto.randomUUID();
    return `<w:sdt>` +
      `<w:sdtPr>` +
      `<w:alias w:val="LaTeXSnipper Formula"/>` +
      `<w:tag w:val="latexsnipper:formula:${uuid}"/>` +
      `</w:sdtPr>` +
      `<w:sdtContent>${body}</w:sdtContent>` +
      `</w:sdt>`;
  }

  /**
   * Wrap content in Flat OPC package for Word InsertXML
   */
  private wrapInFlatOpc(body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>` +
      `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">` +
      `<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml" pkg:padding="512">` +
      `<pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships></pkg:xmlData></pkg:part>` +
      `<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">` +
      `<pkg:xmlData><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}</w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Detect platform
   */
  private async detectPlatform(): Promise<'windows' | 'mac' | 'web'> {
    try {
      if (Office.context && Office.context.platform) {
        const p = Office.context.platform;
        if (p === Office.PlatformType.PC) return 'windows';
        if (p === Office.PlatformType.Mac) return 'mac';
      }
    } catch {}
    return 'web';
  }
}
