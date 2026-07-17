# Visio Native 集成

Visio 集成面向 Microsoft Visio Windows Desktop，使用 VSTO、Native Office protocol v3 和桌面应用的 authenticated Named Pipe。它不是 Office.js 加载项；当前 Microsoft Office Add-ins 宿主集合不包含 Visio，因此项目不会声明 Visio Web 或 macOS 支持。

## 能力与成熟度

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| SVG 矢量插入 | Beta | `auto` 优先导入 SVG，`vector` 只允许 SVG |
| PNG fallback | Beta | `auto` 在 SVG 缺失或导入失败时使用；`image` 只允许 PNG |
| 读取/编辑 | Beta | 读取当前唯一选中的 owned shape，并向桌面发送带 revision 的 edit transaction |
| 替换 | Beta | revision 乐观并发、候选优先、校验后提交 |
| 删除 | Beta | 只删除当前唯一选中的 owned shape |
| grouped shape 替换 | Unsupported | 为避免破坏组结构而明确拒绝 |
| OLE | Experimental / unavailable | 初始版本不创建或伪装 Visio OLE 公式对象 |
| Office.js / Web / macOS | Unsupported | 不存在项目实现，也不通过 manifest 宣称支持 |

## 存储与边界

每个公式 shape 在 ShapeSheet `User` section 保存 schema 3 元数据。完整 `FormulaPayload` 先编码为 UTF-8 JSON，再 Base64 分块，并保存 SHA-256。原始 JSON 最大 256 KiB、最多 64 块、每块最多 8192 个字符；读取时严格验证 schema、块数、块长度、Base64、总大小、SHA-256、`formulaId` 和 revision。

SVG 使用当前用户 LocalAppData 下的 LaTeXSnipper owned temp 目录，单个 SVG 最大 8 MiB。文件在 `Page.Import` 返回后立即清理；清理失败写入结构化日志，但不记录 SVG、PNG 或 Base64。PNG 使用共享 strict decoder，不依赖 data URL 的隐式容错。

存储模式语义固定为：`auto = SVG -> PNG fallback`、`vector = SVG only`、`image = PNG only`。Visio 对 `ole` 和 `native` 明确返回 unsupported，不会静默降级成其他模式。

context ID 为 `visio:<document identity>:<page id>`。已保存文档使用规范化完整路径的 SHA-256 前 16 字节；未保存文档在本次 Visio 进程内使用稳定随机 ID。桌面提交沿用现有 expected-context 校验，页面或文档切换后拒绝旧提交。

复制 shape 导致 `formulaId` 重复时，页面中最先出现的 shape 保留身份；读到后续副本时为副本分配新 ID、revision 归零并回写 ShapeSheet。

## 替换事务

Ribbon 的“读取/编辑”会把 LaTeX、OMML、formulaId、revision 和 `sourceHost=visio` 发送给桌面应用。用户再次提交时复用 Native Office transaction 和 expected-context 校验，再进入 Visio replacement；普通读取不会再以 MessageBox 作为成功终点。

替换保留原 shape 的中心、宽高、旋转角和翻转状态。流程为：创建 SVG/PNG 候选、应用 placement、写入并回读 metadata、确认 revision，然后才删除原 shape。候选校验或删除原对象失败时删除候选并保留原对象；候选清理也失败时同时报告原错误和清理错误。

Word、Excel、PowerPoint 与 Visio 共用 Native Office pipe 重连协调器。桌面应用晚启动或运行中重启后，加载项都会持续重试并重新发送 HELLO/HOST_READY；连接和断开状态都会使 Ribbon 失效，以便 Office 重新查询按钮的 `getEnabled`。

## 发布前真实宿主检查

自动测试覆盖 metadata、损坏、限额、单位换算、context identity、复制身份、候选回滚、协议路由、VSTO manifest 与安装包 hash 链，但不能替代 Visio GUI。发布前必须在安装了 Visio 的 x86 与 x64 Office 环境分别验证：安装和 Ribbon 加载、SVG 插入、PNG fallback、选择读取、更新、删除、复制、保存/重开、页面切换 stale commit、grouped shape 拒绝、同版本重装、升级和卸载残留。

在上述 x86/x64 真实宿主矩阵完成前，Visio Native 只能标记为 Beta；Visio OLE 仍为 Experimental / unavailable。
