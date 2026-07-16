# Microsoft Office 集成

LaTeXSnipper 同时提供 Windows Native Office 与跨平台 Office.js 两条集成路径。两者共享公式语义、Bridge 转换接口和公式标识，但不会为了跨平台而降低 Windows 的 VSTO/COM/OLE 能力。

## 平台标识与路由

| 标识 | 含义 | 支持范围 |
| --- | --- | --- |
| `office-native` | VSTO + 双位数 COM/OLE | 仅 Windows |
| `office-web` | Word、Excel、PowerPoint Office.js | Windows、macOS、Office on the web |
| `office-hybrid` | Native 与 Office.js 同时安装 | 仅 Windows |
| `office` | 操作系统默认值 | Windows 路由到 `office-native`；macOS 路由到 `office-web`；其他系统返回 unsupported |

显式选择 `office-native` 不会在 macOS 上静默降级。`office-hybrid` 安装中，如果 Native 已成功而 Office.js 失败，结果会报告 `partial` 并保留已经可用的 Native 集成。

## 运行架构

Office.js task pane 只调用受限的本地 HTTPS Bridge：

- `POST /api/office/convert/v1`：`latex -> omml/png/svg` 或 `omml -> latex`；
- `POST /api/office/heartbeat`：区分网页已加载与桌面 Bridge 已连接；
- 请求最大 256 KiB，渲染等待上限 15 秒；
- Bridge 仅监听 loopback，并限制允许的 Office 来源；
- Office.js 不访问本地文件系统，也不暴露任意命令执行接口。

Word 使用 OMML；Excel 和 PowerPoint 使用 Bridge 生成的 PNG。失败会返回结构化错误，不会退化成 `$...$` 纯文本公式。

## Word Office.js 公式生命周期

公式由带稳定 `formulaId` 的 SDT/content control 承载，完整元数据存放在命名空间 `https://latexsnipper.com/office/formula/1` 的 custom XML part 中。

当前插入与替换向 `insertOoxml()` 传递 run-level 或 block-level 的局部 SDT fragment，以避免行内公式额外创建段落。自动化 mock 只能验证生成结构和失败回滚；Windows、macOS 与 Word on the web 对该局部 fragment 的真实接受行为仍是发布前宿主测试项。如果任一宿主拒绝局部 fragment，必须改用不引入额外正文段落的最小 Flat OPC package。

- Insert：LaTeX 转 OMML 后插入新公式；复制后以“新建”操作插入会获得新 ID。
- Load：优先读取 custom XML 元数据；旧文档依次回退到 OMML 反向转换和文本读取。
- Update：保留原 `formulaId`，替换公式内容与 owned metadata。
- Delete：删除公式 SDT，并删除属于该公式的 custom XML part。
- Reference：编号公式创建 `LSNEq_<formulaId>` 稳定书签，可插入 Word `REF ... \\h` 字段。

## 学术编号布局

支持 inline、display 和 numbered 三种模式。

- inline 仅使用 run-level SDT，不改变所在段落对齐、缩进、字体或样式；
- display 只对公式自身段落设置居中、间距与 keep 属性；
- numbered 使用无边框、固定布局、全宽 1×3 表格，左右列等宽、公式居中、编号右对齐；
- 字段包含 `begin/instrText/separate/result/end` 完整结构；
- Office.js Word 的全局编号使用命名序列 `SEQ LaTeXSnipperEquation`；章节编号支持 `2.1` 与 `2-1`，通过 `STYLEREF` 与按标题级别重启的 `SEQ` 组成；
- 表格单元格、分栏和普通正文均使用局部布局，不修改 Normal、Heading 或文档默认字体。

编号字段的显示值由 Word 更新。文档合并或大范围移动后，应执行 Word 的“更新域”；书签随公式移动，但手工删除书签会使已有 REF 字段失效。

## Excel 与 PowerPoint Office.js

Excel 在当前 worksheet 插入 PNG shape。ExcelApi 1.10 支持插入；选择、读取、替换和删除使用官方 `getActiveShapeOrNullObject`，要求 ExcelApi 1.19。能力报告会严格区分这两档。

PowerPoint 图片插入使用 Preview/Beta `addPicture` API。读取与删除要求 PowerPointApi 1.10 的 metadata 属性；只有运行时实际暴露 `addPicture` 时才启用插入与替换。该路径仍为 Beta，不作为稳定生产能力宣传。

PowerPointApi 没有在所有目标版本中可靠暴露当前幻灯片尺寸，因此初始位置采用固定 36 pt inset，而不假设 720×540 页面；替换时保留原 shape 的位置与尺寸。Office.js 不创建 OLE，也不冒充 Windows Native 能力。

## Windows Native Office

Word/Excel/PowerPoint VSTO 继续使用现有 Native 插入路径。Visio Windows Desktop 使用独立 VSTO 的 SVG-first vector shape 路径；PNG 是显式 fallback，OLE 仍为 Experimental/unavailable。Visio 不属于本项目的 Office.js 宿主。详细边界见 [Visio Native 集成](office/visio-native-integration.md)。OLE server 新增 `SetDisplayExtentHimetric(LONG cx, LONG cy)`：

- natural extent 始终来自 EMF presentation；
- host 计算 display extent 并显式写回 server；
- server 更新 container extent、标记 dirty，并发送布局/视图通知；
- PowerPoint 写回后重新读取验证，在容差外才使用 natural extent，并返回结构化 fallback reason；
- shape 尺寸最后与 server display extent 同步。

Word Native 编号目前只使用全局 `SEQ LaTeXSnipperEquation`。每个编号 OLE 使用独占空段落，按实际正文、分栏或表格单元格宽度设置局部 center/right tab stop，并让 ContentControl 连同段落标记拥有前导 Tab、OLE、编号字段和 Bookmark；删除公式会同时移除该专属段落及其 tab stop，不修改用户段落。重包装失败会恢复单字符 OLE 所有权并让插入失败，不会以成功状态留下无主公式。章节点号和章节连字符 profile 目前只由 Office.js Word 提供。

## 安装与状态

Windows Office.js manifest 通过每宿主 WEF 注册项安装并写入 refresh marker；macOS 分别写入 Word、Excel、PowerPoint sandbox container 的 `Data/Documents/wef/LaTeXSnipper.xml`。安装会验证 add-in ID 与 host declaration，修复 owned manifest，但保留无关 WEF 文件。

状态必须分别理解：

- installed：manifest/VSTO/OLE 文件与注册状态可验证；
- trusted：生产证书链可信；本地自动生成证书仅用于开发；
- connected：Office task pane 的 heartbeat 能连接正在运行的 Bridge；
- loaded：需要在真实 Word/Excel/PowerPoint/Visio 中确认 add-in 启用和 UI 可见。

开发构建：

```powershell
npm --prefix apps/office-addin ci
npm run build:office-addin
npm run build:native-office
```

## 验证矩阵

| 平台/宿主 | 自动化覆盖 | 仍需真实宿主验证 |
| --- | --- | --- |
| Windows Word Native | VSTO 编译、manifest hash、C# tests、x86/x64 OLE tests、MSI/Bootstrapper | 插入/编辑/删除、编号重排、表格/分栏、安装后加载 |
| Windows Excel Native | VSTO 编译、OLE extent 与打包 | 真实 workbook 插入/替换及缩放 |
| Windows PowerPoint Native | VSTO 编译、显式 extent、双位数 OLE | 不同比例 slide 的插入/替换/移动后持久化 |
| Windows Visio Native | VSTO 编译、protocol v3、metadata/placement/rollback tests、manifest/package hash | x86/x64 Visio 中安装加载、SVG/PNG、选择 CRUD、保存重开与页面切换 |
| Office.js Word | TypeScript build、metadata/OOXML DOM tests、协议 schema | Windows、macOS、Web 中的真实 SDT/custom XML/REF 行为 |
| Office.js Excel/PowerPoint | 官方 typings、requirement-set 测试、宿主接口 mock、禁止纯文本 fallback | ExcelApi 1.19 真机行为；PowerPoint Preview `addPicture` 与 metadata 生命周期 |
| macOS WEF | fake HOME 三宿主安装/修复测试 | 真机 sandbox、证书信任与宿主加载 |
| Linux | Rust 路由测试返回 unsupported | 无桌面 Microsoft Office 支持 |

当前自动化不能替代真实 Office GUI。发布前必须用受支持的 Office 版本完成 Word、Excel、PowerPoint、Visio 安装/加载与文档往返测试，并使用正式代码签名证书重新构建安装器。
