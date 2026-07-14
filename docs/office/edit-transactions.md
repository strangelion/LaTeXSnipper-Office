# Office edit transactions

关键 Office 编辑意图由 Rust `OfficeEditTransactionStore` 持久化，前端 `_pendingOfficeEditorRequest` 只是 UI 镜像。事务协议版本为 1，默认 TTL 为 2 小时，成功/取消事务保留 24 小时后清理。

事务保存于当前用户应用数据目录的 `LaTeXSnipper/office-edit-transactions`。每个事务使用 UUID 文件名，JSON 上限 256 KiB，LaTeX 上限 64 KiB；大渲染数据不得写入 JSON，只能保存经过验证的 asset ID、格式、尺寸、长度和 SHA-256。写入使用同目录临时文件、flush、`sync_all`，随后 Windows 使用 `MoveFileExW(REPLACE_EXISTING|WRITE_THROUGH)`，其他平台使用 rename。损坏或超限文件进入 `quarantine`。

生命周期为 `opened -> editing -> prepared -> committing -> completed`。取消进入 `cancelled`；宿主提交失败进入可恢复的 `failed`；过期事务清理。相同 integration、host、document 和 source object/formula ID 同时只允许一个 active write，冲突返回 `OFFICE_TRANSACTION_CONFLICT`。

Native Word Ribbon 的 numbered 链路是：

```text
OPEN_EDITOR(display=numbered)
-> Rust begins transaction(requestedMode=numbered, numbering.scheme=global)
-> desktop mirrors transaction and preselects numbered
-> prepare/mark committing
-> native_office_insert_formula(mode=numbered)
-> host ACK
-> complete transaction
```

只有宿主 ACK 成功后 UI 才显示成功并清理编辑状态。失败事务保留草稿、目标、FormulaId 和 revision，应用重启后可恢复。更新提交必须携带原 revision；宿主 revision 已变化时返回 `OFFICE_TARGET_CHANGED`。
