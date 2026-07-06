# Platform Integration Guide

> ⚠️ 状态：历史设计（非当前实现规范）。安装位置、注册策略与当前 HKCU/per-user WiX 实现有差异。
> 当前实现请参阅 `docs/STATUS.md`。

## 支持的平台

### 1. Office 套件

| 平台 | 集成方式 | 状态 |
|------|----------|------|
| Microsoft Word | VSTO 插件 | ✅ 已有 |
| Microsoft PowerPoint | VSTO 插件 | ✅ 已有 |
| WPS Office | VSTO/COM | 📋 计划中 |
| LibreOffice | 宏/扩展 | 📋 计划中 |

### 2. Markdown 编辑器

| 平台 | 集成方式 | 状态 |
|------|----------|------|
| Obsidian | 插件 | 📋 计划中 |
| Typora | 剪贴板 | 📋 计划中 |
| VS Code | 扩展 | 📋 计划中 |
| Notion | 剪贴板 | 📋 计划中 |

### 3. 在线文档

| 平台 | 集成方式 | 状态 |
|------|----------|------|
| Google Docs | Web API | 📋 计划中 |
| 飞书文档 | 剪贴板 | 📋 计划中 |
| 语雀 | 剪贴板 | 📋 计划中 |

## 集成架构

```
┌─────────────────────────────────────────────────────────────┐
│                    LaTeXSnipper Office                       │
├─────────────────────────────────────────────────────────────┤
│  核心服务                                                    │
│  ├── 公式编辑器                                              │
│  ├── 公式渲染器                                              │
│  ├── OCR 识别器                                              │
│  └── 剪贴板管理器                                            │
├─────────────────────────────────────────────────────────────┤
│  平台适配器                                                  │
│  ├── OfficeAdapter (Word/PowerPoint/WPS)                    │
│  ├── ObsidianAdapter                                        │
│  ├── VSCodeAdapter                                          │
│  ├── TyporaAdapter                                          │
│  └── ClipboardAdapter (通用)                                │
├─────────────────────────────────────────────────────────────┤
│  接口层                                                      │
│  ├── HTTP API (localhost:28765)                              │
│  ├── WebSocket                                              │
│  ├── COM 接口                                               │
│  └── 系统剪贴板                                              │
└─────────────────────────────────────────────────────────────┘
```

## 本地 HTTP API

LaTeXSnipper Office 运行本地 HTTP 服务，供各平台插件调用：

```
POST /api/render          → 渲染公式
GET  /api/last-formula    → 获取最近公式
GET  /api/formulas        → 获取公式列表
POST /api/clipboard       → 复制到剪贴板
GET  /api/config          → 获取配置
```

## 平台适配器接口

```typescript
interface PlatformAdapter {
  name: string;
  version: string;
  detect(): boolean;
  insertFormula(formula: Formula): Promise<InsertResult>;
  getClipboardFormat(): ClipboardFormat;
  getSettings(): PlatformSettings;
}

interface Formula {
  latex: string;
  display: boolean;
  format: string;
  metadata?: FormulaMetadata;
}

interface InsertResult {
  success: boolean;
  message?: string;
  error?: string;
}

type ClipboardFormat = 'latex' | 'mathml' | 'omml' | 'svg' | 'png' | 'markdown';

interface PlatformSettings {
  autoDetect: boolean;
  defaultFormat: ClipboardFormat;
  supportedFormats: ClipboardFormat[];
}
```

## 平台实现

### Obsidian 适配器

```typescript
class ObsidianAdapter implements PlatformAdapter {
  name = 'obsidian';
  
  detect(): boolean {
    return !!(window as any).app?.vault;
  }
  
  async insertFormula(formula: Formula): Promise<InsertResult> {
    const view = (window as any).app.workspace.activeLeaf?.view;
    if (!view?.editor) return { success: false, error: 'No active editor' };
    
    const formatted = formula.display ? `$$\n${formula.latex}\n$$` : `$${formula.latex}$`;
    const editor = view.editor;
    const cursor = editor.getCursor();
    editor.replaceRange(formatted, cursor);
    
    return { success: true };
  }
  
  getClipboardFormat(): ClipboardFormat { return 'latex'; }
  getSettings(): PlatformSettings {
    return { autoDetect: true, defaultFormat: 'latex', supportedFormats: ['latex', 'mathml'] };
  }
}
```

### VS Code 适配器

```typescript
class VSCodeAdapter implements PlatformAdapter {
  name = 'vscode';
  
  detect(): boolean {
    return !!(window as any).vscode;
  }
  
  async insertFormula(formula: Formula): Promise<InsertResult> {
    const vscode = (window as any).vscode;
    const text = formula.display ? `$$\n${formula.latex}\n$$` : `$${formula.latex}$`;
    await vscode.postMessage({ type: 'insertText', text });
    return { success: true };
  }
  
  getClipboardFormat(): ClipboardFormat { return 'latex'; }
  getSettings(): PlatformSettings {
    return { autoDetect: true, defaultFormat: 'latex', supportedFormats: ['latex', 'mathml', 'svg'] };
  }
}
```

### WPS 适配器

```typescript
class WPSAdapter implements PlatformAdapter {
  name = 'wps';
  
  detect(): boolean {
    return !!(window as any).WPS;
  }
  
  async insertFormula(formula: Formula): Promise<InsertResult> {
    const wps = (window as any).WPS;
    const result = await wps.insertFormula({
      latex: formula.latex, display: formula.display, format: 'omml',
    });
    return { success: result.success };
  }
  
  getClipboardFormat(): ClipboardFormat { return 'omml'; }
  getSettings(): PlatformSettings {
    return { autoDetect: true, defaultFormat: 'omml', supportedFormats: ['omml', 'mathml', 'png'] };
  }
}
```

### 通用剪贴板适配器

```typescript
class ClipboardAdapter implements PlatformAdapter {
  name = 'clipboard';
  
  detect(): boolean { return navigator.clipboard !== undefined; }
  
  async insertFormula(formula: Formula): Promise<InsertResult> {
    let text: string;
    switch (formula.format) {
      case 'latex':
        text = formula.display ? `$$${formula.latex}$$` : `$${formula.latex}$`;
        break;
      case 'mathml': text = formula.metadata?.mathml || ''; break;
      case 'svg': text = formula.metadata?.svg || ''; break;
      default: text = formula.latex;
    }
    await navigator.clipboard.writeText(text);
    return { success: true, message: 'Formula copied to clipboard' };
  }
  
  getClipboardFormat(): ClipboardFormat { return 'latex'; }
  getSettings(): PlatformSettings {
    return { autoDetect: false, defaultFormat: 'latex', supportedFormats: ['latex', 'mathml', 'svg', 'png'] };
  }
}
```

## 智能格式选择

```typescript
class SmartFormatSelector {
  private adapters: Map<string, PlatformAdapter>;
  
  constructor() {
    this.adapters = new Map();
    this.registerAdapter(new ObsidianAdapter());
    this.registerAdapter(new VSCodeAdapter());
    this.registerAdapter(new WPSAdapter());
    this.registerAdapter(new ClipboardAdapter());
  }
  
  detectPlatform(): PlatformAdapter | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.detect()) return adapter;
    }
    return this.adapters.get('clipboard') || null;
  }
  
  selectFormat(platform: string, formulaType: 'inline' | 'display', availableFormats: string[]): string {
    const adapter = this.adapters.get(platform);
    if (!adapter) return 'latex';
    const settings = adapter.getSettings();
    return availableFormats.includes(settings.defaultFormat) ? settings.defaultFormat : 'latex';
  }
  
  async smartInsert(formula: Formula): Promise<InsertResult> {
    const adapter = this.detectPlatform();
    if (!adapter) return { success: false, error: 'No platform detected' };
    formula.format = this.selectFormat(adapter.name, formula.display ? 'display' : 'inline', adapter.getSettings().supportedFormats);
    return adapter.insertFormula(formula);
  }
}
```

## 各平台插件安装

### Office (VSTO)

```
1. 检测 Office 安装路径
2. 写入注册表: HKLM\SOFTWARE\Microsoft\Office\Word\Addins\LaTeXSnipperOffice
3. 安装 VSTO 清单签名证书
4. 写入 VSTO 安全信任条目
```

### Obsidian

```
1. 检测 vault 路径: ~/.obsidian/plugins/latexsnipper-office/
2. 复制 main.js 和 manifest.json
3. 在 Obsidian 设置中启用插件
```

### VS Code

```bash
# 打包并安装
vsce package
code --install-extension latexsnipper-office-1.0.0.vsix
```

### Typora / Notion

```
通过剪贴板集成:
- Typora: $...$ 格式
- Notion: $$...$$ 格式
```

## 实施步骤

1. 创建适配器接口 (1天)
2. 实现核心适配器 (2-3天)
3. 实现智能选择器 (1天)
4. 实现本地 HTTP 服务 (2天)
5. 测试和集成 (1-2天)

## 验收标准

- 平台检测正确
- 格式选择智能
- 公式插入正常
- 错误处理优雅
- 测试覆盖率 > 80%
