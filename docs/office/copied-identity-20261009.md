# Excel / PowerPoint 复制公式身份

更新：2026-10-09。关闭直接适配器下已验证的 PNG 复制身份与清单一致性问题，不代表全部复制/迁移路线完成。

## 实现

从选中对象的实际 Parent 链绑定工作簿/演示文稿，不根据之后的活动文档提交清单。
按文档范围枚举对象；复制件、旧式标识或缺少清单的新文档来源通过共享事务取得独立 ID。
先准备并回读清单，再验证对象快照和库存、写入名称/替代文本，验证唯一性后提交。
原条目不重写；调用方 payload 不原地修改。只有完整紧凑元数据相同才从原清单补回二进制 render。
跨文档只有源码时保留源码和编辑状态，不借用或伪造缺失的图片数据。

失败只有在对象恢复和清单回滚均可证明时才回滚；提交开始或恢复不确定时返回
`HOST_IDENTITY_STATE_UNCERTAIN`，保留现有数据，不自动重试。只读文档可读取已有唯一来源，
不能自动修复复制身份。多对象选区拒绝，不悄悄采用第一件。
旧式 v3 指针必须有唯一有效 ID、匹配名称和严格清单来源，不再返回空源码冒充成功。
加载项将身份错误绑定到原请求返回，不因吞错让客户端等待到超时。

## 验证

- 隐藏 x64 Excel/PPT 16.0 的真实 `Shape.Duplicate`：复制件新 ID、原件身份/布局不变，完整匹配来源保留，重复读取稳定。
- 错误根清单拒绝且两个对象不变；保存重开后两条清单和对象一致，唯一来源在只读重开中可读。
- 另一个自建文档中的 PNG + 紧凑源码转移：实际对象所属文档提交，缺失 binary 不伪造。这不是 OS 剪贴板跨文档 Copy/Paste 测试。
- Shared.Tests warnings-as-errors 全套通过；故障覆盖 Add/回读/准备状态/对象写入前后/恢复/提交前后、源码冲突、ID 冲突、库存变化及旧式引用歧义。
- 433 项前端和所有 agent contracts、源码卫生通过；隐藏 Word 清单安全回归通过。
- VSTO 项目仍有原有 nullable 警告。本地 NativeOffice staging 来自旧提交，完整打包校验按 provenance 拒绝；不把该暂存包宣称为本次发布产物。

复现入口：Shared.Tests 和 Office.SampleHostTests 的 `--copied-identity`。

| `src-tauri/target/` 下的忽略证据 | SHA-256 |
| --- | --- |
| `copied-identity-final-fd39ff65e6814b00a51d706329da8241/copied-identity-evidence.json` | `ba9f755cc11679b6152b3aeb1ecd6915ecc0a203301decdf5e687d12f66d7259` |
| `copied-identity-word-regression-4dfd9738babf4332a00774db32cf03ee/manifest-safety-evidence.json` | `95779b7d8ec4d1976748c40e1a13deedee2c4270b18c5015e07ca90c5ed1d67b` |

`pipeVerified=false`，剪贴板序列未改变。真实 OLE 身份写回/名称受限兼容、Word 复制、
安装版请求全链路、跨文档 Copy/Paste、所有分组/跨页/跨表与宏并发矩阵仍开放。
不宣称图片与 LaTeX 视觉准确率、综合转换性能或完整格式迁移。
