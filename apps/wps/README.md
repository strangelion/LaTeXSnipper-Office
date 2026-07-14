# LaTeXSnipper WPS JSAddIn

该目录是 WPS Writer、Spreadsheets（ET）和 Presentation（WPP）的同一生产插件源。生产运行时由 LaTeXSnipper Desktop 的 HTTP Bridge 在 `19877` 端口提供 `/wps/` 静态资源和转换协议，不依赖 Node.js、Vite proxy 或单独文件服务器。

## 宿主

- `wps`：Writer，使用原生 OMath；支持 inline、display、全局编号、读取、更新、删除和重新编号。
- `et`：Spreadsheets，使用带所有权元数据的 PNG shape；支持插入、读取、候选优先更新和删除。
- `wpp`：Presentation，使用带所有权元数据的 PNG shape；支持插入、读取、候选优先更新和删除。

ET/WPP 不支持公式编号。Writer 的 chapter numbering 尚未实现，相关控件不得启用。

## 生产拓扑

```text
WPS task pane
  -> GET /config
  -> POST /api/office/convert/v1
  -> POST/DELETE /api/wps/temp-assets
  -> POST /api/ecosystem/clients/register
  -> POST /api/ecosystem/clients/heartbeat

LaTeXSnipper Desktop
  -> HTTP 127.0.0.1:19877
  -> /wps/ static files
  -> per-process random bearer token for temporary assets
```

临时图片由 Bridge 生成随机文件名，限制格式和大小，并按 TTL 清理。插件从服务自身 origin 推导 Bridge 地址；生产代码不得写入旧开发端口。

## 构建

从仓库根目录运行：

```powershell
npm run build:wps
```

输出为：

```text
apps/wps/dist/latexsnipper-wps_<version>/
apps/wps/dist/latexsnipper-wps_<version>.zip
```

构建产物只包含 HTML、JavaScript、manifest、Ribbon 和图标，不包含 Node.js runtime、proxy 或独立 server。

## 开发调试

`wpsjs debug` 每次只能写入一个 `addonType`。仓库用隔离临时目录启动三种宿主，避免调试工具修改源目录：

```powershell
npm --prefix apps/wps run debug:wps
npm --prefix apps/wps run debug:et
npm --prefix apps/wps run debug:wpp
```

这里的 `package.json.addonType` 仅是 `wpsjs` 调试输入。生产 `publish.xml` 由 Rust 安装器原子更新，使用三个独立的 `type="wps|et|wpp"` 条目；不会把 `addonType` 写入 `publish.xml`。

## 安装与状态

桌面端 `install_platform_integration("wps")` 会：

1. 验证三宿主生产 payload；
2. 复制到当前用户 WPS JSAddIn 目录；
3. 保留无关条目并原子更新 `publish.xml`；
4. 重新读取并验证三个 owned registration；
5. 记录安装 ledger。

状态必须分别区分 payload、注册、Bridge listener、宿主安装、宿主 heartbeat。有效 `publish.xml` 不等于真实宿主已经加载。

## 当前成熟度

- 自动构建与协议测试：Implemented / Automated tested。
- Writer、ET、WPP 真宿主加载：在实际打开对应宿主并完成验收前保持 Beta。
- Writer 全局编号：实现后仍需真实 Writer 验证。
- Writer chapter numbering：Unsupported。
- ET/WPP numbering：Unsupported。
