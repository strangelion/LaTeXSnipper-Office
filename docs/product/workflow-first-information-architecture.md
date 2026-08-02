# Workflow-first 信息架构

## 顶层工作区

桌面端只把五个用户任务暴露为顶层工作区：编辑、识别、公式库、Office、诊断。设置是右上角全局入口，不占用第六个工作区。编辑工作区采用资源、画布、检查器三栏结构；窄窗口依次折叠为单栏，主编辑区始终优先。

## 能力判定

任何按钮和插入路线均以交集结果为准：

`StaticPlatformSupport ∩ InstalledBackend ∩ RuntimePermission ∩ RuntimeHealth ∩ HostCapability`

静态平台支持不能直接提升为 available。Native OLE 还需要注册、位数、DLL、版本、geometry 和 ink 证据；未满足时显示 requiresSetup。Drawing Native Shapes 仅用于完整兼容子集，否则依次选择可编辑 OLE、SVG、PNG；打印请求可选择 PDF。

## 诊断语义

诊断工作区显示 Core readiness、Provider 验证、Office Bridge、OLE、截图权限和诊断包。质量基线部署错误不能只写日志，后端会保留启动结果并在 Core readiness 卡片显示错误、目标路径和摘要。BenchmarkMeasured 仅表示完成测量；只有阈值版本、数据集 SHA 和证据 SHA 同时存在时才显示 BenchmarkValidated。

## 语言、可访问性与布局

所有用户可见工作流文案使用简体中文；协议名、格式名和产品名保留规范英文。命令栏保持稳定顺序：新建、打开、截图、插入、复制、导出、撤销、重做、命令面板。CSS 不以固定超宽布局隐藏按钮，并覆盖窄窗口、高对比度 forced-colors、亮色和暗色主题。
