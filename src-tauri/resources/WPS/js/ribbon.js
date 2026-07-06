function OnAddinLoad(ribbonUI) {
    if (typeof (window.Application.ribbonUI) != "object") {
        window.Application.ribbonUI = ribbonUI
    }
    if (typeof (window.Application.Enum) != "object") {
        window.Application.Enum = WPS_Enum
    }
    return true
}

function OnAction(control) {
    const eleId = control.Id
    switch (eleId) {
        case "btnInsertInline": insertFormula(false); break
        case "btnInsertDisplay": insertFormula(true); break
        case "btnInsertNumbered": insertFormulaNumbered(); break
        case "btnScreenshotOcr": screenshotOcr(); break
        case "btnLoadSelected": loadSelectedFormula(); break
        case "btnDeleteSelected": deleteSelectedFormula(); break
        case "btnAutoNumber": autoNumberFormulas(); break
        case "btnRenumber": renumberAll(); break
        case "btnShowTaskPane": showTaskPane(); break
        case "btnSettings": showTaskPane(); break
        case "btnHelp": window.open("https://latexsnipper.readthedocs.io/", "_blank"); break
    }
    return true
}

function GetImage(control) {
    const eleId = control.Id
    switch (eleId) {
        case "btnInsertInline": return "images/insert_inline.svg"
        case "btnInsertDisplay": return "images/insert_display.svg"
        case "btnInsertNumbered": return "images/insert_numbered.svg"
        case "btnScreenshotOcr": return "images/screenshot_ocr.svg"
        case "btnLoadSelected": return "images/load_selected.svg"
        case "btnDeleteSelected": return "images/delete_selected.svg"
        case "btnAutoNumber": return "images/auto_number.svg"
        case "btnRenumber": return "images/renumber.svg"
        case "btnShowTaskPane": return "images/task_pane.svg"
        case "btnSettings": return "images/settings.svg"
        case "btnHelp": return "images/help.svg"
    }
    return "images/insert_inline.svg"
}

function OnGetEnabled(control) { return true }
function OnGetVisible(control) { return true }

function showTaskPane() {
    let tsId = window.Application.PluginStorage.getItem("taskpane_id")
    if (!tsId) {
        let tskpane = window.Application.CreateTaskPane(GetUrlPath() + "/ui/taskpane.html")
        let id = tskpane.ID
        window.Application.PluginStorage.setItem("taskpane_id", id)
        tskpane.Visible = true
    } else {
        let tskpane = window.Application.GetTaskPane(tsId)
        tskpane.Visible = !tskpane.Visible
    }
}

function insertEquation(latex, display) {
    let doc = window.Application.ActiveDocument
    if (!doc) return false

    let selection = window.Application.Selection
    let startPos = selection.Range.End

    selection.TypeText(latex)
    let endPos = selection.Range.End
    let insertedRange = doc.Range(startPos, endPos)
    insertedRange.Select()

    selection.OMaths.Add(selection.Range)

    if (selection.OMaths.Count > 0) {
        let oMath = selection.OMaths.Item(1)
        if (display) { try { oMath.Justification = 1 } catch(e) {} }
        try { oMath.BuildUp() } catch(e) {}

        selection.Range.Collapse(0)
        return true
    }

    selection.Range.Collapse(0)
    return false
}

function insertFormula(display) {
    let doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }
    let latex = window.Application.PluginStorage.getItem("current_latex") || ""
    if (!latex.trim()) { alert("请先输入 LaTeX 公式"); return }
    insertEquation(latex, display)
}

function insertFormulaNumbered() {
    let doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }
    let latex = window.Application.PluginStorage.getItem("current_latex") || ""
    if (!latex.trim()) { alert("请先输入 LaTeX 公式"); return }

    insertEquation(latex, true)

    let selection = window.Application.Selection
    let num = getNextEquationNumber(doc)
    selection.Range.InsertAfter("\t(" + num + ")")
    selection.Range.Collapse(0)
}

function getNextEquationNumber(doc) {
    let content = doc.Content.Text
    let regex = /\((\d+)\)/g
    let maxNum = 0
    let match
    while ((match = regex.exec(content)) !== null) {
        let num = parseInt(match[1])
        if (num > maxNum) maxNum = num
    }
    return maxNum + 1
}

function autoNumberFormulas() {
    let doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }
    let content = doc.Content.Text
    let regex = /\((\d+)\)/g
    let count = 0
    while (regex.exec(content) !== null) count++
    if (count === 0) { alert("文档中未发现编号公式"); return }
    alert("发现 " + count + " 个编号公式")
}

function renumberAll() {
    let doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }

    let paragraphs = doc.Paragraphs
    let counter = 1
    let replaced = 0

    for (let i = 1; i <= paragraphs.Count; i++) {
        let para = paragraphs.Item(i)
        let range = para.Range
        let text = range.Text

        if (!/\(\d+\)/.test(text)) continue

        let find = range.Find
        find.ClearFormatting()
        find.Text = "\\([0-9]+\\)"
        find.MatchWildcards = true
        find.Forward = true

        while (find.Execute()) {
            let foundRange = doc.Range(range.Start, find.Parent.End)
            foundRange.Text = "(" + counter + ")"
            counter++
            replaced++
            range = doc.Paragraphs.Item(i).Range
            find.Range.SetRange(find.Parent.End, range.End)
        }
    }

    if (replaced === 0) {
        alert("文档中未发现编号公式")
    } else {
        alert("重新编号完成，共 " + replaced + " 个公式")
    }
}

function screenshotOcr() { alert("截图识别功能开发中") }

function loadSelectedFormula() {
    let doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }
    let selection = window.Application.Selection
    if (selection.InlineShapes.Count > 0 || selection.OMaths.Count > 0) {
        alert("已选中公式")
    } else {
        alert("请先选中一个公式")
    }
}

function deleteSelectedFormula() {
    let doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }
    let selection = window.Application.Selection
    if (selection.InlineShapes.Count > 0 || selection.OMaths.Count > 0) {
        selection.Range.Delete()
    } else {
        alert("请先选中一个公式")
    }
}
