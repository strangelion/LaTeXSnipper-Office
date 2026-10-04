import { OfficeBridgeClient } from "./bridge-client";
import { WordOoxmlHelper } from "./word-ooxml";
import {
  createFormulaId,
  type OfficeFormulaPayload,
} from "../model/formula-payload";

export function selectionLatex(text: string): string {
  // Office.js v1 deliberately supports one paragraph only. Never replace a
  // paragraph/cell boundary with an inline SDT. Native Word supports multiline.
  if (
    !text.trim() ||
    text.length > 16384 ||
    /[\r\n\u0000\u0007\u000b]/.test(text)
  )
    throw new Error("请选中同一段落内的一条公式，不要包含段落或表格结束标记");
  const source = text.trim();
  if (/```|:\/\/|[A-Za-z]:\\/.test(source))
    throw new Error("代码块和路径不能作为公式转换");
  const wrappers: Array<[string, string]> = [
    ["$$", "$$"],
    ["$", "$"],
    ["\\(", "\\)"],
    ["\\[", "\\]"],
  ];
  let latex = source;
  let delimited = false;
  for (const [open, close] of wrappers) {
    if (!source.startsWith(open)) continue;
    if (!source.endsWith(close) || source.length <= open.length + close.length)
      throw new Error("请选择一条完整的公式");
    latex = source.slice(open.length, -close.length).trim();
    delimited = true;
    break;
  }
  if (!latex) throw new Error("公式内容为空");
  // No heuristic extraction from mixed prose and no unfinished delimiters.
  let depth = 0;
  for (let index = 0; index < latex.length; index++) {
    const char = latex[index];
    if (char === "\\") {
      const next = latex[index + 1];
      if (next === undefined) throw new Error("LaTeX 命令不完整");
      if (/[{}$%\\]/.test(next)) {
        index++;
        continue;
      }
      if (next === "(" || next === ")" || next === "[" || next === "]")
        throw new Error("请选择一条完整的公式，不要混合正文和公式");
    }
    if (char === "%") break;
    if (char === "$")
      throw new Error("请选择一条完整的公式，不要混合正文和公式");
    if (char === "{") depth++;
    if (char === "}" && --depth < 0) throw new Error("LaTeX 花括号不匹配");
  }
  if (depth !== 0) throw new Error("LaTeX 花括号不匹配");
  if (!delimited && !/\\[A-Za-z]+|[_^=+]|[0-9]/.test(latex))
    throw new Error("选区没有可识别的数学语法，请使用公式编辑器");
  return latex;
}

interface PreparedSelection {
  range: Word.Range;
  source: string;
  originalXml: string;
  payload: OfficeFormulaPayload;
  replacementXml: string;
  svg: string;
}

/** Keeps a tracked range across preview/confirmation, never reselects by text. */
export class WordSelectionLatex {
  private prepared: PreparedSelection | null = null;
  constructor(
    private readonly bridge = new OfficeBridgeClient(),
    private readonly ooxml = new WordOoxmlHelper(),
  ) {}

  async prepare(
    existingRange?: Word.Range,
    renderPreview = true,
  ): Promise<{ source: string; latex: string; svg: string }> {
    await this.cancel();
    let tracked: Word.Range | null = existingRange || null;
    try {
      const read = async (context: Word.RequestContext) => {
        const range = existingRange || context.document.getSelection();
        range.load("text");
        const parent = range.parentContentControlOrNullObject;
        parent.load("isNullObject");
        range.contentControls.load("items");
        const xml = range.getOoxml();
        await context.sync();
        if (!parent.isNullObject || range.contentControls.items.length !== 0)
          throw new Error(
            "选区位于内容控件中，请用‘加载选中公式/原位更新’，不要嵌套替换",
          );
        const latex = selectionLatex(range.text);
        range.track();
        await context.sync();
        tracked = range;
        return { range, source: range.text, latex, originalXml: xml.value };
      };
      const snapshot = await (existingRange
        ? Word.run(existingRange, read)
        : Word.run(read));
      const payload: OfficeFormulaPayload = {
        schemaVersion: 1,
        formulaId: createFormulaId(),
        latex: snapshot.latex,
        displayMode: "inline",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const converted = await this.bridge.convert(
        "latex",
        "omml",
        payload.latex,
        "inline",
      );
      const rendered = renderPreview
        ? await this.bridge.convert("latex", "svg", payload.latex, "inline")
        : { content: "" };
      this.prepared = {
        ...snapshot,
        payload,
        replacementXml: this.ooxml.buildReplacementContent(
          payload,
          converted.content,
        ),
        svg: rendered.content,
      };
      return {
        source: snapshot.source,
        latex: snapshot.latex,
        svg: rendered.content,
      };
    } catch (error) {
      if (tracked) await this.release(tracked);
      throw error;
    }
  }

  async confirm(): Promise<OfficeFormulaPayload> {
    const prepared = this.prepared;
    if (!prepared) throw new Error("请先预览 Word 选区");
    this.prepared = null; // one-shot: no double commit or timeout retry
    let stagedPart: Office.CustomXmlPart | null = null;
    let mutationStarted = false;
    try {
      stagedPart = await new Promise<Office.CustomXmlPart>(
        (resolve, reject) => {
          Office.context.document.customXmlParts.addAsync(
            this.ooxml.buildMetadataXml(prepared.payload),
            (result) => {
              if (result.status === Office.AsyncResultStatus.Succeeded)
                resolve(result.value);
              else reject(new Error(result.error.message));
            },
          );
        },
      );
      await Word.run(prepared.range, async (context) => {
        prepared.range.load("text");
        const actual = prepared.range.getOoxml();
        await context.sync();
        if (
          prepared.range.text !== prepared.source ||
          actual.value !== prepared.originalXml
        )
          throw new Error("预览后原文或格式已变化，未替换；请重新选择并预览");
        mutationStarted = true;
        prepared.range.insertOoxml(
          prepared.replacementXml,
          Word.InsertLocation.replace,
        );
        await context.sync();
      });
      return prepared.payload;
    } catch (error) {
      // A timed-out sync may have committed: keep identity metadata for inspection.
      if (stagedPart && !mutationStarted)
        await new Promise<void>((resolve, reject) =>
          stagedPart!.deleteAsync((result) => {
            if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
            else reject(new Error(result.error.message));
          }),
        );
      throw error;
    } finally {
      await this.release(prepared.range);
    }
  }

  async cancel(): Promise<void> {
    const prepared = this.prepared;
    this.prepared = null;
    if (prepared) await this.release(prepared.range);
  }

  private async release(range: Word.Range): Promise<void> {
    await Word.run(range, async (context) => {
      range.untrack();
      await context.sync();
    });
  }
}
