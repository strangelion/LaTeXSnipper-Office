# Word 数组列布局与源读入

更新：2026-10-10。当前 Core pin `beff6a8a775453a512b847057ba44f21cac92376`。

## 已验证范围

隐藏 x64 Word 16.0 使用生产 `WordAdapter` 插入 Core CLI 生成的 OMML。
11 个自编样例分别通过行内、显示、编号三种入口，共 33 项：
逐列左/中/右对齐、重复列规格、短行补空、嵌套数组、外层定界符、分式内数组、注释伪边界、字面字符、
命名嵌套定界符、不可见侧和同时/显式分组上下标。
插入后及 `.docx` 保存/只读重开后，列组展开、行/单元格数、数学文字和源码身份均一致，边界文字保留。
比较展开后的列组，允许 Word 合并相邻相同对齐列，不要求原 XML 字面完全相同。
新增定界符 glyph 与脚本/操作数祖先结构比较，插入及重开均验证；缺省圆括号与显式不可见侧区分。

新增 `--array-columns` 隐藏宿主专项及源码 fixture；测试不触碰现有 Word 文档，不修改注册表/信任。
Core 新列规格分别保存在数学内容之外，相关有限映射边界见
[Core 数组报告](https://github.com/strangelion/latexsnipper-core/blob/main/docs/formats/array-column-layout.md)。

## 真实故障与修复

首轮编号数组读入被 `HOST_IDENTITY_TARGET_CHANGED` 拒绝。
两次已规范化的实际 Word XML 长度一致，差异仅为 `w:tr` 的 `w:rsidTr`：
连续导出编号布局表格会生成不同修订戳。
将这一已观察修订属性加入原有 rsid 白名单，未取消内容/载体/布局/身份门禁。
不忽略一般属性、表格尺寸、数学列对齐或公式内容。

指纹反例覆盖表格宽度、列对齐、数学文字和未知属性变化仍不相等。
以数组 fixture 为输入的原生/auto/PNG/受管 SVG 复制身份专项复测通过；
原记录保留、模糊读入拒绝、写标签后故障恢复、只读重开和单独删除复制件仍通过。
编号/OLE 复制与跨故事迁移仍不由本轮关闭。

## 证据与检查

产物位于忽略的 `src-tauri/target/`，不提交本机路径或测试文档。

| 产物 | SHA-256 |
| --- | --- |
| `array-columns-20261009-01/fixture.generated.json` | `927058bd6909e9d4c5e2ffd2d28db4851bc1df1499d9b457d91b919117918450` |
| `array-columns-20261009-bound/array-column-evidence.json` | `3dfcf85c5148f0da9991a12d5f6c1d9162993fb2f80f8485a4959e5e9d02eb0f` |
| `array-copy-20261009-01/word-copied-identity-evidence.json` | `888fa6848796453e541349796740582d82f5e3b09986569ce3dc8a8b3fd820db` |
| `comment-arrays-20261009-04/fixture.generated.json` | `9c5b15a9f32381b0f7e907cc9db8acc09b0675cc01bcaea1634fe42d3f281bce` |
| `comment-arrays-20261009-07/array-column-evidence.json` | `2d512991c785ee21654921af3a60ec8f20aafabc1e20abdb05d7f604d0b55414` |
| `comment-copy-20261009-02/fixture.generated.json` | `6804c16ef1e2ab9dc508f5ce391a1d7b5158941f59173d059e79f19be11278c0` |
| `comment-copy-20261009-02/evidence/word-copied-identity-evidence.json` | `888fa6848796453e541349796740582d82f5e3b09986569ce3dc8a8b3fd820db` |
| `scalable-arrays-20261010-01/fixture.generated.json` | `5cd496fa17ce5a620b662c2178fde4f3f2b153860ef3357fe355795932e2300e` |
| `scalable-arrays-20261010-01/evidence/array-column-evidence.json` | `9cccb1709469ad280fc91666b36caaa3ce67b664be279c012e2c295f5fa7974f` |

前三项为 Core `61a9136` 的历史 18/18 验收；comment 四项绑定 `dfbc1ac`，为历史 24/24 验收。
最后两项绑定当前 Core，数组证据包含 33/33 计数及每例预期/实际布局、数学文字、源码和定界符/脚本结构检查。
复制专项输出只包含通用布尔检查，绑定本轮输入须同时查看上列 fixture 哈希，不能仅用相同输出哈希识别数据集。
MSBuild 宿主构建、共享 C# 全套（warnings-as-errors）、前端 433 项、源码卫生、协议生成检查、
桌面 Rust 默认功能 `cargo check --locked` 通过。VSTO 原有 nullable 警告未据此宣称清零。

本地安装 staging 为旧提交，来源一致性门禁明确拒绝；未改 provenance 绕过，也未升级安装载荷。
本轮是直接生产适配器结构验收，不是安装版 Ribbon/Tauri 管道、Word 截图/字体观感、所有 DPI、x86 或完整 array 排版验收。

后续 CI `37917588642` 的资源契约失败确认是 `contracts/resources.v1.json` 漏同步 Core SHA，
不是冻结缺失或进程超时。修复提交 `a5a802f` 的远端 CI 已通过；本地契约改为同时比较暂存 gitlink 与实际检出，
避免旧 HEAD 掩盖待提交的 pin 不一致。资源文件哈希检查和未初始化子模块的延迟检查保持不变。

## 注释与字面字符回归

新增样例首次读入触发 `HOST_IDENTITY_NATIVE_SOURCE_CONFLICT`，实际 XML 表明 Word 将
同一单元格中数学属性一致的 `α`、`x` 相邻 run 合并为 `αx`，并未改变数学文字。
文本身份比较允许这一局部合并，仍区分数学对象、操作数/单元格路径与数学 run 属性。
反例覆盖改字、数学样式改变及分子/分母、数组单元格、数学对象间移动文字；结构、布局和快照门禁未取消。

同时发现 Core 文本命令中的 `&` 被重复编码；Core `dfbc1ac` 改为只从原始文本编码一次，
并对六种文本命令增加精确实体断言。最终 Word 回归使用新生成的 fixture，不沿用旧二进制或旧输出。
原生/auto/PNG/受管 SVG 复制专项改用含百分号、字面反斜杠和注释控制词的样例也通过。
源码及修复前后的诊断 XML 留在忽略产物中，不将机器路径写入仓库。

后续 CI `37951657835` 的 Rust 库测试仍期待 XML→LaTeX 输出裸 `&`，与新的字面字符保护契约不符。
更新断言为转义 `\&`，保留空白、Unicode、非法实体拒绝，并补百分号与字面 `\frac` 不误成活动分式的回归。
没有删除测试或放宽转换门禁；本地同一 `cargo test --locked --lib` 命令通过（Windows 147 项，另 5 项需手动环境）。
修复提交 `92f6e2e` 的远端 CI `38011285941` 已通过。

## 可伸缩定界符与脚本回归

Core `beff6a8` 的常用命名/嵌套/不可见定界符和组合脚本修复通过新生成的 11 例 fixture 进入真实 Word。
包含尖括号外层数组、分母方括号、floor/norm、单侧竖线、外层及数组单元格上下标、显式 `{x_i}^2` 与尾部表达式。
33 项插入、保存/只读重开均通过，原始源码和数学文字保持，定界符 glyph、脚本类型和相关祖先结构未变化。
Core 详细支持/拒绝范围见 [定界符报告](https://github.com/strangelion/latexsnipper-core/blob/main/docs/formats/scalable-delimiters.md)。
资源清单 SHA 与暂存 gitlink 同步；源码卫生、协议、资源契约、前端 433 项、桌面 Rust 库 147 项通过。
这不是 Word 图片/字体观感或安装版加载项验收，也没有关闭高级 array、middle 或固定大小定界符。

## 复现

先用 `scripts/prepare-word-native-host-fixture.mjs` 将
`apps/native-office/LaTeXSnipper.Word.HostTests/fixtures/word-array-columns-v1.json`
转换为生成 fixture，再构建并运行 `LaTeXSnipper.Word.HostTests.exe <生成 fixture> <新证据目录> --array-columns`。
使用独立 Word 测试会话，运行前关闭用户 Word；产物目录应为空，避免覆盖已有证据。
