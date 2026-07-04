import { WordOfficeAdapter } from '../adapters/word';

let adapter: WordOfficeAdapter;

Office.onReady((info) => {
  console.log('[LaTeXSnipper] Office.js ready, host:', info.host);

  adapter = new WordOfficeAdapter();

  // Set up event handlers
  document.getElementById('loadBtn')?.addEventListener('click', handleLoad);
  document.getElementById('insertBtn')?.addEventListener('click', handleInsert);
  document.getElementById('deleteBtn')?.addEventListener('click', handleDelete);
});

function setStatus(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.className = `status ${type}`;
}

function getEditorContent(): string {
  const el = document.getElementById('editor') as HTMLTextAreaElement;
  return el?.value?.trim() || '';
}

function setEditorContent(text: string) {
  const el = document.getElementById('editor') as HTMLTextAreaElement;
  if (el) el.value = text;
}

function getInsertMode(): 'inline' | 'display' | 'numbered' {
  const sel = document.getElementById('modeSelect') as HTMLSelectElement;
  return (sel?.value as 'inline' | 'display' | 'numbered') || 'display';
}

/**
 * Load selection from Word
 */
async function handleLoad() {
  setStatus('正在从 Word 加载...', 'info');
  try {
    const fragment = await adapter.getSelection();
    if (fragment.blocks.length === 0) {
      setStatus('未选中公式', 'error');
      return;
    }

    const firstBlock = fragment.blocks[0];
    if (firstBlock.type === 'equation') {
      setEditorContent(firstBlock.math.content);
      setStatus('公式已加载', 'success');
    } else if (firstBlock.type === 'paragraph' && 'inlines' in firstBlock.content) {
      const text = firstBlock.content.inlines
        .map((i: any) => i.type === 'formula' ? i.formula.content : i.text)
        .join('');
      setEditorContent(text);
      setStatus('文本已加载', 'success');
    } else {
      setStatus('选中的内容不包含公式', 'error');
    }
  } catch (err: any) {
    setStatus(`加载失败: ${err.message || err}`, 'error');
    console.error('[LaTeXSnipper] Load error:', err);
  }
}

/**
 * Insert formula into Word
 */
async function handleInsert() {
  const content = getEditorContent();
  if (!content) {
    setStatus('请先输入公式', 'error');
    return;
  }

  const mode = getInsertMode();
  setStatus('正在插入...', 'info');

  try {
    await adapter.insertFormula({
      fragment: {
        version: 1,
        blocks: [{
          type: 'equation',
          math: { type: 'latex', content },
          display: mode !== 'inline',
          numbered: mode === 'numbered',
        }],
      },
      mode,
    });

    setStatus('已插入到 Word', 'success');
  } catch (err: any) {
    setStatus(`插入失败: ${err.message || err}`, 'error');
    console.error('[LaTeXSnipper] Insert error:', err);
  }
}

/**
 * Delete current formula block
 */
async function handleDelete() {
  setStatus('正在删除...', 'info');
  try {
    await adapter.deleteCurrentBlock();
    setStatus('已删除', 'success');
  } catch (err: any) {
    setStatus(`删除失败: ${err.message || err}`, 'error');
    console.error('[LaTeXSnipper] Delete error:', err);
  }
}
