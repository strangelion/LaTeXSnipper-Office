import { WordSelectionLatex, selectionLatex } from "./word-selection-latex";

export function isStandaloneLatex(text: string): boolean {
  const source = text.trim();
  if (
    ![
      ["$$", "$$"],
      ["$", "$"],
      ["\\(", "\\)"],
      ["\\[", "\\]"],
    ].some(([open, close]) => source.startsWith(open) && source.endsWith(close))
  )
    return false;
  try {
    selectionLatex(source);
    return true;
  } catch {
    return false;
  }
}

interface Entry {
  range: Word.Range;
  source: string;
  controller?: WordSelectionLatex;
  transferred?: boolean;
}

// v1 is deliberately paragraph-scoped. Never infer formulas from ordinary prose.
export class WordBatchLatex {
  private entries: Entry[] = [];
  private stopped = false;
  private consumed = false;
  constructor(
    private readonly createController = () => new WordSelectionLatex(),
  ) {}

  requestStop(): void {
    this.stopped = true;
  }

  async prepare(
    progress: (message: string) => void,
  ): Promise<{ items: Array<{ status: string; sourceText: string }> }> {
    if (this.entries.length || this.consumed)
      throw new Error("批量计划已使用，请重新扫描");
    try {
      await Word.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load("items/text");
        await context.sync();
        if (paragraphs.items.length > 10000)
          throw new Error("文档超过 10000 段，请使用原生 Word 加载项批量转换");
        let fenced = false;
        for (const paragraph of paragraphs.items) {
          if (/^\s*(```|~~~)/.test(paragraph.text)) {
            fenced = !fenced;
            continue;
          }
          if (fenced || !isStandaloneLatex(paragraph.text)) continue;
          if (this.entries.length >= 500)
            throw new Error(
              "此任务窗格每次最多 500 条；大批量请使用原生 Word 加载项",
            );
          const range = paragraph.getRange(Word.RangeLocation.content);
          range.track();
          this.entries.push({ range, source: paragraph.text.trim() });
        }
        await context.sync();
      });
      const items = [];
      for (const [index, entry] of this.entries.entries()) {
        if (this.stopped) throw new Error("已停止扫描，原文未修改");
        progress(
          `正在校验 ${index + 1}/${this.entries.length} 条（尚未修改文档）…`,
        );
        const controller = this.createController();
        entry.transferred = true;
        try {
          const prepared = await controller.prepare(entry.range, false);
          if (prepared.source.trim() !== entry.source)
            throw new Error("扫描后原文已变化");
          entry.controller = controller;
          items.push({ status: "converted", sourceText: prepared.source });
        } catch {
          await controller.cancel();
          items.push({ status: "skipped", sourceText: entry.source });
        }
      }
      if (this.stopped) throw new Error("已停止扫描，原文未修改");
      return { items };
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  async execute(
    progress: (message: string) => void,
  ): Promise<{
    total: number;
    converted: number;
    skipped: number;
    stopped: boolean;
  }> {
    if (this.consumed) throw new Error("批量计划已提交，不会自动重试");
    this.consumed = true;
    let converted = 0;
    const total = this.entries.length;
    const skipped = this.entries.filter((entry) => !entry.controller).length;
    try {
      for (const entry of [...this.entries].reverse()) {
        if (this.stopped) break;
        if (!entry.controller) continue;
        try {
          await entry.controller.confirm();
        } catch (error) {
          throw new Error(
            `已确认 ${converted} 条；当前条状态需检查，任务停止，不会重试：${String(error)}`,
          );
        }
        converted++;
        progress(`正在转换：${converted}/${total}，已校验范围保留绑定…`);
      }
      return { total, converted, skipped, stopped: this.stopped };
    } finally {
      await this.dispose();
    }
  }

  async dispose(): Promise<void> {
    const entries = this.entries;
    this.entries = [];
    const errors = [];
    for (const entry of entries) {
      try {
        await entry.controller?.cancel();
      } catch (error) {
        errors.push(error);
      }
      if (!entry.transferred) {
        try {
          await Word.run(entry.range, async (context) => {
            entry.range.untrack();
            await context.sync();
          });
        } catch (error) {
          errors.push(error);
        }
      }
    }
    if (errors.length)
      throw new Error("部分跟踪范围未释放，请关闭任务窗格后重试");
  }
}
