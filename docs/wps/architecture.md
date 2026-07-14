# WPS architecture

一个源码包服务三个独立宿主：`wps-writer`、`wps-spreadsheets`、`wps-presentation`。positive capability detection 分别检查 ActiveDocument、ActiveWorkbook+ActiveSheet、ActivePresentation，不能把 Writer 存在性当作三宿主成功。

Desktop 在 HTTP 19877 提供 `/wps/`、`/config`、统一 convert v1、ecosystem register/heartbeat 和受 bearer token 保护的 temp-assets。任务窗格每 12 秒 heartbeat，隐藏时降频/停止重叠。Bridge listener、payload installed、publish.xml registered、task pane loaded 和 heartbeat fresh 是不同状态。

安装器保留无关 publish.xml 条目，原子 upsert 三个 owned entries：type 为 `wps`、`et`、`wpp`，URL 为 `http://127.0.0.1:19877/wps/`。卸载只移除 owned entries、owned payload、temp assets 和 ledger。
