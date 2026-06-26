# LaTeXSnipper Office

独立的 LaTeX 公式编辑器和插入工具，支持 Office、Obsidian、WPS、VS Code 等多平台。

## 技术栈

- **核心逻辑**: Rust (高性能、内存安全)
- **WebView 容器**: Tauri 2.0 (跨平台桌面+移动端)
- **前端 UI**: HTML/CSS/JavaScript
- **公式编辑**: MathLive (WYSIWYG)
- **公式渲染**: MathJax (LaTeX 转 SVG/MathML)

## 平台支持

| 平台 | 状态 | 说明 |
|------|------|------|
| Windows | ✅ | Tauri 原生支持 |
| Linux | ✅ | Tauri 原生支持 |
| macOS | ✅ | Tauri 原生支持 |
| iOS | ✅ | Tauri 2.0 支持 |
| Android | ✅ | Tauri 2.0 支持 |

## 功能特性

- **独立运行**: 不依赖 LaTeXSnipper 桌面应用程序
- **公式编辑**: MathLive WYSIWYG 编辑器
- **公式库**: 2100+ 公式，18 个分类
- **多种格式**: LaTeX、MathML、SVG、PNG
- **字体处理**: 自定义字体样式、颜色、缩放
- **元数据管理**: 完整的公式元数据支持
- **跨平台**: 一套代码多端运行

## 项目结构

```
LaTeXSnipper-Office/
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── commands/             # Tauri 命令
│   │   └── core/                 # 核心逻辑
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                          # 前端代码
│   ├── index.html
│   ├── main.js
│   └── styles/
├── formulas/                     # 公式数据
├── modules/                      # 模块化组件
├── docs/                         # 文档
└── README.md
```

## 快速开始

### 安装依赖

```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装 Node.js 依赖
npm install

# 安装 Tauri CLI
cargo install tauri-cli
```

### 开发

```bash
# 启动开发服务器
cargo tauri dev
```

### 构建

```bash
# 构建桌面版
cargo tauri build

# 构建 iOS
cargo tauri ios build

# 构建 Android
cargo tauri android build
```

## 文档

- [架构设计](docs/architecture.md)
- [模块结构](docs/module-structure.md)
- [字体修复计划](docs/font-fix.md)
- [元数据规范化](docs/metadata.md)
- [多平台集成](docs/multi-platform.md)
- [公式库整合](docs/formula-library.md)
- [实施计划](docs/implementation.md)

## 已安装的 Skills

| Skill | 用途 | 状态 |
|-------|------|------|
| `web-development` | Web 前端开发规范 | ✅ |
| `ah-rust-pro` | Rust 编程最佳实践 | ✅ |
| `nextjs-to-tauri` | Tauri 2 桌面/移动端打包 | ✅ |

## 许可证

MIT License
