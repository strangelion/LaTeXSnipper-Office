# LaTeXSnipper WPS 插件

LaTeX 公式插入 WPS Office 插件，支持 WPS 文字和 WPS 演示。

## 功能

- 行内公式 / 行间公式 / 编号公式插入
- 公式预览（通过 LaTeXSnipper Bridge）
- 图片插入（PNG 渲染）
- 加载选中 / 删除选中公式
- 自动编号 / 重新编号（支持未编号公式）
- 截图识别（开发中）

## 环境要求

- **Node.js** 18+（安装包内含自动下载逻辑）
- **WPS Office** 2019+（需支持 JSAddIn）
- **LaTeXSnipper Bridge**（桌面应用，提供公式渲染服务）

## 项目结构

```
WpsAddIn/                          # 开发目录
├── index.html                     # 插件入口（加载 main.js）
├── main.js                        # 加载 util.js 和 ribbon.js
├── ribbon.xml                     # Ribbon UI 定义
├── manifest.xml                   # WPS 插件清单
├── package.json                   # npm 配置
├── js/
│   ├── ribbon.js                  # Ribbon 回调 + bridgeRelay（JSAddIn 上下文）
│   └── util.js                    # 工具函数（WPS_Enum 等）
├── ui/
│   └── taskpane.html              # 任务窗格（主界面）
├── images/                        # Ribbon 按钮图标（SVG）
├── server.js                      # 本地文件服务器（端口 8080）
├── proxy.js                       # CORS 代理（端口 28766 → Bridge 28765）
├── start.js                       # wpsjs debug 启动器（开发用）
├── pack.bat                       # 打包脚本
└── src/                           # 备用源码

dist/                              # 发布目录（分发给用户）
├── install.bat                    # 一键安装脚本（含 Node.js 自动下载）
├── uninstall.bat                  # 一键卸载脚本
└── latexsnipper-wps_1.0.0/        # 插件文件包
    ├── launcher.js                # 一键启动脚本（server + proxy + WPS）
    ├── proxy.js                   # CORS 代理（同开发目录）
    ├── server.js                  # 文件服务器（同开发目录）
    ├── index.html                 # 插件入口
    ├── main.js                    # 加载脚本
    ├── manifest.xml               # 插件清单
    ├── ribbon.xml                 # Ribbon 定义
    ├── js/ribbon.js               # Ribbon 回调
    ├── js/util.js                 # 工具函数
    ├── ui/taskpane.html           # 任务窗格
    └── images/                    # 图标
```

## 开发调试

```bash
# 安装依赖
cd WpsAddIn
npm install

# 启动开发模式（wpsjs debug）
npm run debug

# 单独启动 proxy（CORS 代理）
node proxy.js

# 单独启动 server（文件服务器）
node server.js
```

开发模式下 `wpsjs debug` 自动启动本地服务器并加载插件到 WPS。按 F12 可打开任务窗格调试控制台。

## 打包发布

```bash
# 打包 dist 目录
cd WpsAddIn
pack.bat
```

打包后 `dist/` 目录包含：
- `install.bat` — 一键安装脚本
- `uninstall.bat` — 一键卸载脚本
- `latexsnipper-wps_1.0.0/` — 插件文件

## 用户安装

### 方式一：双击安装（推荐）

1. 下载 `dist/` 文件夹
2. 双击 `install.bat`
   - 自动检测 Node.js，未安装则自动下载安装
   - 自动安装插件文件到 `%AppData%\kingsoft\wps\jsaddons\`
   - 自动创建桌面快捷方式
3. 双击桌面 **"LaTeXSnipper WPS"** 启动
   - 自动启动 server（文件服务）+ proxy（CORS 代理）
   - 自动启动 WPS Office

### 方式二：手动安装

```bash
# 复制插件文件
xcopy /E /I latexsnipper-wps_1.0.0 "%AppData%\kingsoft\wps\jsaddons\latexsnipper-wps_1.0.0"

# 写入 WPS 配置
echo ^<jsplugins^>^<jspluginonline name="latexsnipper-wps" type="wps" url="http://127.0.0.1:8080/" debug="" enable="enable_dev" install="null"/^>^</jsplugins^> > "%AppData%\kingsoft\wps\jsaddons\publish.xml"

# 启动服务
node launcher.js
```

## 卸载

双击 `uninstall.bat`，自动删除插件文件和桌面快捷方式。

## 架构说明

```
┌─────────────────────────────────────────────────┐
│  WPS Office                                     │
│  ┌──────────────┐    ┌──────────────────────┐   │
│  │ ribbon.js    │    │ taskpane.html        │   │
│  │ (JSAddIn)    │    │ (Webview)            │   │
│  │ wps.OAAssist │    │ wpsFetch → fetch()   │   │
│  └──────────────┘    └───────┬──────────────┘   │
│                              │                   │
└──────────────────────────────┼───────────────────┘
                               │
                    http://127.0.0.1:8080 (文件服务)
                    http://127.0.0.1:28766 (CORS 代理)
                               │
                    http://127.0.0.1:28765 (Bridge)
```

### 关键组件

| 组件 | 端口 | 作用 |
|------|------|------|
| `server.js` | 8080 | 提供插件静态文件，WPS 从这里加载 JS/HTML |
| `proxy.js` | 28766 | CORS 代理，转发请求到 Bridge 并添加跨域头 |
| Bridge | 28765 | LaTeXSnipper 桌面应用，提供公式渲染 API |

### 为什么需要 server.js？

WPS JSAddIn 不支持从远程 URL 加载插件代码（`<jspluginonline>` 只能加载 ribbon.xml，JS 必须本地加载）。`server.js` 通过 `http://127.0.0.1:8080` 提供文件，使任务窗格能正确加载脚本且 F12 调试可用。

### 为什么需要 proxy.js？

任务窗格通过 `fetch()` 调用 Bridge API（端口 28765），但 Bridge 不返回 `Access-Control-Allow-Origin` 头。`proxy.js` 作为中间层添加 CORS 头，同时提供 `/save-temp`（临时图片保存）和 `/log`（日志写入）端点。

## 日志

运行时日志写入：
```
%AppData%\kingsoft\wps\jsaddons\latexsnipper-wps_1.0.0\logs\debug.log
```

可通过 `launcher.js` 的 `/log` 端点写入，或在 F12 控制台查看。

## 踩坑记录

开发过程中遇到的问题和解决方案，避免重复踩坑。

### 1. WPS Ribbon Error: `ribbon functions should return bool or string`

**现象**: `OnAction`、`GetImage` 等回调函数报错，Ribbon 按钮不可用。

**原因**: WPS JSAddIn 要求所有 Ribbon 回调函数（`OnAction`、`GetImage`、`OnGetEnabled`、`OnGetVisible`）必须返回 `true`/`false` 或字符串。如果某个回调函数没有 return 语句，WPS 会报错。

**解决**: 确保所有回调函数都有明确的 return：
```javascript
function OnAction(control) { /* ... */ return true; }
function GetImage(control) { /* ... */ return "images/icon.svg"; }
function OnGetEnabled(control) { return true; }
function OnGetVisible(control) { return true; }
```

### 2. wpsjs debug 只支持一个 addonType

**现象**: `package.json` 中 `"addonType": "wps"` 导致 `wpsjs debug` 只注册 Word，PPT 不加载插件。

**原因**: `wpsjs` 工具每次 debug 只处理一个 `addonType`，会重写 `publish.xml`。

**解决**: 在 `publish.xml` 中手动添加多个 `<jspluginonline>` 条目（wps + wpp），并在 `authaddin.json` 中添加对应的 wpp 注册信息。注意：每次 `wpsjs debug` 启动都会覆盖 `publish.xml`，需要在 wpsjs 启动后手动修复或使用 `start.js` 自动修复。

### 3. wps.OAAssist.HttpRequest 在 Taskpane 中不可用

**现象**: 在 taskpane 的 webview 中访问 `wps.OAAssist` 为 `undefined`。

**原因**: `wps.OAAssist` 只在 JSAddIn 脚本上下文（`main.js`、`ribbon.js`）中可用。Taskpane 是独立的 webview，运行在不同的 JavaScript 上下文中。`wps` 全局对象在 taskpane 中存在，但缺少 `OAAssist` 属性。

**解决**: 不要在 taskpane 中使用 `wps.OAAssist.HttpRequest`。改用 `fetch()` 通过本地代理（proxy.js）访问 Bridge，或在 ribbon.js 中暴露中转函数到 `window.Application` 对象上。

### 4. Bridge CORS 问题 — 需要 proxy.js

**现象**: Taskpane 中 `fetch('http://127.0.0.1:28765/config')` 被 CORS 策略阻止。

**原因**: Bridge（LaTeXSnipper.exe）运行在端口 28765，taskpane 从另一个源（`file://`、`http://127.0.0.1:8080`）加载。不同端口 = 不同源，需要 CORS 头。Bridge 不一定返回 `Access-Control-Allow-Origin` 头。

**解决**: 使用 `proxy.js`（端口 28766）作为 CORS 代理，转发请求到 Bridge 并添加 `Access-Control-Allow-Origin: *` 头。Taskpane 的 `BRIDGE_URL` 指向 proxy 而非 Bridge。

### 5. WPS JSAddIn 不支持远程 URL 加载 JS 代码

**现象**: 在 `publish.xml` 中配置远程 URL（如 `https://example.com/plugin/`），WPS 能下载 `ribbon.xml` 和 `manifest.xml`，但永远不加载 `index.html` 和 JS 文件。

**原因**: WPS JSAddIn 的 `<jspluginonline>` 标签只能远程加载 ribbon.xml 定义，实际的 JS 代码必须从本地加载。这是 WPS 平台的限制。

**解决**: 使用本地 HTTP 服务器（`server.js`，端口 8080）提供插件文件。`publish.xml` 中 `url` 指向 `http://127.0.0.1:8080/`。用户启动插件前需要先运行 server。

### 6. file:// 协议下 fetch 被阻止

**现象**: Taskpane 从本地文件加载（`file://` 协议），`fetch()` 到 `http://127.0.0.1:28765` 被浏览器安全策略阻止。

**原因**: `file://` 协议被视为不安全源，现代浏览器（包括 WPS 内嵌的 Chromium）会阻止 `file://` → `http://` 的跨域请求。

**解决**: 不要让 taskpane 从 `file://` 加载。使用 `server.js` 提供 HTTP 服务，`publish.xml` 中 `url` 指向 `http://127.0.0.1:8080/`。

### 7. F12 调试器在本地文件加载时不可用

**现象**: Taskpane 从 `file://` 加载时 F12 无法打开 DevTools。

**原因**: WPS 的 webview 对 `file://` 协议的调试支持有限。

**解决**: 通过 HTTP 服务器（`server.js`）加载 taskpane，F12 DevTools 即可正常工作。

### 8. Cloudflare Worker 返回错误的 Content-Type

**现象**: 远程 `ribbon.xml` 返回 `Content-Type: text/plain`，WPS 无法识别为 XML。

**原因**: Cloudflare Workers 的 MIME 类型映射表中缺少 `xml` 条目，默认 fallback 为 `text/plain`。

**解决**: 在 Worker 的 `MIME_TYPES` 对象中添加 `xml: "text/xml; charset=utf-8"`，重新部署。

### 9. 重新编号出现乱序/重复

**现象**: 自动编号结果为 `(1), (6), (2), (3), (4), (5), (6)` — 编号混乱且有重复。

**原因**: 
1. WPS Find 通配符中 `+` 不是量词（与正则不同），WPS 用 `@` 表示"一个或多个"。所以 `\\([0-9]+\\)` 匹配的是 `(数字+)` 而不是 `(数字)`。
2. OMath 公式内部的 `\qquad(N)` 编号未被 Find 发现（Find 不搜索 OMath 内部文本），导致重复添加编号。

**解决**:
1. WPS Find 通配符用 `@` 代替 `+`：`\\([0-9]@\\)` 匹配一个或多个数字。
2. 用 `PluginStorage` 计数器追踪编号（`equation_counter`），而非扫描文档文本。
3. 检查每个 OMath 段落时，同时用 `oMath.Range.Find` 和 `range.Find` 两层检测编号是否存在。

### 10. 插入图片失败: `FileSystem.OpenTextFile is not a function`

**现象**: 调用 `app.FileSystem.OpenTextFile()` 保存临时 PNG 文件时报错。

**原因**: WPS JSAddIn 的 `Application` 对象没有 `FileSystem` 属性。这是 VBA/COM API，不是 JSAddIn API。

**解决**: 通过 `proxy.js` 的 `/save-temp` 端点保存临时文件。Taskpane 将 base64 图片 POST 到 proxy，proxy 写入临时目录并返回文件路径。

### 11. 文本偏移导致编号位置错乱

**现象**: 使用 `doc.Range(0, doc.Range().End).Text` 获取全文文本，用正则匹配位置后替换，结果编号错位。

**原因**: `Range.Text` 返回的字符串中字符偏移与 `Range(start, end)` 的位置不一定一一对应（特别是包含 OMath、特殊字符、段落标记时）。

**解决**: 使用 WPS 的 `doc.Range.Find` API 查找匹配，通过 `find.Parent.Start` / `find.Parent.End` 获取精确的 Range 位置，而非从文本偏移推算。或者使用 `doc.Range(start, end).Find` 在子范围中查找。

### 12. wpsjs debug 覆盖 publish.xml

**现象**: 手动修改 `publish.xml` 添加 wpp 类型后，运行 `wpsjs debug` 又被覆盖回只有 wps 类型。

**原因**: `wpsjs debug` 启动时调用 `configPublish()` 重写整个 `publish.xml`。

**解决**: 
- 方案 A: 修改 `package.json` 的 `addonType` 为需要的类型，让 wpsjs 直接写对。
- 方案 B: 使用 `start.js` 在 wpsjs 启动后自动修复 publish.xml。
- 方案 C: 不用 wpsjs debug，手动管理配置文件。

### 13. node 杀进程误杀自身

**现象**: 执行 `Stop-Process -Name "node" -Force` 杀掉了所有 node 进程，包括 MiMoCode Agent 自身。

**原因**: MiMoCode Agent 也运行在 node 进程中。

**解决**: 永远不要用 `Stop-Process -Name "node"` 杀所有 node。改为精确杀指定端口的进程：
```powershell
$port = 28766
$pids = netstat -ano | Select-String ":${port}\s.*LISTENING" | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
foreach ($p in $pids) { Stop-Process -Id $p -Force }
```

### 14. publish.xml 属性 `install` 的值

**现象**: `install="https://example.com"` 导致 WPS 不加载插件。

**原因**: `install` 属性用于指定离线安装包 URL。在线模式应设为 `install="null"`。

**解决**: 在线模式 `<jspluginonline>` 的 `install` 属性值必须为 `"null"`（字符串）。

### 15. `wpsjs` build 交互模式无法自动化

**现象**: `wpsjs build` 和 `wpsjs publish` 需要交互式输入（选择在线/离线模式），在脚本中无法自动化执行。

**原因**: `wpsjs` 使用 `inquirer` 库做交互式提示，stdin 关闭后会报 `ERR_USE_AFTER_CLOSE`。

**解决**: 直接实现打包逻辑（复制文件 + 写 publish.xml），不依赖 `wpsjs build`。参考 `build.js` 源码中的逻辑。
