import { WordOfficeAdapter } from '../adapters/word';
import type { InsertFormulaRequest } from '../types/index';

type InsertMode = 'inline' | 'display' | 'display-numbered';
type StatusType = 'info' | 'success' | 'error';

interface HostAdapter {
  load(): Promise<string>;
  insert(latex: string, mode: InsertMode): Promise<void>;
  delete(): Promise<void>;
}

const bridgeBase = (() => {
  const { protocol, hostname, port } = window.location;
  if ((hostname === '127.0.0.1' || hostname === 'localhost') && port === '19876') {
    return '';
  }
  return 'https://127.0.0.1:19876';
})();

class WordTaskpaneAdapter implements HostAdapter {
  private readonly adapter = new WordOfficeAdapter();

  async load(): Promise<string> {
    const fragment = await this.adapter.getSelection();
    const firstBlock = fragment.blocks[0];
    if (!firstBlock) {
      return '';
    }
    if (firstBlock.type === 'equation') {
      return firstBlock.math.content;
    }
    if (firstBlock.type === 'paragraph') {
      return firstBlock.content.inlines
        .map((inline) => inline.type === 'formula' ? inline.formula.content : ('text' in inline ? inline.text : ''))
        .join('');
    }
    return '';
  }

  async insert(latex: string, mode: InsertMode): Promise<void> {
    const request: InsertFormulaRequest = {
      fragment: {
        version: 1,
        blocks: [{
          type: 'equation',
          math: { type: 'latex', content: latex },
          display: mode !== 'inline',
          numbered: mode === 'display-numbered',
        }],
      },
      mode,
    };
    await this.adapter.insertFormula(request);
  }

  async delete(): Promise<void> {
    await this.adapter.deleteCurrentBlock();
  }
}

class ExcelTaskpaneAdapter implements HostAdapter {
  async load(): Promise<string> {
    return Excel.run(async (context) => {
      const range = context.workbook.getSelectedRange();
      range.load('text');
      await context.sync();
      return range.text?.[0]?.[0] || '';
    });
  }

  async insert(latex: string, mode: InsertMode): Promise<void> {
    const value = mode === 'inline' ? `$${latex}$` : `$$${latex}$$`;
    return Excel.run(async (context) => {
      const range = context.workbook.getSelectedRange();
      range.values = [[value]];
      await context.sync();
    });
  }

  async delete(): Promise<void> {
    return Excel.run(async (context) => {
      const range = context.workbook.getSelectedRange();
      range.clear(Excel.ClearApplyTo.contents);
      await context.sync();
    });
  }
}

class PowerPointTaskpaneAdapter implements HostAdapter {
  async load(): Promise<string> {
    return new Promise((resolve, reject) => {
      Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          resolve(String(result.value || ''));
        } else {
          reject(new Error(result.error.message));
        }
      });
    });
  }

  async insert(latex: string, mode: InsertMode): Promise<void> {
    const value = mode === 'inline' ? `$${latex}$` : `$$\n${latex}\n$$`;
    return new Promise((resolve, reject) => {
      Office.context.document.setSelectedDataAsync(
        value,
        { coercionType: Office.CoercionType.Text },
        (result) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) {
            resolve();
          } else {
            reject(new Error(result.error.message));
          }
        },
      );
    });
  }

  async delete(): Promise<void> {
    return this.insert('', 'inline');
  }
}

let adapter: HostAdapter | null = null;

Office.onReady((info) => {
  adapter = createAdapter(info.host);
  const hostName = info.host ? String(info.host) : 'Office';
  setHostLabel(hostName);
  void sendHeartbeat(hostName);

  document.getElementById('loadBtn')?.addEventListener('click', () => void handleLoad());
  document.getElementById('insertBtn')?.addEventListener('click', () => void handleInsert());
  document.getElementById('deleteBtn')?.addEventListener('click', () => void handleDelete());
  setStatus('Ready');
});

function createAdapter(host?: Office.HostType): HostAdapter {
  if (host === Office.HostType.Excel) {
    return new ExcelTaskpaneAdapter();
  }
  if (host === Office.HostType.PowerPoint) {
    return new PowerPointTaskpaneAdapter();
  }
  return new WordTaskpaneAdapter();
}

async function sendHeartbeat(host: string) {
  try {
    await fetch(`${bridgeBase}/api/office/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host }),
    });
  } catch {
    // The desktop bridge may be offline; document editing still works where possible.
  }
}

function setStatus(message: string, type: StatusType = 'info') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message;
  el.className = `status ${type}`;
}

function setHostLabel(host: string) {
  const el = document.getElementById('hostLabel');
  if (el) {
    el.textContent = host;
  }
}

function getEditorContent(): string {
  const el = document.getElementById('editor') as HTMLTextAreaElement | null;
  return el?.value?.trim() || '';
}

function setEditorContent(text: string) {
  const el = document.getElementById('editor') as HTMLTextAreaElement | null;
  if (el) {
    el.value = text;
  }
}

function getInsertMode(): InsertMode {
  const sel = document.getElementById('modeSelect') as HTMLSelectElement | null;
  if (sel?.value === 'numbered') return 'display-numbered';
  if (sel?.value === 'inline') return 'inline';
  return 'display';
}

async function handleLoad() {
  if (!adapter) return;
  setStatus('Loading selection...');
  try {
    const text = await adapter.load();
    if (!text) {
      setStatus('No supported selection found', 'error');
      return;
    }
    setEditorContent(text);
    setStatus('Loaded selection', 'success');
  } catch (err) {
    setStatus(`Load failed: ${formatError(err)}`, 'error');
  }
}

async function handleInsert() {
  if (!adapter) return;
  const content = getEditorContent();
  if (!content) {
    setStatus('Enter a LaTeX formula first', 'error');
    return;
  }

  setStatus('Inserting...');
  try {
    await adapter.insert(content, getInsertMode());
    setStatus('Inserted', 'success');
  } catch (err) {
    setStatus(`Insert failed: ${formatError(err)}`, 'error');
  }
}

async function handleDelete() {
  if (!adapter) return;
  setStatus('Deleting...');
  try {
    await adapter.delete();
    setStatus('Deleted', 'success');
  } catch (err) {
    setStatus(`Delete failed: ${formatError(err)}`, 'error');
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
