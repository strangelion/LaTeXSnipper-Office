# Excel / PowerPoint 图片替换事务

更新：2026-10-09。修正旧 AlternativeText 覆盖新源码，以及旧图形过早删除的路径。

图片更新先要求唯一目标、请求 ID 与载荷 ID 相同、名称/元数据身份不冲突。
捕获旧对象真实属性，不用猜测值替代读取失败。候选设置新的源码/编辑状态，并验证位置、
尺寸、旋转、翻转、可见性、纵横比锁定与 Excel Placement；不恢复旧 JSON 到新对象。
完整清单载荷记录实际 `image` 模式，调用者的 `auto` 不被修改。

新清单先暂存并回读；原 part 与暂存内容、旧对象及其唯一性再次核对后，才删除旧对象、验证旧宿主 ID 消失，
将候选恢复到目标名称/层级，再完成清单提交。层级恢复不是只向后移动一次。
加载项直接使用本次请求返回的结构化结果，传播错误和实际模式，不读共享的迟到状态。

## 失败边界

- 删除旧对象前，可证明的候选和清单回滚，不修改旧对象。
- Add 没返回对象、清单回滚未证实，或已发出旧对象删除调用后发生异常：保留可用候选及载荷，
  返回 `HOST_IMAGE_REPLACE_STATE_UNCERTAIN`，不盲删、不自动重试。
- 候选清理未证实：返回 `HOST_IMAGE_REPLACE_ROLLBACK_UNVERIFIED`。
- 图片 AddPicture 的执行状态可能不明，不因异常自动改用另一种图片格式。
- OLE 更新异常也不再自动删除对象后换成图片；完整 OLE 更新/回滚/清单闭环仍开放。

## 已取得的证据

隐藏 x64 Excel / PowerPoint 16.0，使用自编 PNG 载荷及直接适配器调用：

- 重复清单、错误根节点、错误 PNG、请求 ID 不匹配、复制 ID 歧义及名称/元数据冲突均拒绝，旧对象/原清单保留。
- 候选尺寸设置被宿主拒绝时，本次候选清理，旧图形/源码/清单不变。
- 正常更新为 `y^3`，修订/编辑状态与完整 payload 核对通过，旧 AlternativeText 不再覆盖更新。
- 位置、指定新尺寸、旋转、两种翻转及多对象层级核对通过；保存重开后源码/载荷仍一致。
- Excel 原单元格文字及另一公式记录保留，剪贴板序列未变。

共享故障测试覆盖创建、设置、验证、清单 Add/回读、原对象变化、删除前后抛错、名称/层级
提交、清单提交及清理失败，确认不可逆阶段不删除最后的新候选。全套 Shared.Tests
warnings-as-errors、433 项前端、源码卫生、package-resources 通过；真实 Word 清单安全回归通过。
VSTO 项目仍有原有 nullable 警告。

复现入口：SampleHostTests 的 `--image-replacement`；Shared.Tests 的 `--image-replacement`。

| `src-tauri/target/` 下的忽略证据 | SHA-256 |
| --- | --- |
| `image-replacement-final-986519b5a8e34818bc789648df9e6d3d/cross-host-manifest-evidence.json` | `934cd6c791327b74cc37c5d30002ca99c173a51a24562af92f780fe9a7889e23` |
| `image-word-regression-51d01ea00409410b8113bdebea775cb6/manifest-safety-evidence.json` | `95779b7d8ec4d1976748c40e1a13deedee2c4270b18c5015e07ca90c5ed1d67b` |

`pipeVerified=false`。没有把自编 PNG 的元数据一致性称为 LaTeX 到图像准确率。
SVG 全矩阵、任意裁切/图片效果/样式字体、OLE 故障、安装版管道、跨请求修订门禁、x86、DPI/RDP
及吞吐性能未由此关闭；新增 COM 核对成本不能宣称提速。清单删除/读入和格式迁移继续推进。
