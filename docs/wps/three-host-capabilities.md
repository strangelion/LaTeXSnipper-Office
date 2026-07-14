# WPS three-host capabilities

| 能力 | Writer (`wps`) | Spreadsheets (`et`) | Presentation (`wpp`) |
|---|---|---|---|
| 插入 | Native OMath | PNG shape | PNG shape |
| 读取 | bookmark + Variables | shape metadata | shape metadata |
| 更新 | candidate-first | candidate-first | candidate-first |
| 删除 | owned range/table | owned shape | owned shape |
| 全局编号 | Implemented, Beta | Unsupported | Unsupported |
| chapter 编号 | Unsupported | Unsupported | Unsupported |
| 自动测试 | Yes | Yes | Yes |
| 真宿主稳定性 | Pending | Pending | Pending |

Writer numbered 使用完整宽度无边框 1x3 table，左右 gutter 相等，公式居中，编号右对齐；只扫描 LaTeXSnipper-owned metadata。ET/WPP 维护 FormulaId、revision、位置、尺寸、旋转和 metadata readback，不把图片称为 OLE。

只有实际打开三个 WPS 宿主并完成安装、加载、heartbeat、CRUD、save/reopen 验收后，相关项才可从 Beta 升级。
