Option Explicit

Sub LSInsertFormula(button As IRibbonControl)
    LaTeXInsertDisplayFormula
End Sub

Sub LSInsertInline(button As IRibbonControl)
    LaTeXInsertInlineFormula
End Sub

Sub LSInsertDisplay(button As IRibbonControl)
    LaTeXInsertDisplayFormula
End Sub

Sub LSInsertNumbered(button As IRibbonControl)
    LaTeXInsertNumberedFormula
End Sub

Sub LSScreenshotOcr(button As IRibbonControl)
    LaTeXScreenshotOcr
End Sub

Sub LSLoadSelection(button As IRibbonControl)
    LaTeXLoadSelectionXml
End Sub

Sub LSDeleteSelection(button As IRibbonControl)
    LaTeXDeleteSelection
End Sub

Sub LSConvertToOLE(button As IRibbonControl)
    LaTeXConvertSelectedToOle
End Sub

Sub LSConvertToWord(button As IRibbonControl)
    LaTeXConvertSelectedToOmml
End Sub

Sub LSInsertReference(button As IRibbonControl)
    LaTeXInsertReference
End Sub

Sub LSAddNumber(button As IRibbonControl)
    LaTeXAutoNumberSelected
End Sub

Sub LSRenumber(button As IRibbonControl)
    LaTeXRenumberAll
End Sub

Sub LSInsertChapterBoundary(button As IRibbonControl)
    LaTeXInsertChapterBoundary
End Sub

Sub LSInsertSectionBoundary(button As IRibbonControl)
    LaTeXInsertSectionBoundary
End Sub

Sub LSFormatSelection(button As IRibbonControl)
    LaTeXFormatSelection
End Sub

Sub LSFormatAll(button As IRibbonControl)
    LaTeXFormatAll
End Sub

Sub LSOpenApp(button As IRibbonControl)
    LaTeXShowApp
End Sub

Sub LSSettings(button As IRibbonControl)
    LaTeXSettings
End Sub

Sub LSShowHelp(button As IRibbonControl)
    LaTeXShowHelp
End Sub
