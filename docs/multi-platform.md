# Multi-Platform Integration

> ⚠️ 状态：历史设计（非当前实现规范）。Office/WPS/Obsidian 的集成方式与当前实现有差异。
> 当前实现请参阅 `docs/STATUS.md`。

## 支持的平台

### 1. Office 套件

| 平台 | 集成方式 | 状态 |
|------|----------|------|
| Microsoft Word | VSTO 插件 | 已支持 |
| Microsoft PowerPoint | VSTO 插件 | 已支持 |
| WPS Office | VSTO/COM | 计划中 |
| LibreOffice | 宏/扩展 | 计划中 |

### 2. Markdown 编辑器

| 平台 | 集成方式 | 状态 |
|------|----------|------|
| Obsidian | 插件 | 计划中 |
| Typora | 剪贴板 | 计划中 |
| VS Code | 扩展 | 计划中 |
| Notion | 剪贴板 | 计划中 |

### 3. 在线文档

| 平台 | 集成方式 | 状态 |
|------|----------|------|
| Google Docs | Web API | 计划中 |
| 飞书文档 | 剪贴板 | 计划中 |
| 语雀 | 剪贴板 | 计划中 |

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
│  ├── HTTP API                                               │
│  ├── WebSocket                                              │
│  ├── COM 接口                                               │
│  └── 系统剪贴板                                              │
└─────────────────────────────────────────────────────────────┘
```

## 平台适配器接口

```typescript
// src/plugins/adapter.ts

interface PlatformAdapter {
  /** 平台名称 */
  name: string;
  
  /** 平台版本 */
  version: string;
  
  /** 检测是否在当前平台 */
  detect(): boolean;
  
  /** 插入公式 */
  insertFormula(formula: Formula): Promise<InsertResult>;
  
  /** 获取推荐的剪贴板格式 */
  getClipboardFormat(): ClipboardFormat;
  
  /** 获取平台特定的设置 */
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
// src/plugins/adapters/obsidian.ts

class ObsidianAdapter implements PlatformAdapter {
  name = 'obsidian';
  version = '1.0.0';
  
  detect(): boolean {
    // 检测是否在 Obsidian 环境
    return !!(window as any).app?.vault;
  }
  
  async insertFormula(formula: Formula): Promise<InsertResult> {
    try {
      // 获取当前活动视图
      const view = (window as any).app.workspace.activeLeaf?.view;
      if (!view?.editor) {
        return { success: false, error: 'No active editor' };
      }
      
      // 格式化公式
      const formatted = this.formatForObsidian(formula);
      
      // 插入到编辑器
      const editor = view.editor;
      const cursor = editor.getCursor();
      editor.replaceRange(formatted, cursor);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  getClipboardFormat(): ClipboardFormat {
    return 'latex';
  }
  
  getSettings(): PlatformSettings {
    return {
      autoDetect: true,
      defaultFormat: 'latex',
      supportedFormats: ['latex', 'mathml'],
    };
  }
  
  private formatForObsidian(formula: Formula): string {
    if (formula.display) {
      return `$$\n${formula.latex}\n$$`;
    }
    return `$${formula.latex}$`;
  }
}
```

### VS Code 适配器

```typescript
// src/plugins/adapters/vscode.ts

class VSCodeAdapter implements PlatformAdapter {
  name = 'vscode';
  version = '1.0.0';
  
  detect(): boolean {
    // 检测是否在 VS Code 环境
    return !!(window as any).vscode;
  }
  
  async insertFormula(formula: Formula): Promise<InsertResult> {
    try {
      // 通过 VS Code API 插入
      const vscode = (window as any).vscode;
      await vscode.postMessage({
        type: 'insertText',
        text: this.formatForVSCode(formula),
      });
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  getClipboardFormat(): ClipboardFormat {
    return 'latex';
  }
  
  getSettings(): PlatformSettings {
    return {
      autoDetect: true,
      defaultFormat: 'latex',
      supportedFormats: ['latex', 'mathml', 'svg'],
    };
  }
  
  private formatForVSCode(formula: Formula): string {
    if (formula.display) {
      return `$$\n${formula.latex}\n$$`;
    }
    return `$${formula.latex}$`;
  }
}
```

### WPS 适配器

```typescript
// src/plugins/adapters/wps.ts

class WPSAdapter implements PlatformAdapter {
  name = 'wps';
  version = '1.0.0';
  
  detect(): boolean {
    // 检测是否在 WPS 环境
    return !!(window as any).WPS;
  }
  
  async insertFormula(formula: Formula): Promise<InsertResult> {
    try {
      // 通过 WPS API 插入
      const wps = (window as any).WPS;
      const result = await wps.insertFormula({
        latex: formula.latex,
        display: formula.display,
        format: 'omml',
      });
      
      return { success: result.success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  getClipboardFormat(): ClipboardFormat {
    return 'omml';
  }
  
  getSettings(): PlatformSettings {
    return {
      autoDetect: true,
      defaultFormat: 'omml',
      supportedFormats: ['omml', 'mathml', 'png'],
    };
  }
}
```

### 通用剪贴板适配器

```typescript
// src/plugins/adapters/clipboard.ts

class ClipboardAdapter implements PlatformAdapter {
  name = 'clipboard';
  version = '1.0.0';
  
  detect(): boolean {
    return navigator.clipboard !== undefined;
  }
  
  async insertFormula(formula: Formula): Promise<InsertResult> {
    try {
      const text = this.formatForClipboard(formula);
      await navigator.clipboard.writeText(text);
      
      return { 
        success: true, 
        message: 'Formula copied to clipboard' 
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  getClipboardFormat(): ClipboardFormat {
    return 'latex';
  }
  
  getSettings(): PlatformSettings {
    return {
      autoDetect: false,
      defaultFormat: 'latex',
      supportedFormats: ['latex', 'mathml', 'svg', 'png'],
    };
  }
  
  private formatForClipboard(formula: Formula): string {
    switch (formula.format) {
      case 'latex':
        return formula.display ? `$$${formula.latex}$$` : `$${formula.latex}$`;
      case 'mathml':
        return formula.metadata?.mathml || '';
      case 'svg':
        return formula.metadata?.svg || '';
      default:
        return formula.latex;
    }
  }
}
```

## 智能格式选择

```typescript
// src/plugins/smart-selector.ts

class SmartFormatSelector {
  private adapters: Map<string, PlatformAdapter>;
  
  constructor() {
    this.adapters = new Map();
    this.registerAdapter(new ObsidianAdapter());
    this.registerAdapter(new VSCodeAdapter());
    this.registerAdapter(new WPSAdapter());
    this.registerAdapter(new ClipboardAdapter());
  }
  
  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }
  
  /** 检测当前平台 */
  detectPlatform(): PlatformAdapter | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.detect()) {
        return adapter;
      }
    }
    return this.adapters.get('clipboard') || null;
  }
  
  /** 选择最佳格式 */
  selectFormat(
    platform: string,
    formulaType: 'inline' | 'display',
    availableFormats: string[]
  ): string {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      return 'latex';
    }
    
    const settings = adapter.getSettings();
    const preferred = settings.defaultFormat;
    
    if (availableFormats.includes(preferred)) {
      return preferred;
    }
    
    // 回退到 LaTeX
    return availableFormats.includes('latex') ? 'latex' : availableFormats[0];
  }
  
  /** 智能插入 */
  async smartInsert(formula: Formula): Promise<InsertResult> {
    const adapter = this.detectPlatform();
    if (!adapter) {
      return { success: false, error: 'No platform detected' };
    }
    
    // 选择最佳格式
    formula.format = this.selectFormat(
      adapter.name,
      formula.display ? 'display' : 'inline',
      adapter.getSettings().supportedFormats
    );
    
    return adapter.insertFormula(formula);
  }
}
```

## 测试用例

```typescript
// tests/plugins.test.ts

import { ObsidianAdapter } from '../src/plugins/adapters/obsidian';
import { SmartFormatSelector } from '../src/plugins/smart-selector';

describe('Platform Adapters', () => {
  describe('ObsidianAdapter', () => {
    it('should detect Obsidian environment', () => {
      const adapter = new ObsidianAdapter();
      // Mock Obsidian environment
      (window as any).app = { vault: {} };
      
      expect(adapter.detect()).toBe(true);
    });
    
    it('should format inline formula correctly', () => {
      const adapter = new ObsidianAdapter();
      const formula = {
        latex: 'E = mc^2',
        display: false,
        format: 'latex',
      };
      
      expect((adapter as any).formatForObsidian(formula)).toBe('$E = mc^2$');
    });
    
    it('should format display formula correctly', () => {
      const adapter = new ObsidianAdapter();
      const formula = {
        latex: 'E = mc^2',
        display: true,
        format: 'latex',
      };
      
      expect((adapter as any).formatForObsidian(formula)).toBe('$$\nE = mc^2\n$$');
    });
  });
});

describe('SmartFormatSelector', () => {
  it('should detect platform automatically', () => {
    const selector = new SmartFormatSelector();
    // Mock Obsidian environment
    (window as any).app = { vault: {} };
    
    const adapter = selector.detectPlatform();
    expect(adapter?.name).toBe('obsidian');
  });
  
  it('should select best format for platform', () => {
    const selector = new SmartFormatSelector();
    
    const format = selector.selectFormat('obsidian', 'inline', ['latex', 'mathml']);
    expect(format).toBe('latex');
  });
  
  it('should fallback to clipboard when no platform detected', () => {
    const selector = new SmartFormatSelector();
    // Clear any platform detection
    delete (window as any).app;
    delete (window as any).vscode;
    delete (window as any).WPS;
    
    const adapter = selector.detectPlatform();
    expect(adapter?.name).toBe('clipboard');
  });
});
```

## 实施步骤

### 阶段 1：创建适配器接口（1天）

1. 定义 `PlatformAdapter` 接口
2. 创建基础适配器类
3. 添加类型定义

### 阶段 2：实现核心适配器（2-3天）

1. 实现 Obsidian 适配器
2. 实现 VS Code 适配器
3. 实现 WPS 适配器
4. 实现通用剪贴板适配器
5. 预留接口方便加入更多适配器

### 阶段 3：实现智能选择器（1天）

1. 创建 `SmartFormatSelector`
2. 实现平台检测
3. 实现格式选择逻辑
4. 使用局域网服务器或webdev来实现跨设备传送需识别公式照片或公式，使用加密保障信息安全，且加密密码只可以覆盖来保障密码安全

### 阶段 4：测试和集成（1-2天）

1. 编写单元测试
2. 集成测试
3. 用户测试

## 验收标准

1. **平台检测**：正确检测当前平台
2. **格式选择**：选择最佳格式
3. **公式插入**：正确插入公式
4. **错误处理**：优雅处理错误
5. **测试覆盖**：单元测试覆盖率 > 80%
