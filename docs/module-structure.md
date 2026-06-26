# Module Structure

## 模块划分

```
LaTeXSnipper-Office/
├── modules/                          # 核心模块（独立、可复用）
│   ├── core/                         # 核心模块
│   │   ├── formula-editor/           # 公式编辑器模块
│   │   ├── formula-renderer/         # 公式渲染模块
│   │   ├── formula-library/          # 公式库模块
│   │   └── metadata/                 # 元数据模块
│   ├── services/                     # 服务模块
│   │   ├── ocr/                      # OCR 识别服务
│   │   ├── clipboard/                # 剪贴板服务
│   │   └── export/                   # 导出服务
│   ├── platform/                     # 平台集成模块
│   │   ├── office/                   # Office 适配器
│   │   ├── obsidian/                 # Obsidian 适配器
│   │   ├── vscode/                   # VS Code 适配器
│   │   └── wps/                      # WPS 适配器
│   └── ui/                           # UI 组件模块
│       ├── editor/                   # 编辑器组件
│       ├── library/                  # 公式库组件
│       ├── toolbar/                  # 工具栏组件
│       └── settings/                 # 设置组件
├── apps/                             # 应用层
│   ├── desktop/                      # 桌面应用
│   ├── web/                          # Web 应用
│   └── mobile/                       # 移动应用
├── shared/                           # 共享资源
│   ├── formulas/                     # 公式数据
│   ├── locales/                      # 本地化
│   └── styles/                       # 样式
└── docs/                             # 文档
```

## 模块详情

### 1. Core 模块

#### formula-editor
- **职责**：公式编辑、实时预览
- **依赖**：MathLive
- **接口**：
  - `createEditor(container, options)` - 创建编辑器
  - `setValue(value)` - 设置值
  - `getValue()` - 获取值
  - `on('change', callback)` - 监听变化

#### formula-renderer
- **职责**：LaTeX 转 MathML/OMML/SVG/PNG
- **依赖**：MathJax
- **接口**：
  - `render(latex, options)` - 渲染公式
  - `toMathML(latex)` - 转 MathML
  - `toOMML(latex)` - 转 OMML
  - `toSVG(latex)` - 转 SVG
  - `toPNG(latex)` - 转 PNG

#### formula-library
- **职责**：公式库管理、搜索
- **依赖**：无
- **接口**：
  - `getCategories()` - 获取分类
  - `getFormulas(category)` - 获取公式
  - `search(query)` - 搜索公式
  - `addFormula(category, formula)` - 添加公式

#### metadata
- **职责**：公式元数据管理
- **依赖**：无
- **接口**：
  - `create(latex, options)` - 创建元数据
  - `validate(metadata)` - 验证元数据
  - `serialize(metadata)` - 序列化
  - `deserialize(json)` - 反序列化
  - `migrate(oldMetadata)` - 迁移

### 2. Services 模块

#### ocr
- **职责**：OCR 识别
- **依赖**：Tesseract.js 或远程 API
- **接口**：
  - `screenshot()` - 截图
  - `recognize(image)` - 识别
  - `cancel()` - 取消

#### clipboard
- **职责**：剪贴板操作
- **依赖**：Clipboard API
- **接口**：
  - `copy(text)` - 复制
  - `paste()` - 粘贴
  - `read()` - 读取

#### export
- **职责**：公式导出
- **依赖**：formula-renderer
- **接口**：
  - `exportToFormat(latex, format)` - 导出为指定格式
  - `getSupportedFormats()` - 获取支持的格式
  - `copyToClipboard(latex, format)` - 复制到剪贴板

### 3. Platform 模块

#### office
- **职责**：Office 集成
- **依赖**：Office.js 或 COM
- **接口**：
  - `detect()` - 检测 Office
  - `insertFormula(formula)` - 插入公式
  - `getActiveDocument()` - 获取活动文档

#### obsidian
- **职责**：Obsidian 集成
- **依赖**：Obsidian API
- **接口**：
  - `detect()` - 检测 Obsidian
  - `insertFormula(formula)` - 插入公式
  - `getActiveFile()` - 获取活动文件

#### vscode
- **职责**：VS Code 集成
- **依赖**：VS Code API
- **接口**：
  - `detect()` - 检测 VS Code
  - `insertFormula(formula)` - 插入公式
  - `getActiveEditor()` - 获取活动编辑器

#### wps
- **职责**：WPS 集成
- **依赖**：WPS API
- **接口**：
  - `detect()` - 检测 WPS
  - `insertFormula(formula)` - 插入公式
  - `getActiveDocument()` - 获取活动文档

### 4. UI 模块

#### editor
- **职责**：编辑器界面
- **依赖**：formula-editor, formula-renderer
- **组件**：
  - `FormulaEditor` - 公式编辑器
  - `PreviewPanel` - 预览面板
  - `Toolbar` - 工具栏

#### library
- **职责**：公式库界面
- **依赖**：formula-library
- **组件**：
  - `CategoryTabs` - 分类标签
  - `FormulaGrid` - 公式网格
  - `SearchBar` - 搜索栏

#### toolbar
- **职责**：工具栏
- **依赖**：clipboard, export
- **组件**：
  - `CopyButtons` - 复制按钮
  - `FormatSelector` - 格式选择器
  - `PlatformIndicator` - 平台指示器

#### settings
- **职责**：设置界面
- **依赖**：无
- **组件**：
  - `SettingsPage` - 设置页面
  - `FontSettings` - 字体设置
  - `ExportSettings` - 导出设置

## 模块依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                         UI 层                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ editor  │  │ library │  │ toolbar │  │ settings│       │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘       │
├───────┼────────────┼────────────┼────────────┼─────────────┤
│       │            │            │            │              │
│       ▼            ▼            ▼            ▼              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ formula │  │ formula │  │clipboard│  │  export │       │
│  │ editor  │  │ library │  │ service │  │ service │       │
│  └────┬────┘  └─────────┘  └─────────┘  └────┬────┘       │
│       │                                       │            │
│       ▼                                       ▼            │
│  ┌─────────┐                            ┌─────────┐       │
│  │ formula │                            │ formula │       │
│  │renderer │                            │renderer │       │
│  └─────────┘                            └─────────┘       │
├─────────────────────────────────────────────────────────────┤
│                       Core 层                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   formula   │  │   formula   │  │   formula   │        │
│  │   editor    │  │   renderer  │  │   library   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   metadata  │  │     ocr     │  │  clipboard  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
├─────────────────────────────────────────────────────────────┤
│                    Platform 层                               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ office  │  │obsidian │  │  vscode │  │   wps   │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## 模块接口定义

### Core 模块接口

```typescript
// modules/core/formula-editor/src/types.ts

export interface FormulaEditorOptions {
  container: HTMLElement;
  value?: string;
  displayMode?: boolean;
  fontFamily?: string;
  fontSize?: number;
  onChange?: (value: string) => void;
}

export interface FormulaEditor {
  setValue(value: string): void;
  getValue(): string;
  setDisplayMode(display: boolean): void;
  on(event: 'change', callback: (value: string) => void): void;
  off(event: 'change', callback: (value: string) => void): void;
  destroy(): void;
}

export interface FormulaRenderer {
  render(latex: string, options?: RenderOptions): Promise<RenderResult>;
  toMathML(latex: string): Promise<string>;
  toOMML(latex: string): Promise<string>;
  toSVG(latex: string): Promise<string>;
  toPNG(latex: string): Promise<string>;
}

export interface FormulaLibrary {
  getCategories(): Category[];
  getFormulas(categoryId: string): Formula[];
  search(query: string): SearchResult[];
  addFormula(categoryId: string, formula: Formula): void;
  removeFormula(categoryId: string, formulaId: string): void;
}

export interface MetadataManager {
  create(latex: string, options?: MetadataOptions): FormulaMetadata;
  validate(metadata: FormulaMetadata): ValidationResult;
  serialize(metadata: FormulaMetadata): string;
  deserialize(json: string): FormulaMetadata;
  migrate(oldMetadata: any): FormulaMetadata;
}
```

### Platform 模块接口

```typescript
// modules/platform/office/src/types.ts

export interface PlatformAdapter {
  name: string;
  version: string;
  detect(): boolean;
  insertFormula(formula: Formula): Promise<InsertResult>;
  getClipboardFormat(): ClipboardFormat;
  getSettings(): PlatformSettings;
}

export interface Formula {
  latex: string;
  display: boolean;
  format: string;
  metadata?: FormulaMetadata;
}

export interface InsertResult {
  success: boolean;
  message?: string;
  error?: string;
}

export type ClipboardFormat = 'latex' | 'mathml' | 'omml' | 'svg' | 'png' | 'markdown';

export interface PlatformSettings {
  autoDetect: boolean;
  defaultFormat: ClipboardFormat;
  supportedFormats: ClipboardFormat[];
}
```

## 模块注册

```typescript
// modules/core/formula-editor/src/index.ts

import { FormulaEditor } from './editor';
import { FormulaRenderer } from './renderer';
import { FormulaLibrary } from './library';
import { MetadataManager } from './metadata';

// 模块注册表
const modules = {
  'formula-editor': FormulaEditor,
  'formula-renderer': FormulaRenderer,
  'formula-library': FormulaLibrary,
  'metadata': MetadataManager,
};

export function getModule<T>(name: string): T {
  const ModuleClass = modules[name];
  if (!ModuleClass) {
    throw new Error(`Module "${name}" not found`);
  }
  return new ModuleClass();
}

export * from './types';
```

## 模块测试

```typescript
// modules/core/formula-editor/tests/editor.test.ts

import { describe, it, expect } from 'vitest';
import { FormulaEditor } from '../src/editor';

describe('FormulaEditor', () => {
  it('should create editor', () => {
    const container = document.createElement('div');
    const editor = new FormulaEditor({ container });
    
    expect(editor).toBeDefined();
    expect(editor.getValue()).toBe('');
  });

  it('should set and get value', () => {
    const container = document.createElement('div');
    const editor = new FormulaEditor({ container });
    
    editor.setValue('E = mc^2');
    expect(editor.getValue()).toBe('E = mc^2');
  });

  it('should emit change event', () => {
    const container = document.createElement('div');
    const editor = new FormulaEditor({ container });
    
    let changedValue = '';
    editor.on('change', (value) => {
      changedValue = value;
    });
    
    editor.setValue('x^2');
    expect(changedValue).toBe('x^2');
  });
});
```

## 模块打包

```javascript
// rollup.config.js

import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/index.js',
      format: 'cjs',
    },
    {
      file: 'dist/index.esm.js',
      format: 'esm',
    },
  ],
  plugins: [
    typescript(),
    resolve(),
  ],
  external: ['mathlive', 'mathjax'],
};
```

## 模块文档

每个模块应包含：

1. **README.md**：模块说明、安装、使用示例
2. **API.md**：完整的 API 文档
3. **CHANGELOG.md**：版本更新记录
4. **tests/**：测试用例
5. **examples/**：使用示例
