# Office Agent Contracts、ORT 1.28、INT8 与 Drawing 实施报告

## Office 主报告

### A. 旧界面缺陷与 AxMath 对比

旧界面按功能堆叠，编辑、宿主和诊断入口层级不清。新设计借鉴任务优先和高密度命令栏，但不复制第三方产品的视觉资产或交互细节。

### B. 新信息架构

顶层固定为编辑、识别、公式库、Office、诊断；全局设置独立。能力状态由五层交集产生，避免把静态支持误报为运行可用。

### C. 五个工作区实现

编辑区新增命令栏、公式/绘图模式、三栏布局和 Drawing 任务映射；Office 区列出当前文档、插入路线和批量工作流；诊断区集中展示运行证据。响应式样式与 forced-colors 已加入契约。

### D. Agent/CI Contract

四个 JSON-compatible YAML 合同由 `scripts/run-agent-contracts.mjs` 执行。CI 提供八个独立任务：contract-ui、contract-recognition、contract-provider、contract-word-readback、contract-ole、contract-screenshot、contract-failure-corpus、contract-package-resources。每组生成 JSON、JUnit XML 和 SHA-256 文件并作为 artifact 上传。

### E. ORT 1.28 Office 矩阵

CPU 路线引用已通过的 Core 1.28 证据；没有本机硬件的 CUDA、DirectML、CoreML 等路线保持 notRun/blocked，并记录原因。矩阵不把配置 Provider 当作 effective Provider。

### F. INT8 AST/Office 确定性

Office 端矩阵区分真实宿主、设备和插入格式。没有实机输出的组合保持 notRun/unsupported，不使用 FP32 结果冒充 INT8 成功。

### G. 失败语料闭环

候选只接受规定来源和 SHA-256，不允许 rawUserData；默认私有、脱敏、无再分发许可。进入 regression 前必须通过人工判定和许可门禁。

### H. Provider ephemeral/persistent

Provider 验证用 allSettled 隔离单项失败，保留 passed、failed、unsupported 的部分结果。页面刷新读取真实进程状态，不把 smoke 结果推断成跨启动复用。

### I. Word scratch

生产代码显式删除 tracked scratch paragraph。真实 Word Host 测试连续插入 1、20、100 次，检查段落数、Content.End、相邻文本、段落标记、空 ContentControl、空 OMath 和 scratch tag。本机 100 次压力循环暴露并修复了 ContentControls 扫描未释放非匹配 RCW 导致的 `RPC_E_DISCONNECTED`；修复后压力循环和后续 78 次原生 OMML 插入全部通过。

### J. OLE COM 与 mixed-DPI

RCW 所有权显式区分 OwnedTemporaryRcw、BorrowedHostRcw、TransferredToResult；失败只释放自有临时 RCW，成功转移给可释放结果。真实 Word OLE 宿主验收通过 6 个高风险公式 × 3 种插入模式共 18 次插入，18/18 初始化和持久化回读成功，并记录 DLL、extent、geometry、ink 与截图。当前机器在 144 DPI（150%）与 2240×1400 主屏上完成该轮验证；未实测的 120/192 DPI、真实双屏切换、4K 和 RDP 组合仍不得标记 Stable。

### K. 截图平台状态

ScreenshotJobLease 使用 Created、InUse、Completed、Failed、Cancelled 状态，保护 InUse，执行 TTL、容量和陈旧恢复。Windows 本机真实显示器捕获 ignored 测试已单独执行通过。Linux 现在按 X11、Wayland 和未知会话分别报告：X11 可使用 xcap；尚未实现 Portal/PipeWire 的 Wayland 不再误报可用。macOS 与 Wayland 替代路线仍按 experimental/需要权限呈现。

### L. UI 可访问性

五工作区、设置分离、命令顺序、响应式断点、forced-colors 和主题变量均有静态契约。用户可见主流程使用统一简体中文。

### M. 测试证据与 SHA

契约 runner 在每个 CI job 生成包含 commit、平台、逐条结果和证据的 JSON，并配套 JUnit 与 SHA-256。资源合同固定 Core 子模块、质量基线、Provider smoke、Office.js 与 WPS manifest 的哈希。

### N. 未完成项

缺少的 INT8 模型与验证 runner、CUDA/CoreML 硬件、mixed-DPI、RDP、macOS/Linux 实机和 Drawing 外部编译器证据均保持 blocked/notRun/unsupported。本机未安装 `tectonic`、`dvisvgm`、Graphviz `dot` 或 Mermaid CLI，因此这些外部 Drawing 路线不产生成功声明；内置 SVG 消毒路线按其独立测试证据判定。

### N.1 本轮真实 Office 宿主证据

- Word 原生 OMML：26 个高风险与深度样例 × 行内/独立行/带编号独立行，78/78 通过；覆盖箭头、极限、`sin`、分段函数、积分/求和、矩阵、极长/极高公式与 4/8/16/32 层嵌套。
- Word 可编辑 OLE：6 个高风险样例 × 3 种插入模式，18/18 通过，OLE 初始化与保存后回读均通过。
- PowerPoint 样例：真实 PowerPoint COM 打开，4 个图片对象与 4 个嵌入 OLE 对象类型、名称全部通过。
- Excel 样例：真实 Excel COM 打开，4 个图片对象与 4 个嵌入 OLE 对象类型、名称全部通过。
- 原生 OMML 测试还发现并修复 Core 独立片段缺少 `xmlns:m` 以及 Office 行内归一化剥离继承命名空间的问题；测试 fixture 现由固定 Core 子模块的实际转换器生成，不再接受手写 OMML 替代。

### O. 提交 SHA

Core 基线为 `33d8e1e82f17845d2b2adbd0343ac663d5d1fb4d`。Office SHA 在合并本报告的提交后由 Git 历史确定。

### P. 自动插入职责边界

Core 独占技术有效性、质量、阈值、结构有效性、reviewRequired 与 recommendedAction 判断；Office 只补充用户设置、会话授权、文档状态和宿主能力。

### Q. ScreenshotJobLease 状态与清理

序列化字段兼容旧 path，并新增 sourcePath、previewPaths；失败和取消可回收，InUse 不被普通清理删除，TTL 24 小时且容量上限 512 MiB。

### R. OLE capability 提升证据

只有安装后端、运行权限、运行健康和宿主能力全部通过才提升；仅 Windows 静态支持不能提升。

### S. BenchmarkMeasured/Validated 语义

已测量但无版本化阈值、数据集 SHA 或证据 SHA 时只显示“已测量（未验证）”。

### T. Provider 部分失败结果

验证任务互不短路；任何单个 Provider 抛错不会清空其他 Provider 的结果。

### U. Baseline 部署故障呈现

启动部署结果被管理状态持久到当前进程，诊断区显示失败原因和目标路径，不再只存在于日志。

### V. 设置迁移

旧设置按 global、OS、host、document、session 五类迁移；迁移可重复执行且结果幂等。

## Drawing 补充报告

### A. 与既有两份提示词的差异

本补充不改变公式/OCR/Office 合同，而是增加 Drawing source、结构化文档、编译产物、Office 路线和独立 readiness。

### B. 格式分类和优先级

源码语言、TikZ package profile、Drawing JSON、通用产物和 Office 专属输出分层。TikZ、PGFPlots、SVG、Drawing JSON 为 P0；Mermaid、Graphviz 和常用 TikZ 领域包为 P1；PlantUML、Asymptote 等保持实验路线。

### C. Drawing Domain

Core 子模块提供 DrawingDocument、DrawingObject、adapter、compiler router、artifact、security、readiness、contract 和 failure-corpus 基础设施；Office 只消费版本化 payload。

### D. TikZ/PGFPlots

由 Core 的 TikZ family 适配器和编译路由处理，Office 不自行解析或宣称任意源码可逆。

### E. SVG/Office 输出

版本化路由合同覆盖 Native Shapes 兼容子集、Drawing OLE、SVG、PNG 和打印 PDF。当前 Office 生产工作区只启用已贯通并验证的 sanitized SVG → Native Office VSTO 路线；其余能力在宿主实现与 readiness 证据齐备前保持关闭，不能由合同枚举推导为产品可用。

### F. Mermaid/Graphviz

UI 已接入绘图模式状态、源码编辑、安全编译、预览与 Office 插入；真实外部引擎、资源或 smoke 未满足时 readiness 为 requiresSetup/experimental，内置 SVG 消毒路线不需要外部编译器。

### G. TikZ package profiles

package profile 属于编译配置和安全输入，不当作源语言；未知或未授权包不能静默启用。

### H. PlantUML/Asymptote

保留 P2/实验状态，没有真实外部引擎证据时不产生成功声明。

### I. Security

源摘要、编译器指纹、资源摘要和受控进程/文件/网络策略由 Core payload 与 readiness 提供，Office 校验必需字段。

### J. Readiness

每个 adapter 独立呈现 parser、compiler、package、smoke 和 golden 状态；productionRecommended 才映射 available。

### K. Contracts

Drawing Office route 和 readiness 进入 contract-ui；Core Drawing contracts 已在固定子模块提交中执行。

### L. Golden corpus

真实完成的 Core golden 证据由子模块提供；Office 不复制或伪造外部编译器输出。

### M. Failure corpus

Drawing failure 使用同一隐私候选模型，包含 adapter/compiler 指纹但不保存原始用户数据。

### N. Office integration

版本化 Drawing payload 必须包含 drawingId、source/render SHA、compiler fingerprint 和 resources SHA。路线选择按宿主与能力交集执行。

### O. 阻塞项

缺少本机编译器、宿主或硬件证据的组合均如实保持 requiresSetup、experimental、blocked 或 notRun。

### P. 提交 SHA

Core Drawing 实现在 `33d8e1e82f17845d2b2adbd0343ac663d5d1fb4d` 所含历史中；Office SHA 由本次最终提交确定。
