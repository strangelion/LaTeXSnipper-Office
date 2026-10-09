# 显式孤儿修复快照门禁

更新：2026-10-09。默认诊断仍只读；只有显式请求才删除孤儿清单条目。

## 边界

Word/Excel/PPT 扫描时捕获完整清单和对象 ID 库存。每条修复必须仍匹配预期清单，
文档可写、完整库存相同；暂存替换清单后再次枚举库存，验证后才删除旧 part。
重复数量也参与比较，不因枚举顺序不同误拒绝。新增/消失/重复 ID、部分枚举、
只读状态或清单变化均阻止删除。前一条成功后的回读 XML 成为下一条预期，
不重新接受任意外部修改。未知状态沿用严格清单事务失败传播，不自动重试。

PowerPoint late-bound COM 的 ReadOnly 返回整数，显式转换而非动态整数/枚举比较；
未知非零状态保守视为只读。测试断言包含诊断错误，不再只报笼统失败。

## 验证

Shared.Tests warnings-as-errors 全套、433 项前端、源码卫生通过。
共享故障覆盖陈旧清单、修复前/暂存后库存变化、部分重扫、重复数量、顺序变化和连续修复。
隐藏 x64 Word/Excel/PPT 16.0 的显式孤儿修复、对象删除及保存重开回归通过。

| `src-tauri/target/` 下的忽略证据 | SHA-256 |
| --- | --- |
| `guarded-repair-hosts-final-f904dd09358143e68ae0dfc1c72b8020/cross-host-manifest-evidence.json` | `9ba1417c5e666d433bb4d5b6dcdbf978a36050f565d380fc8acd55c12d4706f1` |
| `guarded-repair-word-024b5c99c0024d089dd2278e3a6a019a/manifest-delete-evidence.json` | `2114df5bc8108fddb549b55826c62688a7327e4ad6db361da7be9048cd7d45f7` |

`pipeVerified=false`。这是有界重新检查，不是跨多个 COM 调用的宿主级锁；
真实宏重入/任意并发编辑、安装版请求、完整 Word/OLE/分组库存和所有迁移路线仍开放。
分条修复可能已完成部分条目后停止，报告只计已经验证成功的修复，不宣称整批原子。
