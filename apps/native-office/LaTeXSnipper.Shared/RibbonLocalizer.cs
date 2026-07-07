#nullable enable
using System.Globalization;
using System.Collections.Generic;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Provides localized strings for Ribbon UI elements.
/// Uses Thread.CurrentThread.CurrentUICulture to select language.
/// </summary>
public static class RibbonLocalizer
{
    private static readonly Dictionary<string, Dictionary<string, string>> _strings = new()
    {
        ["en-US"] = new()
        {
            ["TabLabel"] = "LaTeXSnipper",
            ["LaTeXSnipperTab"] = "LaTeXSnipper",
            ["LaTeXSnipperPPTTab"] = "LaTeXSnipper",
            ["LaTeXSnipperExcelTab"] = "LaTeXSnipper",
            ["FormulaGroup"] = "Formula",
            ["EditGroup"] = "Edit",
            ["ToolsGroup"] = "Tools",
            ["btnInsertInline"] = "Insert Inline",
            ["btnInsertInline_screentip"] = "Insert Inline Formula",
            ["btnInsertInline_supertip"] = "Insert an inline LaTeX formula at cursor.",
            ["btnInsertDisplay"] = "Insert Display",
            ["btnInsertDisplay_screentip"] = "Insert Display Formula",
            ["btnInsertDisplay_supertip"] = "Insert a displayed LaTeX formula centered on its own line.",
            ["btnInsertNumbered"] = "Insert Numbered",
            ["btnInsertNumbered_screentip"] = "Insert Numbered Formula",
            ["btnInsertNumbered_supertip"] = "Insert a displayed formula with auto-numbering.",
            ["btnInsertFormula"] = "Insert Formula",
            ["btnInsertFormula_screentip"] = "Insert LaTeX Formula",
            ["btnInsertFormula_supertip"] = "Insert LaTeX as image or OLE object.",
            ["btnOcrSelector"] = "Screenshot OCR",
            ["btnOcrSelector_screentip"] = "Screen Capture OCR",
            ["btnOcrSelector_supertip"] = "Screenshot and convert to LaTeX via OCR.",
            ["btnLoadSelected"] = "Read Selection",
            ["btnLoadSelected_screentip"] = "Read Selected Formula",
            ["btnLoadSelected_supertip"] = "Read the selected formula into LaTeXSnipper.",
            ["btnDeleteSelected"] = "Delete",
            ["btnDeleteSelected_screentip"] = "Delete Formula",
            ["btnDeleteSelected_supertip"] = "Delete the selected formula from the document.",
            ["btnShowTaskPane"] = "Open LaTeXSnipper",
            ["btnShowTaskPane_screentip"] = "Open LaTeXSnipper Desktop",
            ["btnShowTaskPane_supertip"] = "Open the Desktop app for advanced editing.",
            ["btnSettings"] = "Settings",
            ["btnSettings_screentip"] = "LaTeXSnipper Settings",
            ["btnSettings_supertip"] = "Configure integration mode and preferences.",
            ["btnHelp"] = "Help",
            ["btnHelp_screentip"] = "LaTeXSnipper Help",
            ["btnHelp_supertip"] = "Version info and documentation links.",
            ["NoFormulaSelected"] = "No formula selected",
            ["FormulaDeleted"] = "Formula deleted",
            ["NotImplemented"] = "Not implemented",
            ["ErrorTitle"] = "LaTeXSnipper",
            ["ErrorOleNotAvailable"] = "OLE mode is not available on this system.",
            ["ErrorOleInitFailed"] = "Failed to initialize OLE formula object.",
            ["ErrorFallbackImage"] = "Rendering unavailable; check Desktop is running.",
            ["ErrorContextChanged"] = "Document context changed — please retry.",
            ["ErrorNoRenderData"] = "No image data for the current storage mode.",
            ["HelpText"] = "LaTeXSnipper v1.0.0\nNative Office plugin for Word, Excel, PowerPoint.",
        },
        ["zh-CN"] = new()
        {
            ["TabLabel"] = "LaTeXSnipper",
            ["LaTeXSnipperTab"] = "LaTeXSnipper",
            ["LaTeXSnipperPPTTab"] = "LaTeXSnipper",
            ["LaTeXSnipperExcelTab"] = "LaTeXSnipper",
            ["FormulaGroup"] = "公式",
            ["EditGroup"] = "编辑",
            ["ToolsGroup"] = "工具",
            ["btnInsertInline"] = "插入行内公式",
            ["btnInsertInline_screentip"] = "插入行内公式",
            ["btnInsertInline_supertip"] = "在光标位置插入行内 LaTeX 公式。",
            ["btnInsertDisplay"] = "插入显示公式",
            ["btnInsertDisplay_screentip"] = "插入显示公式",
            ["btnInsertDisplay_supertip"] = "插入居中显示的 LaTeX 公式。",
            ["btnInsertNumbered"] = "插入编号公式",
            ["btnInsertNumbered_screentip"] = "插入编号公式",
            ["btnInsertNumbered_supertip"] = "插入带自动编号的显示公式。",
            ["btnInsertFormula"] = "插入公式",
            ["btnInsertFormula_screentip"] = "插入 LaTeX 公式",
            ["btnInsertFormula_supertip"] = "以图片或 OLE 对象插入 LaTeX 公式。",
            ["btnOcrSelector"] = "屏幕识别",
            ["btnOcrSelector_screentip"] = "屏幕截图识别",
            ["btnOcrSelector_supertip"] = "截取屏幕区域并使用 OCR 转为 LaTeX。",
            ["btnLoadSelected"] = "读取选中内容",
            ["btnLoadSelected_screentip"] = "读取选中公式",
            ["btnLoadSelected_supertip"] = "将选中公式发送到 LaTeXSnipper。",
            ["btnDeleteSelected"] = "删除",
            ["btnDeleteSelected_screentip"] = "删除公式",
            ["btnDeleteSelected_supertip"] = "从文档中删除当前选中的公式。",
            ["btnShowTaskPane"] = "打开 LaTeXSnipper",
            ["btnShowTaskPane_screentip"] = "打开 LaTeXSnipper 桌面端",
            ["btnShowTaskPane_supertip"] = "打开桌面应用进行高级编辑。",
            ["btnSettings"] = "设置",
            ["btnSettings_screentip"] = "LaTeXSnipper 设置",
            ["btnSettings_supertip"] = "配置集成模式和偏好。",
            ["btnHelp"] = "帮助",
            ["btnHelp_screentip"] = "LaTeXSnipper 帮助",
            ["btnHelp_supertip"] = "查看版本信息和文档链接。",
            ["NoFormulaSelected"] = "未选中公式",
            ["FormulaDeleted"] = "公式已删除",
            ["NotImplemented"] = "未实现",
            ["ErrorTitle"] = "LaTeXSnipper",
            ["ErrorOleNotAvailable"] = "当前系统不支持 OLE 模式。",
            ["ErrorOleInitFailed"] = "OLE 公式对象初始化失败。",
            ["ErrorFallbackImage"] = "渲染不可用，请检查桌面端是否运行。",
            ["ErrorContextChanged"] = "文档上下文已变更，请重试。",
            ["ErrorNoRenderData"] = "当前存储模式没有可用图像数据。",
            ["HelpText"] = "LaTeXSnipper v1.0.0\nWord、Excel、PowerPoint 的原生 Office 公式插件。",
        },
    };

    public static string GetString(string key)
    {
        var culture = CultureInfo.CurrentUICulture.Name;
        if (_strings.TryGetValue(culture, out var table) && table.TryGetValue(key, out var value))
            return value;

        // Fallback to en-US
        if (_strings.TryGetValue("en-US", out var enTable) && enTable.TryGetValue(key, out var enValue))
            return enValue;

        return key;
    }
}
