# Platform boundaries

生产边界：Windows 默认 Native VSTO + real OLE；macOS 和 Office Web 使用 Office.js；WPS 使用独立 JSAddIn；Linux generic Office route 明确 unsupported。

源码门禁拒绝：WPS 引入 `Word.run`/`Excel.run`/`PowerPoint.run`/`Office.context`/VSTO/OLE；Office.js 引入 Native Office、Registry、RegAsm 或 VSTO；host-neutral protocol 引入 Office COM/Registry；Native C# 在任意 `Task.Run` 中调用 COM。

非 Windows Tauri 基础配置不得包含 NativeOffice DLL、VSTO、证书或 MSI。Windows 专用资源只由 `tauri.windows.conf.json` 引入。WPS 生产 bundle 不包含 Node server/proxy。

Bridge 合同不变：Office.js HTTPS 19876；WPS/ecosystem HTTP 19877；Native Office authenticated Named Pipe。桌面 WebView 对自身运行时状态和 action queue 使用 Tauri commands，不经 loopback HTTP。
