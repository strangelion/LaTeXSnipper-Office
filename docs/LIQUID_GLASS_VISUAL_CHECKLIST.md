# Liquid Glass 2.0 真机视觉验证清单

适用于 `strangelion/LaTeXSnipper-Office`，基线 `94b8b1c` 之上的 Liquid Glass 2.0 实施。
无头浏览器自动化（`scripts/verify-liquid-dock.mjs`）已覆盖 15 项功能断言，本清单用于
**真机 WebView2 环境**下的视觉与性能验收，这些无法由无头脚本完全替代。

## 0. 准备

- 启动应用：`npm run dev`（Tauri + WebView2）
- 准备一个带公式的文档：`x^2 + y^2 = z^2`
- 打开设置 → 外观，确认存在「液态玻璃」与「实时材质预览」卡片
- 确保系统「动画效果」开启（否则自动模式会落入 static 档）

## 1. 基本场景截图（每项各截一张）

在 Windows 11、亮色主题、100% 缩放、全窗口下：

| #   | 场景                        | 期望                                                                                  |
| --- | --------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Dock 静止（鼠标不进入）     | 连续玻璃底座，无按钮单独胶囊，dock 自身 999px 圆角、半透明、有环境透光                |
| 2   | Hover 左侧（复制 LaTeX）    | 唯一 Lens 出现且贴合按钮，Lens 内高光偏左，Dock 左侧更亮                              |
| 3   | Hover 中间（复制 MathML）   | Lens 滑动至中间并改变宽度，高光随鼠标移动，Dock 高光场跟随                            |
| 4   | Hover 右侧（插入/复制 SVG） | Lens 在最右侧，高光偏右                                                               |
| 5   | 从 LaTeX 快速移到 Word 插入 | Lens 连续滑动（非瞬移），Preview 约 180ms 后浮出，不闪烁                              |
| 6   | 鼠标离开 Dock               | Preview 消失，Lens 回 active（无 active 则隐藏），高光场慢速回 50%/24%                |
| 7   | 点击按钮                    | Lens 脉冲一次（320ms），无卡顿                                                        |
| 8   | Tab 键导航                  | Lens 跟随键盘焦点移动，focus-visible 轮廓可见                                         |
| 9   | Preview 内容                | 复制 LaTeX 显示公式 + 源码；插入 Word 显示文档名/版式/路线/连接状态，**不伪造已连接** |

## 2. 明暗主题

- 亮色：dock 背景偏白透、Lens 白色高光明显
- 暗色：dock 深蓝透、Lens 白色 8.5% 透明度，Lens 边框仍然清晰
- 两主题下 Preview 文字可读性（尤其 status 徽标 ok/warn/error 色）

## 3. DPI 缩放（Windows 显示设置）

分别以 100% / 125% / 150% / 200% 重开应用，重复第 1 节场景 1、2、5：

- Lens 不错位、不超出 Dock、不糊边
- Preview 不溢出窗口（`min(340px, 100vw-40px)` 约束生效）
- 高 DPI 下拖动鼠标无明显掉帧（WebView2 GPU 合成）

## 4. 性能验收（场景 6 高频移动 10 秒）

- 在 10 秒内快速来回移动鼠标划过全部按钮
- DevTools（WebView2：F12）→ Performance 录制：
  - 无持续 Layout / Style Recalc 峰值（每 pointermove 仅一次 CSS 变量写入）
  - 无 DOM 节点增长（`document.querySelectorAll('*').length` 稳定）
  - 无 RAF 泄漏（空闲时 Performance 面板无持续动画帧回调）
  - 无 Preview timer 堆积（快速扫过按钮后 `setTimeout` 残留不超过 1 个）

## 5. 档位验证

| 档位    | 触发方式                           | 期望                                                                       |
| ------- | ---------------------------------- | -------------------------------------------------------------------------- |
| full    | 设置「开启」或「自动」+ 高性能设备 | 全部效果（Lens 滑动 + 高光场 + 形变 + Preview + pulse）                    |
| reduced | 自动 + 4~8 核/4~8GB，或手动模拟    | 保留 blur/Lens 滑动/Preview；无每帧高光场跟踪；形变关闭；local offset ≤3px |
| static  | 系统「减少动画」或低端设备         | 保留玻璃材质与 selected 状态；无滑动/pulse/指针跟踪/形变                   |
| off     | 设置「关闭」                       | 纯平面：无 backdrop-filter、无动态 Lens、无 Preview                        |

验证方式：DevTools 控制台检查 `document.documentElement.dataset.liquidQuality`，
应分别为 `full` / `reduced` / `static` / `off`。

## 6. 设置页实时材质预览

- 打开设置 → 外观，背景为蓝/紫/青渐变墙
- 鼠标划过 4 个演示按钮：Lens 滑动、高光场跟随
- 切换 自动/开启/关闭：材质立即变化（模糊、饱和度、透明度）
- 「关闭」后演示 dock 无 backdrop-filter、Lens 消失

## 7. Office 集成回归（不被玻璃影响）

- 连接真实 Word（`native_office_sessions` 有会话）后插入公式：正常
- 复制 LaTeX / MathML / SVG 到剪贴板：格式不变
- 交叉引用 / 公式目录 / 检查编号：正常弹窗
- OLE 状态页：注册状态显示正确

## 8. 已知限制（记录而非失败）

- 无头脚本 `scripts/verify-liquid-dock.mjs` 需要 `PW_CORE` 指向本地
  `playwright-core` 安装路径；本机浏览器为系统 WebView2 / ms-playwright Chromium
- 真机视觉（尤其 DPI 与动画流畅度）只能人工验收，本清单即验收凭据

## 9. 完成标准

以上场景全部符合期望后，在 `STATUS.md` 记录验证日期与结论。
