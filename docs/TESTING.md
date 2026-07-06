# LaTeXSnipper E2E Testing Checklist

> 本文档列出每次发布前必须验证的测试项。  
> 按平台/组件分组，每项应标记为 ✅ / ⚠️ / ❌。

---

## Protocol

- [ ] JSON Schema (`command.schema.json`) 通过结构验证
- [ ] TS 类型 (`command.schema.ts`) 与 JSON Schema 一致
- [ ] C# 类型 (`CommandMessage.cs`) 与 JSON Schema 一致
- [ ] 每个 command 在 schema 中有对应 capability 声明
- [ ] 所有 host 支持的 command 集合有文档对应

## Office Web Add-in

- [ ] `apps/office-addin` 构建通过：`npm ci && npm run build`
- [ ] Word manifest schema 验证通过
- [ ] Excel manifest schema 验证通过
- [ ] PowerPoint manifest schema 验证通过
- [ ] Tauri 桌面启动后 `https://127.0.0.1:19876/health` 返回 200
- [ ] Word taskpane 可插入 inline/block/numbered 公式
- [ ] Word taskpane 可读取选中公式
- [ ] Word taskpane 可删除选中公式
- [ ] Excel taskpane 可插入公式（文本降级）
- [ ] PowerPoint taskpane 可插入公式（文本降级）
- [ ] Bridge 离线时 taskpane 显示明确的连接错误

## WPS Add-in

- [ ] `apps/wps/build.ps1` 构建成功，产出 zip 包含 `command-layer.js`
- [ ] WPS 文字可插入 inline/block 公式（OMath）
- [ ] WPS 文字可读取选中公式
- [ ] WPS 文字可删除选中公式
- [ ] WPS taskpane 预览/PNG 插入功能有明确的使用条件说明
- [ ] WPS 演示/表格的 UI 中不展示为"已支持"
- [ ] `install.bat` 安装后 `publish.xml` 只添加 LaTeXSnipper 条目
- [ ] `uninstall.bat` 卸载后 `publish.xml` 中 LaTeXSnipper 条目被移除
- [ ] 其他 WPS 插件在安装/卸载后不受影响

## Native Office VSTO

- [ ] `apps/native-office` Release 构建通过 (MSBuild)
- [ ] WiX MSI 安装包构建通过
- [ ] Bundle bootstrapper 构建通过
- [ ] Word 注册表项写入正确（LoadBehavior=3）
- [ ] Excel 注册表项写入正确
- [ ] PowerPoint 注册表项写入正确
- [ ] 签名：Release tag 构建包含正式签名
- [ ] 签名验证：`Get-AuthenticodeSignature` 返回 Valid

## Obsidian Plugin

- [ ] `apps/obsidian-plugin` 构建通过：`npm ci && npm run build -- --production`
- [ ] 输出 `main.js` + `manifest.json` 结构完整
- [ ] 命令面板可触发所有注册命令
- [ ] Formula Editor Modal (MathLive) 可正常打开
- [ ] 插入 inline/block/numbered 公式正确
- [ ] 右键菜单包裹公式正常
- [ ] 设置页可修改 Bridge URL 和显示模式
- [ ] Obsidian 重新加载后设置持久化

## CI / 发布

- [ ] `build-all.yml` 所有 job 通过
- [ ] 版本号从 `v*` tag 正确注入所有组件
- [ ] release-manifest.json 包含所有 artifact 的路径和大小
- [ ] 无临时开发证书签名的组件被发布
- [ ] All-in-One NSIS 安装器在 CI 中实际生成
- [ ] 在干净 Windows VM 上执行安装→使用→卸载→重新安装测试

## 文档

- [ ] `docs/STATUS.md` 准确反映当前实现状态
- [ ] 各平台 README 中的支持范围与实际一致
- [ ] 已知限制在文档中明确列出
