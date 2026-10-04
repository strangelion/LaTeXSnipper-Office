# Real-host acceptance

## 2026-10-04 TeX 字形、明确颜色与 Word 绘图增量

Office `02f04b8` 的新 release 可执行文件在隔离 WebView2 profile 实测通过：
WASM 编译成功，动态 Function 被 CSP 拒绝，Graphviz 中文、TikZ、PGFPlots、
混合自定义符号和库缩略图可见；控制台错误和请求失败均为空。
TikZ 两个、PGFPlots 二十个 TeX 字形已转成 path，不再依赖私用码位 text。
可执行文件 SHA-256 为
`11C8E8F84BB52090B7038FD44F95CF72E8B3106BE0758E8198C0CD6310430B8B`。
这不是重新安装后的整包验收，也不包含下述明确颜色修复。

真实 Word SVG 图片第一次插入/回读/保存重开通过，但截图只剩蓝色曲线和灰色网格，
黑色坐标文字、边框缺失；不能把该元数据检查结果当成视觉通过。
TeX 输出中的 `fill/stroke=currentColor` 现按 SVG 内部继承色写成明确颜色，默认黑色，
保留显式彩色内容。新增 PGFPlots fixture 和深色像素检查：旧 SVG 负对照被正确拒绝，
新 compile 返回的 SVG（不是预览 DOM 快照）通过真实 Word 图片插入、源状态回读、
保存关闭和重开；黑色刻度、变量和边框经截图人工确认，深色像素 25,718。
请求尺寸为 255.66 × 213.54 pt，实际 Word 对象为 255.65 × 213.70 pt。
截图来自 Range EMF，其右侧页面空白不是图片对象边框，不能用该空白判断对象 extent。
此专项没有验证其他图表、中文字体、OCR 准确率或当前修复的 release WebView2。

该 SVG 的真实 Word OLE 路线仍失败：`AddOLEObject` 返回 `0x800A1066`。
本机 DLL 激活探针成功，安装 DLL 与 staging SHA-256 相同；原生日志证明载荷已读取，
但生成有效 EMF 失败。独立 SVG→EMF 探针明确拒绝 `clipPath`；这是有意的有限能力边界，
不能删除裁剪来冒充正确输出。需保留裁剪语义的支持或明确的 PNG fallback，之后再做
实际 OLE 插入/回读。注册元数据中的 DLL 哈希与磁盘哈希不一致另记为打包一致性待核对，
不把它当成本次插入失败的已证实原因。O-02/G-02 保持进行中。

本地证据位于忽略的 `src-tauri/target/release-acceptance-*/`：

| 文件 | SHA-256 |
| --- | --- |
| 新 release `webview-result.json` | `BBD800E5173F0A725C28201E7222056623253D0DDAE46954F41ADF62CD023CAF` |
| `font-export-compile-artifact/pgfplots-font-independent.svg` | `FAF2B911747875335B04EFBC076020DC991AF666CA577C179DDBABEC183FD946` |
| `word-font-image-compile-artifact/evidence.json` | `A9BAD8915070C59676FAC55F66C3C957F37CFC5FA3B781AD520737E737AA8ABC` |

## 2026-10-04 release WebView2 与真实 Word 管道增量

使用隔离 WebView2 profile 的本地 release 可执行文件（Office 源基线 `fc4ff7a`，
Core `225cf61`），不是重新安装后的发行包。WASM 编译成功且动态 Function 被 CSP
阻止；Graphviz 中文、TikZ 坐标轴、PGFPlots 抛物线安全编译、混合自定义符号及
公式库缩略图通过。三绘图内容边界占 viewBox 比例约 0.862，不能据此证明实际 Word
对象边框正确。此前 TikZ/PGFPlots 输出仍依赖 WebView 内的私用码位字体。

Word 开发加载项首次构建缺少 VSTO manifest，真实管道测试无法加载；使用已有且已
受信任的开发证书重新生成 manifest，没有创建证书或新增信任。安装目录 NativeOffice
仍为旧提交，不能用开发加载项实测替代安装包版本一致性验收。

真实 Tauri release→Word VSTO named pipe：四个分隔符公式扫描、计划和执行最终为
4 转换/0 保留/0 失败，管道阶段 2.318 秒。保存后只读重开四个 OMath，邻接正文保留。
该专项仅行内 OMML，不是 display 段落样式、多样公式准确率或完整剪贴板测试。
前一次已加载的冷运行出现 0/4，原因未确定；增强验证器先输出完整结果再断言，
后续单次通过不能关闭偶发失败/迟到结果风险。

本地证据位于忽略的 `src-tauri/target/release-acceptance-*/`，不提交文档或机器路径：

| 文件 | SHA-256 |
| --- | --- |
| `webview-result-rerun.json` | `1EE70A66E3326C63D816F6932BB9988D433CBF3CC4184702F593E0957A0B53E6` |
| `runtime-provenance.json` | `5DA852FAD4D04CFB58364EE25B5D455B32E84F8827B54A13D666937CEDD3C10B` |
| `word-pipe-diagnostic/pipe-result.json` | `33E9EE826BD70C08CD0489A309FD3F1030E967C7B994D3854F78C786EC81F08E` |
| `word-pipe-diagnostic/reopen-result.json` | `19B7E89210C847C9C4F7311BC2D3155E66B4D95E51BC84DF93BDE36AFE3129AA` |

后续字体修复将应用内已有 WOFF2 的 TeX 字形转为 SVG path，再走 Core 校验，新增
MIT 的 `@pdf-lib/fontkit` 固定依赖（按需加载，压缩前约 626 kB），没有新安装系统字体。
真实 Chromium 的 PGFPlots 导出为 20 字形、零 text/tspan、三种 TeX 字体路径；
脱离字体的 SVG→PNG 导出通过，浅色背景下人工检查数字、负号和变量可读。
此处记录的是首轮浏览器证据；后续 release/Word 增量见上节，仍不能关闭完整 G-02。
证据 `font-export-browser-result.json` SHA-256 为
`0BCDA9E2386D090D88104D6EB88F75E8D371AF8FF8F3DCE26FBD76A955A24250`，
`pgfplots-font-independent.svg` 为
`32A46F506AC71F109EC6E859954E7BCE5A7967C4CA1BBA589428CE7BD520ACE6`。

自动构建、mock、manifest 和 package smoke 不能替代真实宿主。每次 release 必须记录实际打开的宿主、Office/WPS 版本、bitness、操作、save/reopen、undo 和结果。

Windows：Word inline/display/numbered OMML、renumber/reference、real OLE insert/double-click/update/delete、table/two-column/read-only/multiple documents、x86/x64；Excel 和 PowerPoint real OLE 与 image、update/delete、geometry、save/reopen、active document changed；Visio x86/x64 VSTO load、SVG-first/PNG fallback、selection CRUD、copy identity、save/reopen、page context、grouped update rejection。Visio OLE 不在初始验收范围，保持 Experimental/unavailable。

macOS/Web：Word/Excel/PowerPoint manifest load、HTTPS trust、insert/read/update/delete、save/reopen、无 Windows path；PowerPoint Preview API 必须标记 Preview。

WPS：分别打开 Writer、Spreadsheets、Presentation，验证 Ribbon、task pane、host detection、heartbeat、insert/read/update/delete、save/reopen；Writer 额外验证 native math、1x3 numbered layout、renumber 和 cleanup。

在真宿主执行前能力只能标记 Implemented/Automated tested/Beta，不得标记 Stable。本文件的勾选结果应由 release 验收人员更新，不从 CI 推断。

## 2026-09-30 Windows 真机验收记录

### 固定环境

- Office 源码提交：`132ee77d3d9c5b64dd3dc1325b31cb0166c964c6`；
- Windows 11 专业版 `10.0.26200`，64 位；
- Word、Excel、PowerPoint：`16.0.18526.20672`，64 位安装目录；
- NativeOffice MSI 产品版本：`1.7.299`；安装日志以“安装成功或错误状态: 0”结束；
- 已安装 x64 OLE DLL：版本 `1.7.2.0`，655872 bytes，SHA-256
  `D9EDA7D3E2E48F5306907328E60AB9A033B74251D06C1EA4E60B97EF9D52E792`；
- 已安装 x86 OLE DLL：版本 `1.7.2.0`，564736 bytes，SHA-256
  `129460DD9673BA59DEF3042D18453ECE7B12B3852E458DF8E4A10FA2E391D713`；
- 64 位 COM 注册：`HKCU\Software\Classes\CLSID\{B7F5B4AB-5F94-4D87-A29F-9A41D41B3B9F}\InprocServer32`
  指向上述 x64 DLL，`ThreadingModel=Apartment`。

安装日志保留在本机临时目录，SHA-256 为
`680E850CCFC6DAD244460AB651418B416F20511A3D28C4AD7E94C51FCA44CC05`。
日志不提交仓库，因为它包含机器绝对路径；本节保存可核对摘要和哈希。

### 自动化真实宿主结果

| 宿主 | 场景 | 数量 | 保存/关闭/重开 | 编辑载荷回读 | 结果 |
| --- | --- | ---: | --- | --- | --- |
| Word | 26 个 Core OMML 样例 × 行内/独立行/编号独立行 | 78 | 是 | 78/78 OMML 结构、公式 ID 和 LaTeX 一致；最深 32 层积分 | 通过 |
| Word | 8 个公式样例 × 行内/独立行/编号独立行 OLE | 24 | 是 | 24/24 OLE 重新激活，完整载荷一致 | 通过 |
| Word | 绘图、自定义符号 × 3 种版式图片 | 6 | 是 | 6/6 `contentKind`、`editorState` 与 SVG 回读一致 | 通过 |
| PowerPoint | 固定人工样例中的图片/OLE 对象类型和名称 | 4 + 4 | 打开既有文件 | 对象枚举和类型 | 通过 |
| Excel | 固定人工样例中的图片/OLE 对象类型和名称 | 4 + 4 | 打开既有文件 | 对象枚举和类型 | 通过 |
| PowerPoint | 绘图、自定义符号 × OLE/图片 | 2 + 2 | 是 | 4/4 公式 ID、源状态和存储方式一致；OLE 重新激活 | 通过 |
| Excel | 绘图、自定义符号 × OLE/图片 | 2 + 2 | 是 | 4/4 公式 ID、源状态和存储方式一致；OLE 重新激活 | 通过 |

图片模式此前只保存公式 ID 和 LaTeX，不能保证自定义符号或绘图源状态可恢复。
本轮将 PowerPoint/Excel 图片替代文本改为紧凑宿主元数据，保留
`contentKind` 和 `editorState`，但排除 PNG、SVG、EMF 等大二进制字段；真实重开测试已覆盖该修复。

原生 OMML fixture 不再接受手写占位 XML。`prepare-word-native-host-fixture`
先由固定 Core 提交 `57c4b967848fe80a5ad6792285f5af237fec0dba`（转换实现为
`c4dbc2297aa148a20b15bbee598e79e1226af00e`）的
`snipper render --to omml` 生成 26 条临时输入，再交给真实 Word。专项测试还验证：

- 普通 `SEQ LaTeXSnipperEquation` 在 26 个编号公式中按 1～26 连续递增；
- `STYLEREF` + `SEQ ... \\s 1` 章节编号在保存重开后仍显示 `1.1`，且不会被普通连续编号计数器误判；
- 指向编号公式稳定书签的 `REF ... \\h` 在重开后显示 `(1)`，`PAGEREF ... \\h` 显示 `1`；
- 原生公式按 `OMath` 验证，图片/OLE 按 `InlineShape` 验证，避免把三种 Word 对象模型混为一谈。

本机生成的三份 JSON 证据摘要如下。它们位于忽略的 `src-tauri/target`
目录，发布验收可以复现后重新生成，不把带绝对路径的临时文件提交仓库。

| 证据 | 记录数 | SHA-256 |
| --- | ---: | --- |
| `word-native-host-fixture/word-nary-acceptance.generated.json` | 26 | `CC854A39EA9CD4CABC6BF8025466EC07CB82D99AD077A3483DC949B1473B1AF5` |
| `word-native-host-evidence/evidence.json` | 78 | `5E2CDB29769EFC6B07919BA33AB263B9DDAE4DCDD4220F5F2FFDE0AFCF60147B` |
| `word-native-host-evidence/reference-evidence.json` | 1 组 `REF`/`PAGEREF` | `68E81CFC29B645437E67EF71655E38199C323B68C1D5D4AB8812718680DC6D21` |
| `word-native-host-evidence/word-nary-acceptance.docx` | 78 个公式及字段专项 | `AA35F8835127F14B6517CB80E409373A37980BBC3DD1C4A948F32FC9B8C1637A` |
| `word-ole-host-evidence/evidence.json` | 24 | `439136AAEE05987F0F12893D9495F3704731CA173F29E3B4D8E176593C39E5CE` |
| `word-editable-image-host-evidence/evidence.json` | 6 | `CEC956BEB6CD2FD9AACCDBAD2A8E77D17ABE1561EF701BB5027F7A2036A7224B` |
| `office-editable-media-host-evidence/evidence.json` | 4 个宿主组，其中 2 个为新建重开矩阵 | `0AF6DC2AB3DE018F2451590A8D1CAEAFD7FB123F7D260F1724640DC6BF3FAFDB` |
| `docs/office/real-host-openxml-diff-2026-09-30.json` | 5 组 DOCX/XLSX/PPTX 结构化 package 对比 | `B32520B724FE60D5206E1E236F11DC7163E34C8BCF34AD61BB62C4602AE5FAB6` |

结构化 OOXML 报告由 `scripts/summarize-office-openxml.ps1` 直接读取 ZIP
package，不把内容解压到磁盘。报告包含 package 与 changed part 的 SHA-256、
新增/删除/未变化 part、媒体和嵌入对象数量，以及 OMML、`SEQ`、`REF`、
`PAGEREF`、关系和 LaTeXSnipper 元数据标记计数。固定 manifest 明确区分
“仓库验收样例”与“本轮真实宿主证据”，对象数量不同的专项样例不会被误判为
无损同包回转。

复现命令：

```powershell
& 'C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe' `
  'apps\native-office\LaTeXSnipper.NativeOffice.sln' `
  /t:Build /p:Configuration=Release /p:Platform=x64 /m /v:minimal

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\run-word-ole-host-tests.ps1 `
  -StagingRoot apps\native-office\Installer\output\staging `
  -RunEditableMediaHosts

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\prepare-word-native-host-fixture.ps1

& 'apps\native-office\LaTeXSnipper.Word.HostTests\bin\x64\Release\LaTeXSnipper.Word.HostTests.exe' `
  'src-tauri\target\word-native-host-fixture\word-nary-acceptance.generated.json' `
  'src-tauri\target\word-native-host-evidence' `
  --skip-preflight

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\summarize-office-openxml.ps1 `
  -ManifestPath docs\office\real-host-openxml-manifest.json `
  -OutputPath docs\office\real-host-openxml-diff-2026-09-30.json
```

测试脚本会在启动宿主前核对已注册 DLL 与 staging DLL 的 SHA-256，防止
Windows Installer 自修复把旧 OLE 服务器重新注册后产生误判；结束时恢复原注册。

### 尚未关闭的真实宿主项

- 批量插入、剪贴板所有权、update/delete、Excel 行列缩放锚定、PowerPoint
  分组/旋转/缩放尚未形成完整真机矩阵；
- x86 Office、不同 DPI/双屏/RDP、macOS/Web 和 WPS 不由本次结果覆盖。

因此本记录证明上述已列场景，不把尚未执行的矩阵推断为“全部稳定支持”。

## 2026-10-01 Word dirty `SEQ`/`REF` 重算专项

- Office 源码提交：`4cf6d74d45396fbd5b7fc096294b138d7502b516`；
- Windows 11 专业版 `10.0.26200`，64 位；
- Word `16.0.18526.20672`，64 位；
- fixture：Core 生成的 `inline-integral` 原生 OMML；
- 结果：通过。

专项宿主先插入编号公式 1 和目标公式 2，并为目标插入 `REF`/`PAGEREF`。
删除前置公式后，目标 `SEQ` 和 `REF` 在刷新前仍显示陈旧值 `2`；调用与 Word
F9 对应的 `Document.Fields.Update()` 后，两者同步为 `1`，返回值为 `0`。
保存 DOCX、关闭并只读重开后，目标仍为 `1`、`REF` 为 `(1)`、`PAGEREF`
为 `1`。这项证据关闭“仅静态检查字段代码、未证明 Word 实际重算”的缺口。

| 证据 | SHA-256 |
| --- | --- |
| `word-field-refresh-evidence/field-refresh-evidence.json` | `2A1084295E42ED6BE564C817BEA9CE5C33DD5A6251A2890DDF4EF541608185ED` |
| `word-field-refresh-evidence/word-field-refresh-acceptance.docx` | `53A41C9F0E1179F53463E24439BC4062CDBDE16D1FD33445C1627711E27040C6` |

证据保留在忽略的 `src-tauri/target` 目录，可用下列命令重建：

```powershell
& 'C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe' `
  'apps\native-office\LaTeXSnipper.Word.HostTests\LaTeXSnipper.Word.HostTests.csproj' `
  /t:Build /p:Configuration=Release /p:Platform=AnyCPU /m /v:minimal

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\prepare-word-native-host-fixture.ps1

& 'apps\native-office\LaTeXSnipper.Word.HostTests\bin\x64\Release\LaTeXSnipper.Word.HostTests.exe' `
  'src-tauri\target\word-native-host-fixture\word-nary-acceptance.generated.json' `
  'src-tauri\target\word-field-refresh-evidence' `
  --field-refresh
```

本专项只关闭 dirty `SEQ`/`REF` 的 Word x64 重算与重开证据；Ctrl+点击跳转、
公式目录和 x86/多版本 Office 仍按验收清单单独跟踪。

## 2026-10-02 Word 批量转换专项（O-06 部分证据）

同一台 Word x64 上生成 250 段带唯一前后标记的正文，重复使用 Core 的
`inline-integral` OMML，轮换 `$...$`、`$$...$$`、`\(...\)` 和 `\[...\]`。
这验证分隔符扫描和宿主批量替换，不是 250 种公式的准确率测试。

首次实测暴露了段落内裸 `Range.InsertXML(OMML)` 的问题：仅 1 条成功。
正文替换现复用单条原生 OMML 插入及结构回读流程，确认插入成功后才删除原文。
故意在第 126 项放入无效 OMML，以验证失败隔离。

| 检查 | 结果 |
| --- | --- |
| 扫描 / 转换 / 跳过 / 失败 | 250 / 249 / 1 / 0 |
| 无效项原文、所有邻接正文标记 | 保留 |
| 保存、关闭、只读重开 | 249 个 OMath，1 条未转换源公式 |
| Windows 剪贴板序列号 | 转换前后相同 |
| 100 条一批基线 | 总计 286.985 秒，最慢一批 114.519 秒 |
| 25 条一批复测 | 总计 277.524 秒，10 批各 16.218–38.719 秒 |

桌面管道每批由 100 条缩小至 25 条，为现有 120 秒等待上限留出余量。
单条异常慢公式仍可能超时；本测试直接调用原生执行器，不证明管道超时恢复。
末批耗时比首批增长，不能据此线性推算 10,000 条的处理时间。

| 本地证据（`src-tauri/target/word-batch-25-evidence`） | SHA-256 |
| --- | --- |
| `batch-evidence.json` | `B741459813A92D1EBD66FBAEC52052041447EC8B35C071AA79682A67F56E0907` |
| `word-batch-acceptance.docx` | `8DD5DBF48480B39237F1E6C29BD6D915140C7202AA2C44D6CA3A818C6D9B6DFE` |

先按上一节构建宿主测试和 fixture，然后执行：

```powershell
& 'apps\native-office\LaTeXSnipper.Word.HostTests\bin\x64\Release\LaTeXSnipper.Word.HostTests.exe' `
  'src-tauri\target\word-native-host-fixture\word-nary-acceptance.generated.json' `
  'src-tauri\target\word-batch-25-evidence' --batch
```

O-06 仍在进行：实际多格式剪贴板粘贴、管道超时状态核对、页眉/文本框、
display 分隔符对应的段落排版，以及 Excel/PowerPoint 批量矩阵均未由此关闭。

## 2026-10-03 批处理结果关联与等待器回归（O-06）

检查桌面到加载项的完整返回路径时，发现三个 `ThisAddIn` 的批处理分支
没有把原请求的 `requestId` / `sessionId` 写回执行器结果。执行器可以已经
修改文档，但桌面等待器无法匹配空请求 ID，随后仍会报超时。

Word、Excel、PowerPoint 现统一使用 `WithRequestContext`，发送前补齐标识。
共享 C# 测试从真实协议 JSON 反序列化请求，关联执行结果，再序列化为
`BATCH_CONVERT_RESULT`，校验请求、会话、计划标识及计数和失败明细。

生产等待逻辑抽取为 `RequestWaiter.wait_with_reconciliation`。五项 Tokio
运行测试覆盖即时返回（含错误请求 ID 拒绝）、软超时后迟到返回、最终超时、
宽限期断开，以及关闭通道/接收端丢弃；均校验清理后的等待器数量。
测试通过事件触发迟到结果，使用短测试预算；生产预算仍为 120 + 120 秒。

本地验证：Native Office Release 解决方案构建及共享 C# 测试通过；前端
365/365；Rust desktop-full 库测试 129 通过、4 项需实际环境的测试忽略；
Clippy all-targets `-D warnings` 通过，Office 契约检查通过。

这证明协议关联和异步等待行为，不代表实际 Word 管道、长耗时 COM 调用、
整个 10,000 公式矩阵或剪贴板粘贴已经验收。O-06 保持 in progress。

下一步端到端脚本已准备：先启动生产模式 release WebView2（使用独立
`WEBVIEW2_USER_DATA_FOLDER`，CDP 默认 `http://127.0.0.1:9223`），关闭其他
Word 实例，再运行 `scripts/run-word-pipe-batch-smoke.ps1`。脚本创建独立 DOCX，
按精确文档上下文连接 Tauri 的扫描、计划和执行命令，要求四条公式全部返回
确认结果，并实际保存、只读重开，核验四个 OMath 和全部邻接正文标记。
不得将其用于用户现有文档；已有测试 DOCX 不会被覆盖。

本轮 `cargo build --release --locked --manifest-path src-tauri/Cargo.toml
--features desktop-full,tauri/custom-protocol --bin latexsnipper-office` 构建通过。
随后启动程序的命令被当前执行策略拒绝，因此上述端到端脚本和
`scripts/verify-tauri-release-webview.mjs` **本轮未运行**，不能标为通过。
后者已增加 `finally` 恢复原自定义符号库，避免测试夹具覆盖已有符号。
新增脚本的 JavaScript/PowerShell 语法及安全前置条件回归通过；加入两项
测试后，前端全量为 367/367。这些检查不替代尚未运行的真实宿主测试。

## 2026-10-03 Word 故事定位与候选先行替换（O-06 部分验收）

本轮修复四个独立问题：等长独立页眉被误判为重复；用节编号遍历故事链；
页眉/文本框的数字坐标经 `Document.Range` 错落正文；浮动绘图锚点占用 Word
位置但不出现在 `Range.Text`，导致纯文本偏移与实际范围不一致。
扫描现在在指定故事内查找，并同时校验原文和可见前文；Word Find 的 `^` 特殊
字符被转义，长公式仅使用有界查找前缀再校验全文。替换前检查故事边界、原文、
哈希和 OMML，未知定位类型不再退回全文首个匹配；原文仅在候选插入校验成功后删除。

真实 Word `--batch-stories` 专项：正文、两节各自独立的主页面页眉/页脚、
仅第二节存在的首页页眉、浮动文本框共七个公式全部转换；保存只读重开后
各故事均有一个 OMath，邻接文字保留，公式 ID 和七条源/OMML 清单仍可回读。
另覆盖页眉/文本框选区定位、重复公式、Emoji 前文、300 字符公式、多行 display
源的定位，以及三条
无效定位/旧哈希请求不改变文本、公式及段落/字体格式。原始 `WordOpenXML`
会重生成修订/绘图标识，因此拒绝测试按内容和格式语义核对，不按原始字节比较。

250 条正文回归仍为 249 转换、1 故意损坏 OMML 保留、0 执行失败；重开数量、
邻接标记及剪贴板序列检查通过。总时间 328.093 秒，25 条/批 18.136–48.795 秒。
这不是多样公式准确率或性能改善声明。前端 369/369，Native Office Release
解决方案构建和共享 C# 回归通过。后续预处理索引、无分隔符选区及增量更新见
[batch-update-plan.md](batch-update-plan.md)；O-06 保持进行中。

通过的本地证据（生成目录不进入 Git）：

| 文件（`src-tauri/target/` 下） | SHA-256 |
| --- | --- |
| `word-batch-stories-evidence/batch-stories-evidence.json` | `601D7B88D94A86F2CEC0D887F3C66803C19F3B47B656913A121B9EED3152E845` |
| `word-batch-stories-evidence/word-batch-stories.docx` | `BA0B4927CE97F784A00F042D5DDF89C12CA323058EF54664DF6D4F86C220DAA5` |
| `word-batch-stories-body-regression/batch-evidence.json` | `89F2D11F2FEB15A6EB4CB5E9083DE30F7EFAA62048CE3AF4400612CC0A360A77` |
| `word-batch-stories-body-regression/word-batch-acceptance.docx` | `DD9E61CACC825F9AA8D74E0586CD593BAA49728ECAF52AE3A223D7157B9459B7` |

复现命令：

```powershell
& 'apps/native-office/LaTeXSnipper.Word.HostTests/bin/x64/Release/LaTeXSnipper.Word.HostTests.exe' `
  'src-tauri/target/word-native-host-fixture/word-nary-acceptance.generated.json' `
  'src-tauri/target/word-batch-stories-evidence' --batch-stories
```

### 打包 CI 验证（不包含本轮新源码）

`bb268a6` 的普通 CI 全绿但跳过 package smoke。本轮额外运行的
[Main Package Verify 37098619175](https://github.com/strangelion/LaTeXSnipper-Office/actions/runs/37098619175)
在同一提交的 Windows/Linux/macOS 三平台全部成功；Windows 实际证书信任
步骤约 1 秒完成，安装、激活、同版本重装、跨版本升级及卸载步骤也通过。
这关闭了该提交的无人值守证书卡点验证，不替代新源码 CI、实际 Word 加载项 UI
或真实 release WebView2/桌面管道门禁。

## 2026-10-03 无分隔符选区转换（部分验收）

新增“将选区作为 LaTeX”入口：COM Word Ribbon、桌面 Office 工作区及 Office.js
任务窗格。必须先生成预览，再由用户确认；默认全文扫描仍只识别明确分隔符。
当前目标是行内 OMML，不代表 OLE、MathType 或其他格式转换已全部完成。

真实 Word `--selection-latex` 最终专项耗时 5.648 秒：正文、页眉、浮动文本框
三条公式转换，保存只读重开后仍有三个 OMath 和完整 LaTeX/OMML 清单。
分数、上下标、矩阵、多行只读扫描、普通文字/路径/不完整命令拒绝、转换失败保留
格式及陈旧选区不误替换相邻重复公式通过。新增格式保护实测确认不支持的目标和
缺少 OMML 都失败且不改原文。这不是不同公式的转换准确率或批量速度比较。

浏览器专项使用真实 Chrome 和生产编辑器预览，覆盖确认、取消、Escape、390px
窄屏及预览失败禁用确认；宿主响应为夹具，不代表真实桌面管道已验收。
Office.js 的跟踪选区、一次性确认、源文/OOXML 变化拒绝、元数据清理和取消回归
使用模拟 Word API；实际 Office.js Word 宿主未运行，跨宿主矩阵仍待测试。
桌面与 Office.js 生产构建、Native Office Release 解决方案、共享 C# 回归通过；
前端全量 375/375；Office 默认功能配置 `cargo check --lib --locked` 通过。
Core 严格 OMML 源校验 245 项及 1 项文档测试通过；Office 固定到已发布的
`8951224`，对应 Core CI、WASM 和 CodeQL 全部成功。严格校验并不保证所有
已接受 TeX 的排版都能无损转换，尚不支持的自定义宏保持原文并给出失败说明。

通过的证据（本地生成目录不进入 Git）：

| 文件（`src-tauri/target/` 下） | SHA-256 |
| --- | --- |
| `word-selection-latex-final-evidence/selection-latex-evidence.json` | `7C65B8A7DEF461497C09C1DCD1197C76827C7431E7EC58B99B409A4434507BF6` |
| `word-selection-latex-final-evidence/word-selection-latex.docx` | `9398C1F1F6106C86E4F4B988E50EC4E16E0AB2E659C3D578514C94636C1A9125` |

```powershell
& 'apps/native-office/LaTeXSnipper.Word.HostTests/bin/x64/Release/LaTeXSnipper.Word.HostTests.exe' `
  'src-tauri/target/word-native-host-fixture/word-nary-acceptance.generated.json' `
  'src-tauri/target/word-selection-latex-final-evidence' --selection-latex
node scripts/verify-office-selection-conversion.mjs
```

Office 上一提交 `bc2bb51` 的 CI 37111365601 失败于扫描器空 COM catch 的源码
规范门禁，其他必需构建和打包任务成功，不是进程超时。已修正为记录异常；本地
源码规范通过，新提交远端 CI 不以旧提交的成功任务代替。
格式来源/目标选择器、第三方 MathType 边界及原位转换验收已记录于
[batch-update-plan.md](batch-update-plan.md)，O-06 保持进行中。

## 2026-10-03 格式选择器与本应用 OMML/OLE 双向（部分验收）

桌面与 Office.js 新增格式弹窗，COM Word 原有转换 Ribbon 入口指向它。
来源、目标、目标文档及限制可见；预览失败、取消和迟到准备不提交。编辑器 SVG/PNG
导出预览使用同一实际图像，不以另一遍渲染冒充目标。OMML 准备调用 Core 严格源校验。
OLE 写入等待宿主结果，保留原 ID，递增 revision，并回读验证；修复 OLE 内部旧修订号、
插入结果缺少实际 StorageMode，以及候选嵌套导致父控件删除候选的问题。
清单写入读回未通过时保留原范围；提交后读回失败明确报告未知结果，不自动重试。

真实 Word 专项：一个积分语法，行内/行间各一个本应用公式，四次转换；
OMML→OLE 保存重开→OMML 保存重开均通过。ID、LaTeX、显示模式、修订号、
创建元数据及黑色展示样式一致；OLE 自动化对象内 payload 与文档清单一致。
缺少图像预览、陈旧 revision 拒绝且原文/OMath 数量/清单不变。耗时 **7.712 秒**。
这不等于任意公式、字体/复杂样式、跨故事或编号引用已通过。

前端全量 **392/392**，Office.js TypeScript/生产构建、桌面 Vite/WASM/CSP smoke、
Native Office Release、共享 C# 回归和 Rust 严格准备专项通过。
真实 Chrome 覆盖目标切换使旧预览失效、确认/取消/Escape、预览失败、迟到清理、
390px 浅/深主题；浏览器宿主调用是夹具，不代替真实管道或 Office.js 宿主。

当前明确限制：裸选区仅行内 OMML；编辑器 OLE 新插入继续走既有 Office 插入路线；
图像和 LaTeX 导出副本不改文档；编号原位转换、MathType/MTEF、无源对象、真实
Tauri 管道与实际 Office.js Word 宿主继续待验收。Word 手工修改但未同步源的核对
属于后续预处理索引门禁，不能由清单 revision 校验推断已覆盖。

本地证据（`src-tauri/target/`，不进入 Git）：

| 文件 | SHA-256 |
| --- | --- |
| `word-format-conversion-evidence/format-conversion-evidence.json` | `26278C9CA654088C7FE700A50139D082A1C33EC579D98A79BAE025974B143221` |
| `word-format-conversion-evidence/ole-stage.docx` | `68AB73230D1122A50CE00BD67B9FD9B24C6B8ADB17D6E3FE779ED6F5EF78657D` |
| `word-format-conversion-evidence/native-stage.docx` | `DCF90636F4E7357D943339AEB292C89338F1D729C81D2A0D2723EA4DCC0CF0CE` |

```powershell
node scripts/verify-office-format-conversion.mjs
& 'apps/native-office/LaTeXSnipper.Word.HostTests/bin/x64/Release/LaTeXSnipper.Word.HostTests.exe' `
  'src-tauri/target/word-native-host-fixture/word-nary-acceptance.generated.json' `
  'src-tauri/target/word-format-conversion-evidence' --format-conversion `
  'output/playwright/office-format-conversion/inline-integral-render.json'
```

Office CI 修复提交 `6649175` 的 [CI 37115718227](https://github.com/strangelion/LaTeXSnipper-Office/actions/runs/37115718227)
已成功：修正资源合约的 Core gitlink pin。该结果不代表本轮新增转换源码的 CI 也已完成。

## 2026-10-04 Word 批量分阶段计时与拒绝诊断（部分验收）

环境核对：Windows 11 `10.0.26200`、Office `16.0.18526.20672` x64。
源码基线 `a638df9` 加本节对应的采集/保护改动；由 Core `1d151a1` 的 CLI
重新生成 OMML 夹具。该 Core 提交与 Office 固定的 `225cf61` 相比仅改测试和文档，
不改变渲染实现。生成夹具 SHA-256 为
`7366643A2FC5370BCE4FCC10D0AE831890F745FB0FD6D55B27C00FFBD87FFF39`。

测试创建自己的新 Word 实例/文档，结束后关闭；没有替换用户文档或改注册表。
四种分隔符混合扫描，但转换目标统一为行内 OMML；不是 display 排版验收。
一个积分语法重复 25/250 次，每个文档向一项注入非 OMML XML。结果如下：

| 规模 | 转换 / 保留 / 执行失败 | 总时间 | 保存只读重开 | 完整 payload / ID / 邻接正文 | 剪贴板序列 |
| --- | --- | --- | --- | --- | --- |
| 25 | 24 / 1 / 0 | 17.247 秒 | 通过 | 通过 | 未变化 |
| 250 | 249 / 1 / 0 | 232.841 秒 | 通过 | 通过 | 未变化 |

保存前/重开后分别核对公式和内容控件数量、唯一 ID、LaTeX、OMML、存储/显示模式，
再比较按 ID 排序的完整 payload 快照。拒绝项报告 `OMML_MATH_MISSING` 且原文保留。
没有取消逐目标插入读回、提前删除原源或去掉失败回滚。

250 条阶段累计：

| 阶段 | 调用次数 | 秒 |
| --- | ---: | ---: |
| 候选执行（含定位及下列嵌套阶段） | 250 | 220.019 |
| 插入总计（含 scratch/读回/样式/清单） | 249 | 207.795 |
| scratch 创建与复制 | 249 | 181.220 |
| 插入读回校验 | 249 | 11.287 |
| 清单写入 | 249 | 11.128 |
| 原源删除 | 249 | 0.718 |
| 源/OMML 检查 | 250 | 0.101 |

另测扫描 6.508 秒、最终文档核对 2.539 秒、保存 0.168 秒、重开并核对 3.106 秒。
嵌套计时有重叠，不能将表中全部值相加。10 个 25 条批次的时间范围为
12.121–34.552 秒，nearest-rank 批次 P95 为 34.552 秒；不是逐公式 P95。
scratch 约占候选执行总计 82%，作为下一步复用设计的证据，不是已实现的优化。
没有冷/热配对、峰值内存测量、实际 Core 逐项转换或桌面管道/字段刷新计时，
不与旧报告直接比较宣传加速，也不提供多样公式准确率。

共享计时器测试覆盖返回值、失败异常身份、失败计数、独立快照、嵌套与无效输入。
OMML 校验新增数学节点存在性保护及 6 项结构回归，不代表完整 XSD 验证。
Word 批处理保留源变化、OMML、插入/读回与宿主异常原因，不再全部归为定位失败。
同批跨故事复测耗时 8.369 秒，七处正文/页眉/页脚/文本框公式及清单保存重开通过；
3 项无效定位/哈希请求拒绝且原内容/格式保留。
Native Office Release 构建、共享 C# 回归、前端 392/392、源码规范和协议生成检查通过。
现有可空类型编译警告未在本批清除。

失败记录也保留：最初 250 条运行在 149/1/0 后因错误的计时次数断言停止；
另一次 25 条运行在插入读回阶段额外拒绝一项（23/2/0），旧通用错误未能确定原因。
计时断言已区分尝试和提交；后续诊断与 25/250/跨故事复测通过，但偶发拒绝仍待
重复/故障注入定位，不能宣称已修复。这两次失败不进入成功统计。

本地证据（`src-tauri/target/` 下，不提交机器路径、文档或二进制）：

| 文件 | SHA-256 |
| --- | --- |
| `word-batch-timing-25-diagnostic-20261004/batch-evidence.json` | `D6AC3BE58AA14BD8137024E2B069DBE155CB3923B35BD7EE91FA1A539674299B` |
| `word-batch-timing-25-diagnostic-20261004/word-batch-acceptance.docx` | `788D08988C1418ACA2A11A61D820C93B106DED2A771DE02696132FE53EA95615` |
| `word-batch-timing-250-final-20261004/batch-evidence.json` | `8EA9693DD011C2723BB54852E1633EF3B8059768B52D98C368FC4DA7381F9D31` |
| `word-batch-timing-250-final-20261004/word-batch-acceptance.docx` | `8E63F995E36CCBE67C722C628C857666D68563251EC63154DF8DFE865BF89467` |
| `word-batch-stories-timing-regression-20261004/batch-stories-evidence.json` | `16240707FEEAE5E04BBF0DBA07E2FCD28102CD598459DE45A6DDC53708B05E28` |
| `word-batch-stories-timing-regression-20261004/word-batch-stories.docx` | `E43CDAC49BE3589D499756BF0724BD160E9B4D4897817FA41B87DB6BFC5B78B3` |
| `word-batch-timing-20261004/batch-evidence.json`（断言失败） | `A0ED0F6FB4EC75B5BA5D87F77F81144D0B884F01848FFC54882CDA98350E7FDA` |
| `word-batch-timing-25-20261004/batch-evidence.json`（额外拒绝） | `74E9A97AD368A165B976295EE763246EED385C5AA2D7C47EA3186339CCC0F06C` |

复现（生成夹具后使用新证据目录）：

```powershell
node scripts/prepare-word-native-host-fixture.mjs
& 'apps/native-office/LaTeXSnipper.Word.HostTests/bin/x64/Release/LaTeXSnipper.Word.HostTests.exe' `
  'src-tauri/target/word-native-host-fixture/word-nary-acceptance.generated.json' `
  'src-tauri/target/word-batch-new-evidence' --batch 250
```

`--batch [count]` 接受 25–10,000，默认 250。能配置数量不代表 1,000/10,000 条已测。
O-06、完整 OLE/图片矩阵、真实桌面管道和 Office.js 宿主验收均保持进行中。

### 同日 scratch 内层采集与临时 COM 引用清理

源码基线 `f67055b` 加本节对应改动，使用上文同一 Core 夹具和环境。
保留原有逐目标读回、失败候选回滚和 scratch 段落精确清理；结束时释放本流程
持有的临时范围/控件，不释放调用方文档、目标范围或返回的真实控件。
三个新内层计时记录失败尝试，测试核对次数与有限非负耗时。

25 条结果为 24 转换、1 故意损坏项保留、0 执行失败，19.427 秒；完整 payload、
唯一 ID、邻接正文及保存只读重开通过，剪贴板序列不变。scratch 总计 12.702 秒，
XML 插入 1.797 秒、控件查找 1.507 秒、公式复制 0.083 秒；其余约 9.315 秒
尚未单独归因，可能涉及范围探测、控件包装及清理，但未测量，不能当作已证实原因。
这是补充诊断和生命周期清理，不是 scratch 复用或性能提升验收。

最终源码的跨故事复测为 7 转换、0 保留、0 失败，8.501 秒；3 项无效定位/哈希请求
拒绝且原内容/格式保留，保存重开通过。前一批源码另外连续三轮 25 条测试均为
24/1/0（21.221、16.882、18.026 秒），完整 payload 重开和剪贴板检查通过。
这些通过记录不关闭上文原因未知的额外拒绝风险，也不将前一批 250 条结果归于
新增清理后的源码；本次没有重新执行 250 条或完整 OLE/图片矩阵。

### 2026-10-04 Word 多文档目标专项

源码基线 `9a82f75` 加本节对应改动；使用本地重新编译的 Word 适配器与
HostTests，创建测试专属 Word 实例和两份不同目录中的 `same-title.docx`。
运行前拒绝已有 Word 进程，不操作用户已有文档。

结果通过：两份同名文件保留不同文档上下文，枚举不切换活动文档；明确选择后
激活目标且选区所属文档一致。另存为后的旧标识、已关闭目标和只读目标均拒绝，
拒绝不切换当前可写文档；回读源内容未修改。测试结束关闭测试文档和实例。

本地证据 `src-tauri/target/document-targets-acceptance-82962e28734c4ccaac6516eb730785b2/document-targets-evidence.json`，
SHA-256 `31BB9251E0761714E46C84CA79BB4D991E5973F789B875ADFB24F0E0F0F66F0E`。
复现使用新目录：

```powershell
& 'apps/native-office/LaTeXSnipper.Word.HostTests/bin/x64/Release/LaTeXSnipper.Word.HostTests.exe' `
  'apps/native-office/LaTeXSnipper.Word.HostTests/fixtures/word-tex-drawing-acceptance-v1.json' `
  'src-tauri/target/word-targets-new-evidence' --document-targets
```

共享 C#/Rust wire 专项及真实 Chromium 弹窗刷新/只读/旧预览失效、取消迟到响应、
窄屏浅深色通过。浏览器宿主回调是夹具，本专项证据明确 `pipeVerified=false`；
未通过实际新加载项/Tauri 管道或安装包，也未覆盖关闭后同一路径重开的实例身份。
Excel/PowerPoint/Visio 全文档枚举、Office.js 实际宿主和 OLE/图片矩阵继续保持未关闭。

| 本地证据文件（`src-tauri/target/` 下） | SHA-256 |
| --- | --- |
| `word-batch-scratch-phases-20261004/batch-evidence.json` | `08C46C4FEB359C5607A7EF294C664EC4DC07B1C2979623B211A40EB9638C78A6` |
| `word-batch-scratch-phases-20261004/word-batch-acceptance.docx` | `57C99B8F95EAF174C8270090D341976F28311EA5CF211778259077E326544118` |
| `word-batch-stories-scratch-phases-20261004/batch-stories-evidence.json` | `099E8F9EA2A4FD3A739A0AEE011B015A83C332A5154B876EEDCC79A706271822` |
| `word-batch-stories-scratch-phases-20261004/word-batch-stories.docx` | `E558879F82BEB5F45A9255808133D4B64799666FD7A7E9CA6D11B806417DAB18` |
| `word-batch-timing-stability-20261004-1/batch-evidence.json` | `DE4279105A345B41C73770652E757A382E10F121385658E2C1C88ABA560E6323` |
| `word-batch-timing-stability-20261004-2/batch-evidence.json` | `0001D6E1F941D04A85CA23EB97A0F5259E76BBCF6344205233D2AFF47C91B883` |
| `word-batch-timing-stability-20261004-3/batch-evidence.json` | `522E5B779BC608D2352DD81AA7DFAF810C885B6E6A9BB92E10815E704408D622` |

该后续源码提交 `07a7ea9` 的 [CI 37183115211](https://github.com/strangelion/LaTeXSnipper-Office/actions/runs/37183115211)
已全部成功，包含源码/协议、原生矩阵、COM 激活和 Windows 包检查。
上一轮 `f67055b` 在新提交触发后按 `cancel-in-progress` 取消，不是源码编译失败；
不能将其 cancelled 或 gate 失败计为本轮通过，也不由 CI 包检查关闭真实 GUI/宿主矩阵。

## 2026-10-05：裸选区真实 SVG/PNG/OLE 原位转换专项

使用独占测试 Word、生产浏览器渲染的一条行内积分与严格 Core OMML，三种目标分别
插入真实图像/OLE 对象，确认实际格式、源清单和 OLE payload 后删除指定原范围。
每种目标都有重复源文本，验证仅指定一处替换且周围文字及另一处源保留；陈旧 hash、
零尺寸和损坏 PNG 拒绝且保留原文。三种对象保存重开后按 ID 及选区回读通过。
最终专项耗时 3.6033072 秒；仅单语法三路线，不是准确率或通用性能基准。

严格相邻位置校验实测发现 Word 的 SDT 开始标记占一位置，候选内容范围必须恰为
原范围末尾 +1，不能接受任意更后位置。先前严格比较失败的运行未计入通过。
生产 SVG 已将继承 paint 固化为颜色；上一轮 PDF 转 PNG 目视确认三种公式可见。
最终 PDF 保留供复查。尺寸记录揭示 OLE 尚有显示尺寸差异：请求 33.2284×14.5730 pt，
SVG 实际 33.20×14.30、PNG 33.20×14.65、OLE 47.50×22.00 pt，尺寸一致性门禁仍开放。

最终证据位于忽略目录 `src-tauri/target/selection-media-final-8c9d3c38d7c341f9bbe0f7c1a40897a3/`：

| 文件 | SHA-256 |
| --- | --- |
| `selection-media-evidence.json` | `B399003821443B00C647207D11D67BE764650E1E7FC180A7FF378C0EB0953DF3` |
| `selection-media.docx` | `8C9F1479AE16D4AF23409C64D913F207D54D654EBF7750B9D71710CB73676B6A` |
| `selection-media-visual.pdf` | `646FE2A39C127423EB0BD1A66FB060A8349B2A5413706727AE4CCE4047C49DFF` |

明确 `pipeVerified=false`：这是 Word 适配器真实对象专项，不是已安装新加载项/Tauri
端到端验收。Office.js 生产 taskpane 的完整批量按钮浏览器测试使用模拟 Office API，
覆盖启动、确认前不写、取消释放范围、重复公式、代码排除、进度及 390px CSS/CSP；
不能替代真实 Office.js Word、混排/多故事或 10000 条语料验收。
