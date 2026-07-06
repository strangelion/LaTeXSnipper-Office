# Architecture - Rust + Tauri

> ⚠️ 状态：历史设计（非当前实现规范）。目录树和模块划分与实际仓库不同。
> 当前实现请参阅 `docs/STATUS.md`。

## 技术栈

| 层级 | 技术 | 职责 |
|------|------|------|
| 核心逻辑 | Rust | 公式渲染、OCR、元数据管理 |
| WebView 容器 | Tauri 2.0 | 跨平台桌面+移动端 |
| 前端 UI | HTML/CSS/JS | 公式编辑器、公式库、设置 |
| 公式渲染 | MathJax (WASM) | LaTeX 转 SVG/MathML |
| 公式编辑 | MathLive | WYSIWYG 公式编辑 |

## 平台支持

| 平台 | 状态 | 说明 |
|------|------|------|
| Windows | ✅ | Tauri 原生支持 |
| Linux | ✅ | Tauri 原生支持 |
| macOS | ✅ | Tauri 原生支持 |
| iOS | ✅ | Tauri 2.0 支持 |
| Android | ✅ | Tauri 2.0 支持 |

## 项目结构

```
LaTeXSnipper-Office/
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs              # 入口
│   │   ├── lib.rs               # 库入口
│   │   ├── commands/            # Tauri 命令
│   │   │   ├── mod.rs
│   │   │   ├── formula.rs       # 公式相关命令
│   │   │   ├── ocr.rs           # OCR 命令
│   │   │   ├── metadata.rs      # 元数据命令
│   │   │   └── export.rs        # 导出命令
│   │   ├── core/                # 核心逻辑
│   │   │   ├── mod.rs
│   │   │   ├── renderer.rs      # 公式渲染
│   │   │   ├── font.rs          # 字体处理
│   │   │   └── metadata.rs      # 元数据管理
│   │   ├── ocr/                 # OCR 模块
│   │   │   ├── mod.rs
│   │   │   └── recognizer.rs    # 识别器
│   │   └── platform/            # 平台适配
│   │       ├── mod.rs
│   │       ├── clipboard.rs     # 剪贴板
│   │       └── integrations.rs  # 平台集成
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                          # 前端代码
│   ├── index.html               # 入口 HTML
│   ├── main.js                  # 入口 JS
│   ├── modules/                 # 前端模块
│   │   ├── editor/              # 公式编辑器
│   │   │   ├── index.js
│   │   │   └── editor.js
│   │   ├── library/             # 公式库
│   │   │   ├── index.js
│   │   │   └── data.js
│   │   ├── renderer/            # 渲染预览
│   │   │   └── index.js
│   │   └── ui/                  # UI 组件
│   │       ├── toolbar.js
│   │       └── settings.js
│   ├── styles/                  # 样式
│   │   ├── main.css
│   │   ├── editor.css
│   │   └── library.css
│   └── vendor/                  # 第三方库
│       ├── mathlive/
│       └── mathjax/
├── formulas/                     # 公式数据
│   ├── _index.json
│   ├── greek.json
│   ├── structures.json
│   └── ...
├── locales/                      # 本地化
│   ├── zh.json
│   └── en.json
├── icons/                        # 图标
├── Cargo.toml                    # 工作空间配置
└── README.md
```

## Rust 核心模块

### 公式渲染器

```rust
// src-tauri/src/core/renderer.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderOptions {
    pub display: bool,
    pub formats: Vec<RenderFormat>,
    pub dpi: u32,
    pub font_scale: f64,
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RenderFormat {
    MathML,
    SVG,
    PNG,
    OMML,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderResult {
    pub latex: String,
    pub display: bool,
    pub mathml: Option<String>,
    pub svg: Option<String>,
    pub png: Option<String>,
    pub warnings: Vec<String>,
}

pub struct FormulaRenderer {
    // MathJax WASM 实例
}

impl FormulaRenderer {
    pub fn new() -> Self {
        Self {}
    }

    pub async fn render(&self, latex: &str, options: &RenderOptions) -> Result<RenderResult, String> {
        // 调用 MathJax WASM 渲染
        todo!()
    }

    pub async fn to_mathml(&self, latex: &str, display: bool) -> Result<String, String> {
        todo!()
    }

    pub async fn to_svg(&self, latex: &str, display: bool) -> Result<String, String> {
        todo!()
    }

    pub async fn to_png(&self, latex: &str, dpi: u32) -> Result<String, String> {
        todo!()
    }
}
```

### 字体处理器

```rust
// src-tauri/src/core/font.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FontStyle {
    TeX,
    Roman,
    Bold,
    Italic,
    BoldItalic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontSettings {
    pub color: String,
    pub style: FontStyle,
    pub scale: f64,
    pub family: String,
}

pub struct FontHandler;

impl FontHandler {
    pub fn apply_font_style(latex: &str, style: &FontStyle) -> String {
        match style {
            FontStyle::TeX => latex.to_string(),
            FontStyle::Roman => format!("\\mathrm{{{}}}", latex),
            FontStyle::Bold => format!("\\mathbf{{{}}}", latex),
            FontStyle::Italic => format!("\\mathit{{{}}}", latex),
            FontStyle::BoldItalic => format!("\\bm{{{}}}", latex),
        }
    }

    pub fn apply_color(latex: &str, color: &str) -> String {
        if color == "#000000" || color.is_empty() {
            return latex.to_string();
        }
        format!("\\color{{{}}}{{{}}}", color, latex)
    }

    pub fn calculate_scale(base: f64, user: f64, context: f64) -> f64 {
        let scale = base * user * context;
        scale.max(0.1).min(10.0)
    }
}
```

### 元数据管理

```rust
// src-tauri/src/core/metadata.rs

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormulaMetadata {
    pub schema_version: u32,
    pub identity: FormulaIdentity,
    pub latex: String,
    pub display_mode: DisplayMode,
    pub numbering_mode: NumberingMode,
    pub number_text: String,
    pub render_engine: RenderEngine,
    pub font: FontSettings,
    pub size: SizeSettings,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormulaIdentity {
    pub document_id: String,
    pub equation_id: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DisplayMode {
    Inline,
    Display,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NumberingMode {
    None,
    Auto,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RenderEngine {
    MathJaxSVG,
    MathJaxPNG,
    NativeOMML,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SizeSettings {
    pub natural_width: f64,
    pub natural_height: f64,
    pub scale_factor: f64,
}

impl FormulaMetadata {
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if self.identity.document_id.is_empty() {
            errors.push("document_id is required".to_string());
        }
        if self.identity.equation_id.is_empty() {
            errors.push("equation_id is required".to_string());
        }
        if self.latex.is_empty() {
            errors.push("latex is required".to_string());
        }
        if self.font.scale <= 0.0 || self.font.scale > 10.0 {
            errors.push("font scale must be between 0 and 10".to_string());
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    pub fn migrate_from_v1(old: &serde_json::Value) -> Self {
        // V1 -> V2 迁移逻辑
        todo!()
    }
}
```

### Tauri 命令

```rust
// src-tauri/src/commands/formula.rs

use tauri::command;
use crate::core::{renderer::FormulaRenderer, font::FontHandler, metadata::FormulaMetadata};

#[command]
pub async fn render_formula(
    latex: String,
    display: bool,
    formats: Vec<String>,
) -> Result<serde_json::Value, String> {
    let renderer = FormulaRenderer::new();
    let options = RenderOptions {
        display,
        formats: formats.into_iter().map(|f| f.parse().unwrap()).collect(),
        dpi: 192,
        font_scale: 1.0,
        theme: "light".to_string(),
    };

    let result = renderer.render(&latex, &options).await?;
    Ok(serde_json::to_value(result).unwrap())
}

#[command]
pub async fn apply_font_style(
    latex: String,
    style: String,
) -> Result<String, String> {
    let font_style = match style.as_str() {
        "tex" => FontStyle::TeX,
        "roman" => FontStyle::Roman,
        "bold" => FontStyle::Bold,
        "italic" => FontStyle::Italic,
        "bold_italic" => FontStyle::BoldItalic,
        _ => return Err("Invalid font style".to_string()),
    };

    Ok(FontHandler::apply_font_style(&latex, &font_style))
}

#[command]
pub async fn validate_metadata(
    metadata: FormulaMetadata,
) -> Result<serde_json::Value, String> {
    match metadata.validate() {
        Ok(()) => Ok(serde_json::json!({ "valid": true, "errors": [] })),
        Err(errors) => Ok(serde_json::json!({ "valid": false, "errors": errors })),
    }
}
```

## 前端调用 Rust

```javascript
// src/modules/editor/editor.js

import { invoke } from '@tauri-apps/api/tauri';

export class FormulaEditor {
    constructor(container) {
        this.container = container;
        this.init();
    }

    async init() {
        // 初始化 MathLive 编辑器
        // ...
    }

    async renderFormula(latex, display = false) {
        const result = await invoke('render_formula', {
            latex,
            display,
            formats: ['svg', 'mathml'],
        });
        return result;
    }

    async applyFontStyle(latex, style) {
        const result = await invoke('apply_font_style', {
            latex,
            style,
        });
        return result;
    }

    async validateMetadata(metadata) {
        const result = await invoke('validate_metadata', {
            metadata,
        });
        return result;
    }
}
```

## 构建和打包

```bash
# 开发
cargo tauri dev

# 构建桌面版
cargo tauri build

# 构建 iOS
cargo tauri ios build

# 构建 Android
cargo tauri android build
```

## 优势

1. **Rust 性能** - 核心逻辑高性能
2. **Tauri 跨平台** - 一套代码多端运行
3. **体积小** - Tauri 打包体积远小于 Electron
4. **内存安全** - Rust 保证内存安全
5. **原生体验** - WebView 渲染，原生系统集成
