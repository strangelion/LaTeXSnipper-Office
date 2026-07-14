# Office.js asset policy

生产 task pane 使用 Microsoft 官方 `https://appsforoffice.microsoft.com/lib/1/hosted/office.js`（hosted/1）。这是 Office add-in 的兼容性来源，不因 VisualTeX 的本地托管方案而替换。离线时 Office.js 功能不可用，UI 必须诚实报告，不得声称完全离线。

构建工具固定 `@types/office-js` lockfile 版本；`provenance.json` 记录 hosted source、typings version、本地 Office.js bundle SHA-256、MathJax 版本、构建平台和 manifest version。官方 hosted/1 内容由 Microsoft 更新，无法提供稳定内容 SHA-256，因此 `officeJsSha256` 明确为 null，而不是伪造固定哈希。

task pane CSP 仅允许 self、Microsoft Office.js origin、Bridge HTTPS origin、data/blob 图片；禁止 object、base 和 form。WPS CSP 只允许 self、data/blob 资源。回滚方式是恢复上一 release 的 manifest、task pane bundle 和 provenance；不会回退到任意第三方 CDN。
