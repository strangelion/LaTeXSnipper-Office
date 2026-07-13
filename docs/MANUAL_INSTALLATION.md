# LaTeXSnipper Office 手动安装与插件部署指南

本文说明如何从 GitHub Release 手动安装 LaTeXSnipper 桌面应用，以及 Native Office、Office.js、Obsidian、WPS、VS Code、Chrome、Edge 和 Firefox 插件。

> 推荐普通用户优先安装桌面应用，并在应用设置中启用所需平台集成。下面的手动步骤主要用于离线部署、独立安装、故障排查和开发测试。

## 1. 下载文件说明

在 GitHub Release 的 **Assets** 中按平台选择文件：

| 文件 | 用途 |
|---|---|
| `LaTeXSnipper.NativeOffice.exe` | Windows Native Office 引导安装器，推荐用于安装 VSTO、OLE 和必要运行库 |
| `LaTeXSnipper.NativeOffice.msi` | Windows Native Office 独立 MSI，包含 Word、Excel、PowerPoint VSTO 与双位数 OLE 组件 |
| `LaTeXSnipper-Office-VSTO_*.zip` | VSTO 独立部署包，适合高级用户和故障修复 |
| `latexsnipper-obsidian_*.zip` | Obsidian 插件 |
| `latexsnipper-wps_*.zip` | WPS 加载项 |
| `latexsnipper-vscode-*.vsix` | VS Code 扩展 |
| `latexsnipper-browser-chrome_*.zip` | Chrome / Edge 扩展 |
| `latexsnipper-browser-firefox_*.zip` | Firefox 开发测试包 |
| `*.msi` / `*.exe` | Windows 桌面应用 |
| `*.dmg` | macOS 桌面应用 |
| `*.deb` / `*.rpm` | Linux 桌面应用 |
| `SHA256SUMS` | Release 文件完整性校验值 |

## 2. 安装前检查

1. 从本仓库的 GitHub Release 下载文件，不要从不明镜像获取安装包。
2. Windows 安装 Native Office 前，完全退出 Word、Excel、PowerPoint，并在任务管理器确认相关进程已经结束。
3. 更新 Native Office 或 OLE 组件后必须重新启动 Office；Office 进程不会自动卸载已经加载的旧 DLL。
4. 插件与桌面应用联动时，需要先启动 LaTeXSnipper 桌面应用。

### Windows 校验 SHA-256

在 Release 文件所在目录运行：

```powershell
Get-FileHash .\LaTeXSnipper.NativeOffice.msi -Algorithm SHA256
```

将结果与 Release 中 `SHA256SUMS` 对应条目比较。

### macOS / Linux 校验 SHA-256

```bash
sha256sum <下载文件>
```

## 3. 桌面应用

### Windows

优先运行桌面应用的 MSI；若 MSI 受到本机策略限制，可使用对应的 Setup EXE。

安装后：

1. 启动 LaTeXSnipper。
2. 打开“设置”或“平台集成”。
3. 启用 Office、Obsidian、WPS 或其他需要的集成。

### macOS

1. 打开 DMG。
2. 将 LaTeXSnipper 拖到“应用程序”。
3. 首次启动时，若系统阻止未公证应用，在“系统设置 → 隐私与安全性”中确认打开。

Native Office VSTO/OLE 仅支持 Windows；macOS Office 请使用 Office.js 加载项或复制粘贴工作流。

### Linux

按发行版安装 DEB 或 RPM：

```bash
sudo apt install ./latexsnipper-office_*.deb
```

或：

```bash
sudo rpm -i latexsnipper-office-*.rpm
```

Native Office VSTO/OLE 不支持 Linux。

## 4. Microsoft Office Native 集成（Windows，推荐）

Native Office 安装包同时提供：

- Word VSTO 加载项
- Excel VSTO 加载项
- PowerPoint VSTO 加载项
- 32 位 OLE 公式对象
- 64 位 OLE 公式对象
- VSTO 清单签名公钥证书

### 4.1 推荐安装方式：NativeOffice EXE

1. 完全退出所有 Office 应用。
2. 下载 `LaTeXSnipper.NativeOffice.exe`。
3. 双击运行安装器。
4. 安装完成后重新启动 Word、Excel 或 PowerPoint。
5. 检查功能区是否出现 **LaTeXSnipper**。

引导安装器适合尚未安装 .NET Framework 4.8 或 VSTO Runtime 的系统。

### 4.2 独立 MSI 安装

1. 完全退出 Office。
2. 下载 `LaTeXSnipper.NativeOffice.msi`。
3. 双击安装，或运行：

```powershell
msiexec.exe /i .\LaTeXSnipper.NativeOffice.msi
```

静默安装：

```powershell
msiexec.exe /i .\LaTeXSnipper.NativeOffice.msi /qn /norestart
```

默认按当前用户安装到：

```text
%LOCALAPPDATA%\LaTeXSnipper\NativeOffice
```

### 4.3 验证加载项

在 Word、Excel 或 PowerPoint 中：

1. 打开“文件 → 选项 → 加载项”。
2. 在底部“管理”选择“COM 加载项”。
3. 点击“转到”。
4. 确认对应的 LaTeXSnipper Native Office 加载项已启用。

若加载项被 Office 禁用，还应检查“管理 → 禁用项目”。

### 4.4 卸载

通过 Windows“设置 → 应用 → 已安装的应用”卸载 `LaTeXSnipper.NativeOffice`，或运行：

```powershell
msiexec.exe /x .\LaTeXSnipper.NativeOffice.msi
```

卸载后重新启动 Office。

## 5. VSTO 独立 ZIP 手动部署（高级）

`LaTeXSnipper-Office-VSTO_*.zip` 包含三个 Office 主机的 VSTO 清单、依赖、签名证书和 OLE DLL。该 ZIP 主要用于独立部署与修复。

> 需要完整 OLE 功能时，仍建议使用 NativeOffice EXE/MSI。仅双击 `.vsto` 不会自动完成双位数 OLE 注册。

### 5.1 解压到永久目录

不要从临时下载目录直接安装，也不要在安装后移动目录。例如：

```text
C:\Users\<用户名>\AppData\Local\LaTeXSnipper\NativeOffice-Standalone
```

### 5.2 导入 VSTO 发布者证书

ZIP 中包含：

```text
certificates\LaTeXSnipperOffice.cer
```

以当前用户身份导入到“受信任的发布者”：

```powershell
Import-Certificate `
  -FilePath .\certificates\LaTeXSnipperOffice.cer `
  -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
```

也可以双击 `.cer`，选择“当前用户”，并将证书放入“受信任的发布者”。

请核对 `certificates\native-office-signing.json` 中的指纹信息。Release 不包含签名私钥或 PFX。

### 5.3 安装三个 VSTO 加载项

依次双击：

```text
Word\LaTeXSnipper.Word.vsto
Excel\LaTeXSnipper.Excel.vsto
PowerPoint\LaTeXSnipper.PowerPoint.vsto
```

安装完成后完全退出并重新启动对应 Office 应用。

### 5.4 VSTO ZIP 的限制

- 该方式依赖 Microsoft Visual Studio Tools for Office Runtime。
- ZIP 中的文件路径属于部署清单的一部分，安装后不要移动或删除。
- OLE 公式对象需要额外注册 32 位和 64 位 DLL；普通用户不要手工编写注册表，使用 NativeOffice MSI/EXE 更安全。
- 若出现 ClickOnce 清单哈希错误，请重新下载并完整解压，不要单独替换 ZIP 中的 DLL、`.vsto` 或 `.manifest` 文件。

## 6. Office.js Web Add-in

Office.js 是跨平台任务窗格加载项，适合 Windows、macOS 和支持加载项的 Office Web 环境。

### 6.1 托管清单

本项目部署以下清单：

```text
https://latexsnipper.interknot.dpdns.org/office/manifest/word.xml
https://latexsnipper.interknot.dpdns.org/office/manifest/excel.xml
https://latexsnipper.interknot.dpdns.org/office/manifest/powerpoint.xml
```

这些清单使用网站托管的任务窗格资源。

桌面应用内部也包含指向 `https://localhost:19876` 的本地清单；本地清单只应由 LaTeXSnipper 桌面应用安装和管理，使用时必须保持桌面应用运行。

### 6.2 Windows 桌面 Office：共享文件夹旁加载

1. 下载对应主机的 XML 清单。
2. 将清单保存到一个固定文件夹，例如：

```text
C:\Users\<用户名>\Documents\LaTeXSnipper-Office-Addins
```

3. 在 Office 中打开“文件 → 选项 → 信任中心 → 信任中心设置”。
4. 打开“受信任的加载项目录”。
5. 添加上述文件夹的共享路径并启用“在菜单中显示”。
6. 重启 Office。
7. 打开“插入 → 获取加载项 / 我的加载项 → 共享文件夹”。
8. 选择 LaTeXSnipper。

不同 Office 版本的菜单名称可能略有差异。

### 6.3 Office Web 或 macOS：上传清单

在“插入 → 加载项 / 我的加载项”中使用“上传我的加载项”并选择对应 XML 清单。组织账户可能由管理员策略禁用旁加载；此时需要管理员通过 Microsoft 365 管理中心集中部署。

### 6.4 移除 Office.js 加载项

在“我的加载项”中删除 LaTeXSnipper；若使用共享目录方式，还应从目录中移除 XML，并在信任中心删除对应目录条目。

## 7. Obsidian 插件

Obsidian 插件 ID 为：

```text
latexsnipper-obsidian
```

该插件仅支持 Obsidian 桌面版。

### 手动安装

1. 下载并解压 `latexsnipper-obsidian_*.zip`。
2. 找到 Obsidian Vault 根目录。
3. 创建目录：

```text
<Vault>\.obsidian\plugins\latexsnipper-obsidian
```

4. 将以下文件直接放入该目录：

```text
main.js
manifest.json
styles.css   # 若压缩包中存在
```

正确结构应为：

```text
<Vault>\.obsidian\plugins\latexsnipper-obsidian\manifest.json
<Vault>\.obsidian\plugins\latexsnipper-obsidian\main.js
```

不要多套一层 ZIP 文件夹。

5. 重启 Obsidian，或执行“重新加载应用而不保存”。
6. 打开“设置 → 第三方插件”，启用 LaTeXSnipper。
7. 启动 LaTeXSnipper 桌面应用。

### 卸载

先在 Obsidian 中禁用插件，然后删除：

```text
<Vault>\.obsidian\plugins\latexsnipper-obsidian
```

## 8. WPS 加载项

WPS Release ZIP 已包含安装和卸载脚本。

### Windows 手动安装

1. 安装 Node.js，并确保 `node` 命令可用。
2. 完全退出 WPS。
3. 解压 `latexsnipper-wps_*.zip`。
4. 双击解压目录中的：

```text
install.bat
```

安装脚本会将插件复制到：

```text
%APPDATA%\kingsoft\wps\jsaddons\latexsnipper-wps
```

并更新：

```text
%APPDATA%\kingsoft\wps\jsaddons\publish.xml
```

5. 通过桌面上的 `LaTeXSnipper WPS` 快捷方式启动。该快捷方式会启动本地代理、插件服务器和 WPS。

### 卸载

完全退出 WPS，然后运行压缩包中的：

```text
uninstall.bat
```

## 9. VS Code 扩展

### 图形界面安装

1. 下载 `latexsnipper-vscode-*.vsix`。
2. 打开 VS Code 的“扩展”页面。
3. 点击右上角 `...`。
4. 选择“从 VSIX 安装…”。
5. 选择下载的 `.vsix`。
6. 重新加载 VS Code。

### 命令行安装

```bash
code --install-extension latexsnipper-vscode-1.2.11.vsix
```

升级时可以覆盖安装：

```bash
code --install-extension latexsnipper-vscode-1.2.11.vsix --force
```

扩展默认连接：

```text
http://127.0.0.1:19877
```

使用“编辑选区”或插入命令前应启动 LaTeXSnipper 桌面应用，并按需要配置 `latexsnipper.bridgeUrl` 与 `latexsnipper.bridgeToken`。

## 10. Chrome / Edge 浏览器扩展

### Chrome

1. 解压 `latexsnipper-browser-chrome_*.zip` 到固定目录。
2. 打开：

```text
chrome://extensions
```

3. 启用“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择直接包含 `manifest.json` 的目录。

### Microsoft Edge

1. 解压 Chrome 版本 ZIP。
2. 打开：

```text
edge://extensions
```

3. 启用“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择直接包含 `manifest.json` 的目录。

不要在加载后移动或删除该目录。更新时解压新版本覆盖原目录，然后在扩展管理页面点击“重新加载”。

## 11. Firefox 浏览器扩展

当前 Release 提供的是 Firefox ZIP 开发测试包，不是 Mozilla 签名的 XPI，因此普通稳定版 Firefox 通常不能将其作为永久扩展安装。

### 临时加载

1. 解压 `latexsnipper-browser-firefox_*.zip`。
2. 打开：

```text
about:debugging#/runtime/this-firefox
```

3. 点击“临时载入附加组件”。
4. 选择解压目录中的 `manifest.json`。

临时扩展会在 Firefox 完全退出后被移除。

永久发布需要将扩展打包为 XPI，并通过 Mozilla Add-ons 签名；在完成签名前，Release ZIP 仅用于开发和测试。

## 12. 常见问题

### Office 功能区没有出现

1. 完全退出 Office 后重新启动。
2. 检查“COM 加载项”和“禁用项目”。
3. 确认没有同时残留多个旧版本。
4. 优先重新运行 NativeOffice MSI 的修复或重新安装。

### OLE 公式仍显示旧效果

Office 进程可能仍在使用旧版 OLE DLL。关闭所有 `WINWORD.EXE`、`EXCEL.EXE` 和 `POWERPNT.EXE` 后再测试。

### OLE 插入失败或只能使用普通图片

确认安装的是完整 NativeOffice MSI/EXE，而不是仅安装了 `.vsto`。OLE 组件需要与 Office 位数匹配，正式安装包会同时注册 x86 和 x64 版本。

### 插件无法连接桌面应用

1. 确认 LaTeXSnipper 桌面应用正在运行。
2. 检查本机防火墙或安全软件是否拦截 `127.0.0.1`。
3. 检查插件中的 Bridge URL 和 Token。
4. 避免同时运行多个不同版本的桌面应用。

### VSTO 安装提示证书或清单错误

- 重新下载完整 ZIP。
- 先解压再安装。
- 不要修改或单独替换 `.dll`、`.vsto` 和 `.manifest`。
- 核对 `native-office-signing.json` 中的证书指纹。
- 优先改用 NativeOffice MSI/EXE。

## 13. 从源码构建

```bash
npm install
npm run build:vite
npm run build:office-addin
npm run build:wps
npm run build:ecosystem
```

Windows Native Office：

```powershell
cd apps\native-office\Installer
.\build.ps1 -Configuration Release -Version 1.2.11
```

Native Office 构建需要 Visual Studio/MSBuild、Office Developer Tools、VSTO Runtime 和受支持的 WiX Toolset。Release 构建必须使用稳定的 VSTO 清单签名身份；不要向仓库或 Release 上传 PFX 私钥文件。

## 14. 获取帮助

提交 Issue 时请附上：

- 操作系统和版本
- Office / WPS / Obsidian / VS Code 版本
- 32 位或 64 位 Office
- 安装的 LaTeXSnipper 版本
- 使用的安装文件名
- 完整错误信息和复现步骤

安装问题入口：

- GitHub Issues: `https://github.com/strangelion/LaTeXSnipper-Office/issues`
- Releases: `https://github.com/strangelion/LaTeXSnipper-Office/releases`
