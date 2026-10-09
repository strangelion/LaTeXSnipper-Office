# Excel / PowerPoint 清单提交与失败传播

更新：2026-10-09。范围是新对象插入及元数据提交，不是完整格式迁移或性能提速声明。

两个适配器现在对实际插入的工作簿/演示文稿写入清单并回读验证，再返回成功。
加载项不再根据之后的 ActiveWorkbook/ActivePresentation 重复写入，也不再吞掉异常。
共享替换路径拒绝重复 part、错误根节点、损坏 XML 和 ID 冲突，保留原条目及未知扩展。

完整源码/渲染载荷记录实际 `image` 或 `ole` 模式，不修改调用者请求的 `auto` 模式。
写入失败清理明确由本次插入的对象；清理抛错返回 `HOST_MANIFEST_ROLLBACK_UNVERIFIED`。
清单失败禁止自动转另一种路线重试。不明确的清单执行状态仍保留诊断及现有载荷，
不宣称整个文档已回滚。PowerPoint 显式目标还校验幻灯片确实属于目标演示文稿。

## 验证结果

隐藏的真实 x64 Excel / PowerPoint 16.0：

- 重复 part、错误根节点返回失败，本次新图形移除，原 part 内容不变。
- 每个宿主连续插入两个 PNG 对象，第二次写入保留第一条记录。
- 完整 payload、实际模式、宿主 locator、保存重开核对通过；Excel 原单元格文字保留。
- PowerPoint 不匹配的显式目标被拒绝；剪贴板序列未变。

共享故障测试及全套 Shared.Tests（warnings-as-errors）、433 项前端测试、源码卫生和
package-resources 契约通过。共享 store 泛化后的真实 Word 清单安全回归也通过。
VSTO 项目构建仍存在原有 nullable 警告，没有把编译成功称为零警告。

复现：构建 SampleHostTests 后运行
`LaTeXSnipper.Office.SampleHostTests.exe <new-evidence-directory> --manifest`。
Word 回归使用 `word-manifest-append-v1.json` 和 `--manifest-safety`，而不是绘图 fixture。

| `src-tauri/target/` 下的忽略证据 | SHA-256 |
| --- | --- |
| `cross-host-manifest-e82eb5cec3ad4d5a8e7e622a29ba3c2c/cross-host-manifest-evidence.json` | `cf08f2760e79b9242b922558799fd6793c4b9a8c2c9058767830b568b562d1f1` |
| `cross-host-word-regression-a0830d0ff9ef404fa060d6a045646651/manifest-safety-evidence.json` | `95779b7d8ec4d1976748c40e1a13deedee2c4270b18c5015e07ca90c5ed1d67b` |

`pipeVerified=false`。真实 OLE 激活/故障、安装版加载项管道、x86、DPI/RDP、全部字体/尺寸
及通用格式保真未在此验收。清单删除、读入身份修复和完整迁移事务继续保持开放。
