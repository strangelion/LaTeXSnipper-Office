// LaTeXSnipper WPS Ribbon v3.0
// All actions route through CommandLayer.dispatch().
// No direct WPS API calls — see command-layer.js for adapter logic.

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
                try { wps.OAAssist.HttpRequest('https://127.0.0.1:19876/log', 'POST', { 'Content-Type': 'application/json' }, JSON.stringify({ msg: line })) } catch(e) {}
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
        case "btnInsertInline":
            insertFromStorage("inline"); break
        case "btnInsertDisplay":
            insertFromStorage("block"); break
        case "btnInsertNumbered":
            insertFromStorage("numbered"); break
        case "btnScreenshotOcr":
            CommandLayer.dispatch("wps", { type: "OpenEditor" }); break
        case "btnLoadSelected":
            loadSelectedFormula(); break
        case "btnDeleteSelected":
            deleteSelectedFormula(); break
        case "btnAutoNumber":
            autoNumberFormulas(); break
        case "btnRenumber":
            renumberAll(); break
        case "btnShowTaskPane":
            CommandLayer.dispatch("wps", { type: "OpenEditor" }); break
        case "btnSettings":
            CommandLayer.dispatch("wps", { type: "OpenSettings" }); break
        case "btnHelp":
            window.open("https://latexsnipper.readthedocs.io/", "_blank"); break
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

// ─── Dispatch helpers ────────────────────────────────────────────────

function insertFromStorage(display) {
    var latex = window.Application.PluginStorage.getItem("current_latex") || ""
    if (!latex.trim()) { alert("请先在公式编辑器中输入 LaTeX 公式"); return }
    CommandLayer.dispatch("wps", {
        type: "InsertFormula",
        payload: { latex: latex, display: display }
    }).then(function(result) {
        if (!result.ok) alert("插入失败: " + result.error)
    })
}

function loadSelectedFormula() {
    CommandLayer.dispatch("wps", { type: "GetSelection" }).then(function(result) {
        if (result.ok && result.data) {
            window.Application.PluginStorage.setItem("current_latex", result.data)
            window.bridgeLog("Loaded selection: " + result.data.substring(0, 60))
            alert("已加载选中公式")
        } else {
            alert("请先选中一个公式")
        }
    })
}

function deleteSelectedFormula() {
    CommandLayer.dispatch("wps", { type: "ReplaceSelection", payload: { content: "" } }).then(function(result) {
        if (result.ok) {
            window.bridgeLog("Deleted selection")
        } else {
            alert("删除失败: " + result.error)
        }
    })
}

// ─── Numbering helpers ───────────────────────────────────────────────

function getNextEquationNumber(doc) {
    var storage = window.Application.PluginStorage
    var counter = parseInt(storage.getItem("equation_counter") || "0") + 1
    storage.setItem("equation_counter", String(counter))
    return counter
}

function renumberAll() {
    var doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }

    var selection = window.Application.Selection
    var savedRange = null
    try { savedRange = doc.Range(selection.Range.Start, selection.Range.End) } catch(e) {}

    var fullRange = doc.Range(0, doc.Range().End)
    var find = fullRange.Find
    find.ClearFormatting()
    find.Text = "\\([0-9]@\\)"
    find.MatchWildcards = true
    find.Forward = true
    find.Wrap = 0

    var matches = []
    while (find.Execute()) {
        matches.push({ start: find.Parent.Start, end: find.Parent.End })
    }

    for (var i = matches.length - 1; i >= 0; i--) {
        var r = doc.Range(matches[i].start, matches[i].end)
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
    var doc = window.Application.ActiveDocument
    if (!doc) { alert("请先打开一个文档"); return }

    var selection = window.Application.Selection
    var savedRange = null
    try { savedRange = doc.Range(selection.Range.Start, selection.Range.End) } catch(e) {}

    var paragraphs = doc.Paragraphs
    var equations = []

    for (var i = 1; i <= paragraphs.Count; i++) {
        var para = paragraphs.Item(i)
        var range = para.Range
        var hasOMath = false
        try { hasOMath = range.OMaths.Count > 0 } catch(e) {}
        if (!hasOMath) continue

        var oMath = range.OMaths.Item(1)
        var hasNumber = false

        try {
            var oRange = oMath.Range
            var oFind = oRange.Find
            oFind.ClearFormatting()
            oFind.Text = "\\([0-9]@\\)"
            oFind.MatchWildcards = true
            oFind.Forward = true
            hasNumber = oFind.Execute()
        } catch(e) {}

        if (!hasNumber) {
            try {
                var paraFind = range.Find
                paraFind.ClearFormatting()
                paraFind.Text = "\\([0-9]@\\)"
                paraFind.MatchWildcards = true
                paraFind.Forward = true
                hasNumber = paraFind.Execute()
            } catch(e) {}
        }

        equations.push({ paraIndex: i, hasNumber: hasNumber })
    }

    var fullRange = doc.Range(0, doc.Range().End)
    var find = fullRange.Find
    find.ClearFormatting()
    find.Text = "\\([0-9]@\\)"
    find.MatchWildcards = true
    find.Forward = true
    find.Wrap = 0

    var existingMatches = []
    while (find.Execute()) {
        existingMatches.push({ start: find.Parent.Start, end: find.Parent.End })
    }

    for (var j = existingMatches.length - 1; j >= 0; j--) {
        var r = doc.Range(existingMatches[j].start, existingMatches[j].end)
        r.Text = "(" + (j + 1) + ")"
    }

    var nextNum = existingMatches.length + 1
    var added = 0

    for (var eq of equations) {
        if (eq.hasNumber) continue
        var para = paragraphs.Item(eq.paraIndex)
        var range = para.Range
        var oMath = range.OMaths.Item(1)
        var oMathEnd = oMath.Range.End
        var insertRange = doc.Range(oMathEnd, oMathEnd)
        insertRange.InsertAfter("\t(" + nextNum + ")")
        nextNum++
        added++
    }

    var total = existingMatches.length + added
    window.Application.PluginStorage.setItem("equation_counter", String(total))

    if (total === 0) {
        alert("文档中未发现公式")
    } else {
        alert("自动编号完成，共 " + total + " 个公式（" + existingMatches.length + " 个已有编号，" + added + " 个新增编号）")
    }

    if (savedRange) { try { savedRange.Select() } catch(e) {} }
}
