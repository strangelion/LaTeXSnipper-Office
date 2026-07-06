function OnAddinLoad(ribbonUI) {
    if (typeof (window.Application.ribbonUI) != "object") {
        window.Application.ribbonUI = ribbonUI
    }
    if (typeof (window.Application.Enum) != "object") {
        window.Application.Enum = WPS_Enum
    }
    try {
        window.bridgeLog = function(msg) {
            try {
                var line = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, '') + ' ' + msg
                console.log('[LaTeXSnipper] ' + line)
                try { wps.OAAssist.HttpRequest('http://127.0.0.1:28766/log', 'POST', { 'Content-Type': 'application/json' }, JSON.stringify({ msg: line })) } catch(e) {}
            } catch(e) {}
        }

        window.Application.bridgeRelay = function(url, method, headers, body, callbackId) {
            try {
                window.bridgeLog('RELAY ' + (method||'GET') + ' ' + url)
                var result = wps.OAAssist.HttpRequest(url, method || "GET", headers || {}, body || "")
                window.bridgeLog('RELAY OK ' + url + ' (' + (result||'').length + ' bytes)')
                window.Application.PluginStorage.setItem("relay_" + callbackId, JSON.stringify({ ok: true, data: result }))
            } catch(e) {
                window.bridgeLog('RELAY ERROR ' + url + ': ' + e.message)
                window.Application.PluginStorage.setItem("relay_" + callbackId, JSON.stringify({ ok: false, error: e.message }))
            }
        }
        window.bridgeLog('OnAddinLoad called')
    } catch(e) {}
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

function getNextEquationNumber(doc) {
    let storage = window.Application.PluginStorage
    let counter = parseInt(storage.getItem("equation_counter") || "0") + 1
    storage.setItem("equation_counter", String(counter))
    return counter
}

function insertFormulaNumbered() {
    let doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }
    let latex = window.Application.PluginStorage.getItem("current_latex") || ""
    if (!latex.trim()) { alert("请先输入 LaTeX 公式"); return }

    let num = getNextEquationNumber(doc)
    insertEquation(latex, true)

    let selection = window.Application.Selection
    selection.Range.InsertAfter("\t(" + num + ")")
    selection.Range.Collapse(0)
}

function renumberAll() {
    let doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }

    let selection = window.Application.Selection
    let savedRange = null
    try { savedRange = doc.Range(selection.Range.Start, selection.Range.End) } catch(e) {}

    let fullRange = doc.Range(0, doc.Range().End)
    let find = fullRange.Find
    find.ClearFormatting()
    find.Text = "\\([0-9]@\\)"
    find.MatchWildcards = true
    find.Forward = true
    find.Wrap = 0

    let matches = []
    while (find.Execute()) {
        matches.push({ start: find.Parent.Start, end: find.Parent.End })
    }

    for (let i = matches.length - 1; i >= 0; i--) {
        let r = doc.Range(matches[i].start, matches[i].end)
        r.Text = "(" + (i + 1) + ")"
    }

    if (matches.length === 0) {
        alert("文档中未发现编号公式")
    } else {
        window.Application.PluginStorage.setItem("equation_counter", String(matches.length))
        alert("重新编号完成，共 " + matches.length + " 个公式")
    }

    if (savedRange) { try { savedRange.Select() } catch(e) {} }
}

function autoNumberFormulas() {
    let doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }

    let selection = window.Application.Selection
    let savedRange = null
    try { savedRange = doc.Range(selection.Range.Start, selection.Range.End) } catch(e) {}

    let paragraphs = doc.Paragraphs
    let equations = []

    for (let i = 1; i <= paragraphs.Count; i++) {
        let para = paragraphs.Item(i)
        let range = para.Range
        let hasOMath = false
        try { hasOMath = range.OMaths.Count > 0 } catch(e) {}
        if (!hasOMath) continue

        let oMath = range.OMaths.Item(1)
        let hasNumber = false

        try {
            let oRange = oMath.Range
            let oFind = oRange.Find
            oFind.ClearFormatting()
            oFind.Text = "\\([0-9]@\\)"
            oFind.MatchWildcards = true
            oFind.Forward = true
            hasNumber = oFind.Execute()
        } catch(e) {}

        if (!hasNumber) {
            try {
                let paraFind = range.Find
                paraFind.ClearFormatting()
                paraFind.Text = "\\([0-9]@\\)"
                paraFind.MatchWildcards = true
                paraFind.Forward = true
                hasNumber = paraFind.Execute()
            } catch(e) {}
        }

        equations.push({ paraIndex: i, hasNumber: hasNumber })
    }

    let fullRange = doc.Range(0, doc.Range().End)
    let find = fullRange.Find
    find.ClearFormatting()
    find.Text = "\\([0-9]@\\)"
    find.MatchWildcards = true
    find.Forward = true
    find.Wrap = 0

    let existingMatches = []
    while (find.Execute()) {
        existingMatches.push({ start: find.Parent.Start, end: find.Parent.End })
    }

    for (let i = existingMatches.length - 1; i >= 0; i--) {
        let r = doc.Range(existingMatches[i].start, existingMatches[i].end)
        r.Text = "(" + (i + 1) + ")"
    }

    let nextNum = existingMatches.length + 1
    let added = 0

    for (let eq of equations) {
        if (eq.hasNumber) continue
        let para = paragraphs.Item(eq.paraIndex)
        let range = para.Range
        let oMath = range.OMaths.Item(1)
        let oMathEnd = oMath.Range.End
        let insertRange = doc.Range(oMathEnd, oMathEnd)
        insertRange.InsertAfter("\t(" + nextNum + ")")
        nextNum++
        added++
    }

    let total = existingMatches.length + added
    window.Application.PluginStorage.setItem("equation_counter", String(total))

    if (total === 0) {
        alert("文档中未发现公式")
    } else {
        alert("自动编号完成，共 " + total + " 个公式（" + existingMatches.length + " 个已有编号，" + added + " 个新增编号）")
    }

    if (savedRange) { try { savedRange.Select() } catch(e) {} }
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
