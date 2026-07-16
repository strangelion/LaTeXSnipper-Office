# LaTeXSnipper Office — 当前实现状态

> 本文档只描述 **已实现** 的内容和已知限制。  
> 计划/路线图内容请移步 `docs/roadmap.md`（TODO）。

---

## 协议

| 项目 | 状态 |
|------|------|
| `core-protocol/command.schema.ts` | ✅ 10 个 command，TS 类型定义 |
| `core-protocol/command.schema.json` | ✅ JSON Schema — 单一真源 |
| `core-protocol/command.router.ts` | ✅ 注册 + 分发逻辑 |
| C# `CommandMessage.cs` / `ICommandHostAdapter` | ✅ 镜像 TS schema，Word/Excel/PPT 实现 |
| 代码生成（Schema → TS / C#） | ❌ 未实现，手动同步 |
| C# Pipe 传输层 | ⚠️ 新 `CommandMessage`/`ICommandHostAdapter` 已定义，但 Pipe 仍使用 legacy `DesktopMessage`；稳定功能由旧协议提供 |

## 宿主支持

| 宿主 | 当前状态 | 已知限制 |
|------|----------|----------|
| Word (Office.js) | 🧪 OOXML 插入，Bridge 转换 | 局部 SDT fragment 尚需 Windows/macOS/Web 真实宿主验证 |
| Excel (Office.js) | 🧪 PNG shape 插入（ExcelApi 1.10） | 完整选择/读取/替换/删除要求 ExcelApi 1.19 |
| PowerPoint (Office.js) | 🧪 PNG shape Beta | 图片插入要求 Preview `addPicture`，metadata 生命周期要求 PowerPointApi 1.10 |
| WPS 文字 | ✅ OMath 插入 + BuildUp | PPT/表格未实现 |
| WPS 演示 | ❌ 明确拒绝（返回错误） | manifest 已移除声明 |
| WPS 表格 | ❌ 未实现 | manifest 已移除声明 |
| VSTO Word | ✅ Named Pipe，OMML 插入 | 签名依赖开发证书 |
| VSTO Excel | ✅ SVG 图片插入 | 公式 ID 保持不完整 |
| VSTO PowerPoint | ✅ SVG 图片插入 | 形状位置保持不完整 |
| VSTO Visio | 🧪 SVG-first shape + PNG fallback | Beta；x86/x64 真实 Visio 尚待验收，OLE Experimental/unavailable |
| Obsidian | ✅ Markdown `$...$` / `$$...$$` | 仅桌面端；编号为内存变量，重启后归零；不作为稳定功能 |

## Bridge 服务端口

| 端口 | 服务 | 协议 | 用途 |
|------|------|------|------|
| **19876** | Office Web Bridge | HTTPS (自签 TLS) | Office.js 静态文件托管 + LaTeX↔OMML 转换 API |
| **19877** | LaTeXSnipper Desktop Bridge | HTTP | 公式转换/渲染核心 API（由 Tauri 桌面应用提供） |
| **Named Pipe** | VSTO Native Office | - | Word/Excel/PPT 通过 Named Pipe 与桌面应用通信 |

**设计说明**：`19876` 是 Office.js 宿主要求的 HTTPS 端点（需要 TLS），`19877` 是统一的 HTTP Bridge 端口，服务于 WPS、浏览器扩展、Obsidian 插件、VS Code 扩展等生态插件。`Named Pipe` 用于 VSTO 原生 Office 插件的本地通信。

## CI / 发布

| 项目 | 状态 |
|------|------|
| Tauri 桌面端构建 (Win/Mac/Linux) | ✅ `build-all.yml` |
| VSTO Native Office 构建 | ✅ `build-native-office.yml` |
| WPS 插件打包 | ✅ `build-wps-plugin.yml` |
| Obsidian 插件构建 | ✅ `build-obsidian-plugin.yml` |
| 统一发布 | ✅ `build-all.yml`（6 并行 job → 汇聚 → Release） |
| Office Web Add-in 构建 | ✅ `build-all.yml` 中 `office-addin` job |
| NSIS 组合安装器 | ⚠️ 需 CI runner 安装 makensis |
| VSTO 代码签名 | ✅ 固定自签名证书 `VSTO_CERT_BASE64`/`VSTO_CERT_PASSWORD` |
| release-manifest.json | ✅ CI 产出 |

## 安装方式

| 组件 | 安装方式 | 自动/手动 |
|------|----------|-----------|
| Tauri 桌面应用 | MSI / NSIS / DMG / DEB / RPM | 自动 |
| VSTO Native Office | `LaTeXSnipper.NativeOffice.exe` 引导程序 | 自动（需 UAC） |
| WPS 插件 | `install.bat` → 复制到 jsaddons + publish.xml upsert | 手动双击 |
| Obsidian 插件 | 复制到 vault 的 `.obsidian/plugins/` | 手动 |
| Office.js Add-in | Tauri 内嵌 Bridge 自动启动，注册表配置 | 自动 |

> **Office 安装说明**：设置页"Office 集成"按钮实际安装的是 VSTO COM 加载项。
> Office.js Add-in 由 Tauri 桌面应用 Bridge (19876) 自行托管和启动，不经过此安装流程。

## 测试

| 项目 | 状态 |
|------|------|
| core-protocol schema 单元测试 | ✅ `schema-validate.mjs` 在 CI 中执行（文本匹配级别） |
| Adapter command coverage 测试 | ❌ 未实现 |
| Office manifest schema validation | ❌ 未实现 |
| WPS package file-list / hash 测试 | ❌ 未实现 |
| Obsidian plugin build / typecheck | ✅ CI 中执行 |
| VSTO compile / sign verification | ⚠️ 编译在 CI 中，签名依赖证书 |
| Windows clean-machine 回归测试 | ❌ 未实现 |
| E2E 宿主测试清单 | ✅ `docs/TESTING.md` |

> **占位命令说明**：`DetectTable`、`FormatContent` 在 Office Adapter 中为占位返回，
> 不应视为真实功能。Excel/PPT 的公式插入为文本降级（`$...$` / `$$...$$`），
> `display: "numbered"` 未实现。详见能力矩阵。
