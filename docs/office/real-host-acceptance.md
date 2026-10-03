# Real-host acceptance

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
