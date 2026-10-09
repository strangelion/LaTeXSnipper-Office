# 清单删除、严格读入与只读诊断

更新：2026-10-09。关闭默认清单删除吞错和部分危险诊断路径；不是完整格式迁移验收。

## 实现边界

共享 Word/Excel/PowerPoint 清单删除先暂存新 part 并回读，再删除旧 part，沿用身份/内容快照
和执行状态检查。目标不存在时不写新 part。坏 XML、错误根、重复 part/ID、未知扩展 ID 冲突
拒绝，不清空或覆盖旧清单。失败传播；不能证明回滚时保留现有内容并返回不确定状态。

显式宿主对象删除也先准备清单，再验证对象身份/内容和清单未变化，删除后核对对象消失，
最后提交清单。Excel/PPT 校验文档范围的目标唯一性；选区删除要求单一目标。清单与对象
绑定同一工作簿/演示文稿/Word 文档，加载项不再根据之后的 ActiveDocument 重复清理。
已发出对象删除调用后失败返回 `HOST_DELETE_STATE_UNCERTAIN`，不当作完全未修改自动重试。

读入只接受唯一 part；XML 限制 32 Mi 字符/深度 64，禁用 DTD/外部实体。
payload 使用有界规范 Base64、严格 UTF-8/JSON；重复顶层属性或载荷 ID 不匹配拒绝。
只有没有 payload 节点的旧条目才投影为 legacy 公式，损坏/空 payload 不伪造为普通条目。
`ReadAll` 不返回一半结果并冒充成功，未知扩展不当作公式。

诊断默认只读，失败或部分枚举不称为一致，不进行孤儿清理；重复对象 ID 阻止修复。
PowerPoint 正确枚举 Slides，不再套用 Excel 的 Sheets。Word 包含故事范围/页眉，图形扫描
包含受限深度的分组；修复仅通过显式参数请求，计数只增加已完成的删除。

Word 删除内容指纹保留实际 XML、格式和媒体/嵌入数据，忽略自动生成的 `rsid` 与打包信息。
本机连续范围导出会更换修订戳，已取得差异证据；真正公式字符/二进制变化仍会改变指纹。

## 已验证范围

隐藏 x64 Word/Excel/PowerPoint 16.0，直接适配器调用：

- 重复 part、错误根节点下，显式删除拒绝，原对象/源码保留，诊断不修复。
- Word 正文原生公式删除后周围文字保留，页眉条目与故事范围清单保留，保存重开一致。
- Excel/PPT PNG 删除后目标记录消失、另一记录保留；保存重开一致，重复缺失请求无修改，只读重开拒绝删除。
- 默认诊断保留自编孤儿记录，显式孤儿修复完成并回读；PPT 的真实 Slides 枚举通过。
- 共享故障测试覆盖 Add/回读/旧 part 删除、对象删除前后异常、部分/重复库存，以及坏载荷拒绝。

全套 Shared.Tests warnings-as-errors、433 项前端、源码卫生、package-resources 通过。
Word 清单安全及 25 项隐藏批次回归通过：24 成功、1 保留、0 失败。VSTO 项目仍有原有 nullable 警告。
专项复现：Shared.Tests、Word.HostTests、Office.SampleHostTests 的 `--manifest-delete`。

| `src-tauri/target/` 下的忽略证据 | SHA-256 |
| --- | --- |
| `manifest-delete-word-final-9e09c084bf95455e9e72b4dfd80f2f79/manifest-delete-evidence.json` | `2114df5bc8108fddb549b55826c62688a7327e4ad6db361da7be9048cd7d45f7` |
| `manifest-delete-hosts-final-7757f77ba7244bb68e90fa3f8e8f6ba3/cross-host-manifest-evidence.json` | `9ba1417c5e666d433bb4d5b6dcdbf978a36050f565d380fc8acd55c12d4706f1` |
| `manifest-delete-word-regression-bece3092585144d7840a1f559bdf151d/manifest-safety-evidence.json` | `95779b7d8ec4d1976748c40e1a13deedee2c4270b18c5015e07ca90c5ed1d67b` |
| `manifest-delete-batch-regression-1a1a132bdff94c82ae7f8ec2263c37dc/batch-evidence.json` | `849e18ef228137f619b19bde89491df25c2c8563ce92f3a7d6d137ad70cf99b9` |

`pipeVerified=false`。真实 OLE 删除故障、安装版加载项、全部选区/故事/分组矩阵、跨请求修订、
并发诊断修复门禁、复制身份修复及完整格式迁移仍开放；不宣称 LaTeX 图像准确率或性能提速。
