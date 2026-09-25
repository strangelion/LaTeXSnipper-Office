# 发版流程（Release）

本文档描述本仓库正式发版的完整流程与硬性约束。触发条件与校验逻辑来自 `.github/workflows/release.yml` 和 `scripts/bump-version.ps1` 的实际源码。

## 总览

| 阶段 | 动作                                            | 负责方                                 |
| ---- | ----------------------------------------------- | -------------------------------------- |
| 1    | 提升版本号并提交、推送 `main`                   | `scripts/bump-version.ps1`             |
| 2    | 打 `vX.Y.Z` tag 并推送                          | `scripts/bump-version.ps1 -Tag` 或手动 |
| 3    | 版本一致性校验、各平台打包、发布 GitHub Release | `.github/workflows/release.yml`        |

## 前置条件

- 当前在 `main` 分支，工作区干净，且与远端一致（`bump-version.ps1` 会检查这三项）。
- 仓库 secrets 已配置发布证书：`release_mode` 下 `package-verify.yml` 需要 `VSTO_CERT_BASE64` 与 `VSTO_CERT_PASSWORD`，用于解出发布用 PFX 并重签 VSTO/MSI 产物。
- 上一个版本的 GitHub Release 必须**已发布**（非 draft、非 prerelease），否则 `prior_tag` 解析不到，升级测试基线会缺失。

## 步骤

### 1. 提升版本并推送

```powershell
# 自动提交并推送 main，同时创建并推送 v1.7.3 tag
powershell -ExecutionPolicy Bypass -File scripts\bump-version.ps1 -Version 1.7.3 -Tag
```

脚本按以下顺序执行（源码中 step 13-15）：

1. 改写所有版本字段（`package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`apps/browser-extension/*`、`apps/wps/*`、`contracts/resources.v1.json`）并重建插件资源；
2. `git commit -m "chore: bump version to X.Y.Z"`；
3. 提交后跑 `npm run check:resource-drift` 与 `npm run check:ecosystem-drift`，任一失败则**拒绝打 tag 和推送**；
4. `git push origin main`；
5. 若带 `-Tag`：删除同名**本地** tag（若存在）、`git tag vX.Y.Z`、`git push origin vX.Y.Z`。

只想先提交、稍后再推送时用 `-NoPush`；此时脚本会提前退出，需要手动补：

```bash
git push origin main
git tag vX.Y.Z && git push origin vX.Y.Z
```

### 2. tag 必须指向「树内版本等于 tag 版本」的提交

`release.yml` 的 `prepare-release` job 会校验 tag 存在性，并逐一比对 tag 指向提交内的 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 的 `version`，任一不等即失败：

```text
package.json version mismatch: tag=1.7.2 file=1.7.1
tauri.conf.json version mismatch: tag=...
Cargo.toml version mismatch: tag=...
```

失败时该 job 数秒内即结束，`package-required`、`component-packages`、`publish` 全部跳过。

**因此不要先打 tag 再 bump**：tag 指向 bump 之前的提交时，其树内版本仍是旧版本，校验必然失败。历史实例：tag `v1.7.2` 曾指向 bump 提交之前的 `71ca691`（树内 `1.7.1`），Release 运行 `36110221837` 因此失败。

### 3. 修正打错位置的 tag

远端已存在同名 tag 且指向错误提交时，普通 `git push` 会被拒绝（non-fast-forward），需要强制更新：

```bash
git push origin --force-with-lease=refs/tags/v1.7.3:<旧提交SHA> refs/tags/v1.7.3
```

强制更新 tag 会**重新触发** `release.yml`；该 workflow 的并发组为 `release-<tag>`、`cancel-in-progress: false`，因此新运行不会打断仍在跑的旧运行。

### 4. 验证

```bash
gh run list --limit 5                                        # 查看是否出现 vX.Y.Z Release 运行
gh run view <run-id>                                         # 查看 job 列表与状态
gh run view <run-id> --log-failed                            # 失败时定位失败步骤
git ls-remote origin refs/heads/main 'refs/tags/vX.Y.Z*'     # 核对远端实际值
```

`prepare-release` 通过（约 9 秒）即表示版本校验通过，随后 `package-required`（Windows / Linux / macOS）与 `component-packages` 开始打包，最后由 `publish` job 发布 Release。

### 5. 组件级 tag

组件可以独立发版，各自触发对应 workflow：

| tag 前缀           | workflow                      |
| ------------------ | ----------------------------- |
| `browser-v*`       | `build-browser-extension.yml` |
| `vscode-v*`        | `build-vscode-extension.yml`  |
| `obsidian-v*`      | `build-obsidian-plugin.yml`   |
| `wps-v*`           | `build-wps-plugin.yml`        |
| `native-office-v*` | `build-native-office.yml`     |

## 常见坑

1. **`src-tauri/Cargo.lock` 必须是 LF 行尾。** 本仓库 `.gitattributes` 为 `* text=auto`，`core.autocrlf=true` 时该文件会被检出为 CRLF，而 `scripts/bump-version.ps1` 匹配 `latexsnipper-office` 版本号的正则以 `("$)` 结尾（.NET 多行模式下 `$` 只匹配 `\n` 之前），CRLF 文件匹配数为 0，脚本随即报错 `Expected exactly one latexsnipper-office package entry in src-tauri/Cargo.lock, found 0`。修复：把该文件归一化为 LF（PowerShell `ReadAllText` → `Replace("\r\n","\n")` → `WriteAllText`），必要时 `git add` 一次让索引与工作区一致。
2. **受保护的 NativeOffice payload 不在 bump 提交里。** `bump-version.ps1` 的提交清单不含 `src-tauri/resources/NativeOffice/**` 与 `src-tauri/resources/provenance.json`，刷新产物按历史约定单独提交（如 `chore(native-office): refresh CI-verified host payload`）。
3. **不要提交本地 dev 自签名证书产出的 NativeOffice payload。** 未设置发布证书时，`apps/native-office/Installer/build.ps1` 会回退到自动生成的自签名证书，产出的 `native-office-signing.json` 指纹与被跟踪文件不同；发布产物由 CI 用发布 PFX 重签。
4. **`bump-version.ps1` 的远端检查不联网。** 它只用 `git rev-list --count 'HEAD..@{u}'`，因此代理未生效、网络不通时依然会打印 `OK: up to date with remote`；随后步骤 14/15 的 `git push` 才会真正失败。
5. **本地 bump 失败后要清理残留改动。** 脚本在中途失败会留下已改写的版本字段；重跑前先确认工作区状态，避免把半成品带进提交。

## 相关文件

| 路径                                                                        | 作用                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------ |
| `scripts/bump-version.ps1`                                                  | 版本提升、提交、推送、打 tag                           |
| `scripts/stage-resources.ps1`                                               | 暂存 Tauri 资源；含 NativeOffice provenance 提交号校验 |
| `scripts/build-native-office.js` / `apps/native-office/Installer/build.ps1` | 本地构建 VSTO/MSI 与 provenance                        |
| `.github/workflows/release.yml`                                             | tag 触发的发布主流程与版本校验                         |
| `.github/workflows/package-verify.yml`                                      | 可复用的打包/验证流程，`release_mode` 下使用发布证书   |
