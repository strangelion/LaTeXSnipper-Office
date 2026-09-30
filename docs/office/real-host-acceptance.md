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
| Word | 8 个公式样例 × 行内/独立行/编号独立行 OLE | 24 | 是 | 24/24 OLE 重新激活，完整载荷一致 | 通过 |
| Word | 绘图、自定义符号 × 3 种版式图片 | 6 | 是 | 6/6 `contentKind`、`editorState` 与 SVG 回读一致 | 通过 |
| PowerPoint | 固定人工样例中的图片/OLE 对象类型和名称 | 4 + 4 | 打开既有文件 | 对象枚举和类型 | 通过 |
| Excel | 固定人工样例中的图片/OLE 对象类型和名称 | 4 + 4 | 打开既有文件 | 对象枚举和类型 | 通过 |
| PowerPoint | 绘图、自定义符号 × OLE/图片 | 2 + 2 | 是 | 4/4 公式 ID、源状态和存储方式一致；OLE 重新激活 | 通过 |
| Excel | 绘图、自定义符号 × OLE/图片 | 2 + 2 | 是 | 4/4 公式 ID、源状态和存储方式一致；OLE 重新激活 | 通过 |

图片模式此前只保存公式 ID 和 LaTeX，不能保证自定义符号或绘图源状态可恢复。
本轮将 PowerPoint/Excel 图片替代文本改为紧凑宿主元数据，保留
`contentKind` 和 `editorState`，但排除 PNG、SVG、EMF 等大二进制字段；真实重开测试已覆盖该修复。

本机生成的三份 JSON 证据摘要如下。它们位于忽略的 `src-tauri/target`
目录，发布验收可以复现后重新生成，不把带绝对路径的临时文件提交仓库。

| 证据 | 记录数 | SHA-256 |
| --- | ---: | --- |
| `word-ole-host-evidence/evidence.json` | 24 | `439136AAEE05987F0F12893D9495F3704731CA173F29E3B4D8E176593C39E5CE` |
| `word-editable-image-host-evidence/evidence.json` | 6 | `CEC956BEB6CD2FD9AACCDBAD2A8E77D17ABE1561EF701BB5027F7A2036A7224B` |
| `office-editable-media-host-evidence/evidence.json` | 4 个宿主组，其中 2 个为新建重开矩阵 | `0AF6DC2AB3DE018F2451590A8D1CAEAFD7FB123F7D260F1724640DC6BF3FAFDB` |

复现命令：

```powershell
& 'C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe' `
  'apps\native-office\LaTeXSnipper.NativeOffice.sln' `
  /t:Build /p:Configuration=Release /p:Platform=x64 /m /v:minimal

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\run-word-ole-host-tests.ps1 `
  -StagingRoot apps\native-office\Installer\output\staging `
  -RunEditableMediaHosts
```

测试脚本会在启动宿主前核对已注册 DLL 与 staging DLL 的 SHA-256，防止
Windows Installer 自修复把旧 OLE 服务器重新注册后产生误判；结束时恢复原注册。

### 尚未关闭的真实宿主项

- 仍需为本轮 DOCX/XLSX/PPTX 输出生成并签入结构化 OOXML 差异摘要；
- Word `SEQ`/`REF` dirty 域在重开后的实际显示值与交叉引用仍需专项验收；
- 批量插入、剪贴板所有权、update/delete、Excel 行列缩放锚定、PowerPoint
  分组/旋转/缩放尚未形成完整真机矩阵；
- x86 Office、不同 DPI/双屏/RDP、macOS/Web 和 WPS 不由本次结果覆盖。

因此本记录证明上述已列场景，不把尚未执行的矩阵推断为“全部稳定支持”。
