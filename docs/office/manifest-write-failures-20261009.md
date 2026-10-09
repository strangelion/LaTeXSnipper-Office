# Word 清单写入失败传播

更新：2026-10-09。默认整份清单写入路径的安全修正，不是增量试点启用或性能提速声明。

`FormulaDocumentManifest.Write(Word.Document, payload)` 不再吞掉写入异常。读取只接受唯一
本应用 part；损坏 XML、错误根节点、重复目标 ID 或未知扩展 ID 冲突拒绝，不以空清单覆盖。
保留原清单的其他条目、注释、空白及命名空间绑定；最大 32 Mi 字符、深度 64，禁用 DTD/外部实体。

新清单先添加并回读完整内容，旧 part 身份及内容仍与快照一致时才移除旧 part，
之后再核对唯一的新 part。失败只能清除可证明由本次操作新增且未变化的 part。
一旦删除旧 part 的调用已经发出，或 Add 抛错而没有返回对象，执行状态可能不明确；
保留现有 payload、返回 `MANIFEST_STATE_UNCERTAIN`，不猜测删除或自动重试。

原生行内/显示公式在元数据失败时移除明确的新候选并返回失败，批量执行器保留原 LaTeX。
OLE 写入失败也进入已新增的候选清理分支；图片/SVG 原有回滚接收真实异常。
本记录的 Word 范围之外，Excel/PowerPoint `WriteEntry` 后续已接入相同验证替换路径，
见 [跨宿主提交记录](cross-host-manifest-20261009.md)。清单删除/读入及完整格式迁移事务仍开放。

## 验证

共享故障测试：添加前/后异常、回读不一致、原清单变化、删除旧 part 前/后抛错；
确认失败不会冒充成功，也不会在不确定状态删除唯一可用 payload。另覆盖损坏/DTD/深度、
旧 ID、重复/未知 ID、更新替换及扩展的 QName 命名空间保留。
复现：构建 Shared.Tests，运行 `LaTeXSnipper.Shared.Tests.exe --manifest-replacement`。

真实 x64 Word `16.0.18526`：默认和试点路线的重复 part/错误根节点拒绝；默认行内原文
完全保留，显示公式新候选移除、原文字保留。25 项固定 `x^2` 批次为 24 项成功、1 项保留、
0 项失败，独立 ID、完整 payload、保存重开和剪贴板核对通过。SVG 源绑定、保存重开、
行内更新及过期载体保护回归通过，`pipeVerified=false`。

| 忽略目录中的证据 | SHA-256 |
| --- | --- |
| `manifest-failure-final-3208241bcfbb4a898151ddae59e27218/manifest-safety-evidence.json` | `95779b7d8ec4d1976748c40e1a13deedee2c4270b18c5015e07ca90c5ed1d67b` |
| `manifest-failure-ca1b10cb5c54420d8884cfe671aa1190/batch/batch-evidence.json` | `b75a40eda4e432146c93483df81a02672752c20da1a5104bc2c013581061012a` |
| `manifest-failure-final-3208241bcfbb4a898151ddae59e27218/svg/managed-svg-evidence.json` | `3d32c61252c29943728c85b03b01bfddce1c729fa9344bf7f73907739033b309` |

证据位于 `src-tauri/target/`。这不是安装版 Ribbon/管道、x86、多 DPI、真实 OLE 失败注入
或所有格式性能/准确率验收。以往清单性能快照不包含本次增加的验证，不能沿用为新版本测速。
