Option Explicit

Private Const API_BASE As String = "http://127.0.0.1:19876"
Private Const DOC_COUNTER_NAME As String = "LaTeXSnipperEquationNumber"

Private Function HttpPost(url As String, body As String) As String
    On Error GoTo Fail
    Dim x As Object
    Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    x.Open "POST", url, False
    x.setRequestHeader "Content-Type", "application/json"
    x.send body
    If x.Status = 200 Then
        HttpPost = x.responseText
    Else
        Debug.Print "[HttpPost] Status=" & x.Status & " " & x.statusText & " URL=" & url
        HttpPost = ""
    End If
    Set x = Nothing
    Exit Function
Fail:
    Debug.Print "[HttpPost] Error: " & Err.Description & " (Err#" & Err.Number & ") URL=" & url
    HttpPost = ""
End Function

Private Function JsonEscape(s As String) As String
    s = Replace(s, "\", "\\")
    s = Replace(s, Chr(34), "\""")
    s = Replace(s, vbCrLf, "\n")
    s = Replace(s, vbCr, "\n")
    s = Replace(s, vbLf, "\n")
    JsonEscape = s
End Function

Private Function JsonVal(json As String, key As String) As String
    Dim sk As String, p As Long, q1 As Long, i As Long, raw As String
    sk = """" & key & """"
    p = InStr(json, sk): If p = 0 Then Exit Function
    p = InStr(p, json, ":"): If p = 0 Then Exit Function
    q1 = InStr(p, json, Chr(34)): If q1 = 0 Then Exit Function
    i = q1 + 1
    Do While i <= Len(json)
        If Mid$(json, i, 1) = "\" Then
            i = i + 2
        ElseIf Mid$(json, i, 1) = Chr(34) Then
            raw = Mid$(json, q1 + 1, i - q1 - 1)
            raw = Replace(raw, "\""", Chr(34))
            raw = Replace(raw, "\\", "\")
            raw = Replace(raw, "\n", vbLf)
            JsonVal = raw
            Exit Function
        Else
            i = i + 1
        End If
    Loop
End Function

Private Function DecodeHtmlEntities(s As String) As String
    Dim result As String
    result = s
    Dim pos As Long, endPos As Long, codeStr As String, code As Long

    Do
        pos = InStr(result, "&#")
        If pos = 0 Then Exit Do

        endPos = InStr(pos, result, ";")
        If endPos = 0 Then Exit Do

        codeStr = Mid$(result, pos + 2, endPos - pos - 2)
        If Left$(codeStr, 1) = "x" Or Left$(codeStr, 1) = "X" Then
            code = Val("&H" & Mid$(codeStr, 2) & "&")
        Else
            code = Val(codeStr)
        End If

        If code > 0 And code < 65536 Then
            result = Left$(result, pos - 1) & ChrW$(code) & Mid$(result, endPos + 1)
        Else
            result = Left$(result, pos - 1) & Mid$(result, endPos + 1)
        End If
    Loop

    DecodeHtmlEntities = result
End Function

Private Function CleanOmml(s As String) As String
    s = Replace(s, "<?xml version=""1.0""?>", "")
    s = Replace(s, "<?xml version=""1.0"" encoding=""utf-8""?>", "")
    s = Replace(s, " xmlns:mml=""http://www.w3.org/1998/Math/MathML""", "")
    s = DecodeHtmlEntities(s)
    s = Trim(s)

    s = Replace(s, "<m:eqAr>", "<m:eqArr>")
    s = Replace(s, "</m:eqAr>", "</m:eqArr>")
    s = Replace(s, "<m:t/>", "<m:t> </m:t>")

    Dim a As Long, b As Long
    a = InStr(s, "<m:oMathPara")
    If a > 0 Then
        b = InStr(a, s, "</m:oMathPara>")
        If b > a Then
            s = Mid$(s, a, b + Len("</m:oMathPara>") - a)
        End If
        CleanOmml = s
        Exit Function
    End If

    a = InStr(s, "<m:oMath")
    If a > 0 Then
        b = InStr(a, s, "</m:oMath>")
        If b > a Then
            s = Mid$(s, a, b + Len("</m:oMath>") - a)
        End If
    End If
    CleanOmml = s
End Function

Private Function BuildFlatOpc(oMathXml As String) As String
    Dim mathBody As String
    If InStr(oMathXml, "<m:oMathPara") > 0 Then
        mathBody = oMathXml
    Else
        mathBody = "<w:r>" & oMathXml & "</w:r>"
    End If

    BuildFlatOpc = "<?xml version=""1.0"" encoding=""UTF-8""?>" & _
        "<pkg:package xmlns:pkg=""http://schemas.microsoft.com/office/2006/xmlPackage"">" & _
        "<pkg:part pkg:name=""/_rels/.rels"" pkg:contentType=""application/vnd.openxmlformats-package.relationships+xml"" pkg:padding=""512"">" & _
        "<pkg:xmlData><Relationships xmlns=""http://schemas.openxmlformats.org/package/2006/relationships"">" & _
        "<Relationship Id=""rId1"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"" Target=""word/document.xml""/>" & _
        "</Relationships></pkg:xmlData></pkg:part>" & _
        "<pkg:part pkg:name=""/word/document.xml"" pkg:contentType=""application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"">" & _
        "<pkg:xmlData><w:document xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main"" xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">" & _
        "<w:body><w:p>" & mathBody & "</w:p></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>"
End Function

Private Function ReadPendingFormula(ByRef latex As String, ByRef fontColor As String, ByRef fontStyle As String) As Boolean
    Dim fPath As String, fNum As Integer, pendingData As String
    fPath = Environ("TEMP") & "\latexsnipper_pending.txt"

    If Dir(fPath) <> "" Then
        fNum = FreeFile
        Open fPath For Input As #fNum
        pendingData = Input$(LOF(fNum), fNum)
        Close #fNum
        Kill fPath
    End If

    If Len(pendingData) > 0 Then
        latex = JsonVal(pendingData, "latex")
        fontColor = JsonVal(pendingData, "fontColor")
        fontStyle = JsonVal(pendingData, "fontStyle")
        ReadPendingFormula = Len(latex) > 0
    End If
End Function

Private Function BuildConvertBody(latex As String, displayMode As Boolean, fontColor As String, fontStyle As String) As String
    Dim body As String
    body = "{""latex"":""" & JsonEscape(latex) & """,""display"":" & LCase$(CStr(displayMode))
    If Len(fontColor) > 0 Then body = body & ",""font_color"":""" & JsonEscape(fontColor) & """"
    If Len(fontStyle) > 0 Then body = body & ",""font_style"":""" & JsonEscape(fontStyle) & """"
    BuildConvertBody = body & "}"
End Function

Private Function NextEquationNumber() As String
    Dim n As Long
    On Error Resume Next
    n = CLng(ActiveDocument.Variables(DOC_COUNTER_NAME).Value)
    If Err.Number <> 0 Then
        Err.Clear
        n = 0
        ActiveDocument.Variables.Add DOC_COUNTER_NAME, "0"
    End If
    On Error GoTo 0

    n = n + 1
    On Error Resume Next
    ActiveDocument.Variables(DOC_COUNTER_NAME).Value = CStr(n)
    If Err.Number <> 0 Then
        Err.Clear
        ActiveDocument.Variables.Add DOC_COUNTER_NAME, CStr(n)
    End If
    On Error GoTo 0
    NextEquationNumber = "(" & CStr(n) & ")"
End Function

Private Sub InsertBasicNumberLabel()
    On Error Resume Next
    Application.Selection.TypeText " " & NextEquationNumber()
End Sub

Private Sub InsertFormulaCore(displayMode As Boolean, numbered As Boolean)
    Dim latex As String, fontColor As String, fontStyle As String
    Call ReadPendingFormula(latex, fontColor, fontStyle)

    If Len(latex) = 0 Then
        latex = InputBox("Enter LaTeX:", "LaTeXSnipper", "E=mc^2")
    End If
    If Len(latex) = 0 Then Exit Sub

    On Error GoTo HttpErr
    Dim resp As String
    resp = HttpPost(API_BASE & "/api/office/convert", BuildConvertBody(latex, displayMode Or numbered, fontColor, fontStyle))
    On Error GoTo 0

    If Len(resp) = 0 Then
        MsgBox "No response from LaTeXSnipper. Start the desktop app first.", vbCritical, "LaTeXSnipper"
        Exit Sub
    End If

    Dim omml As String
    omml = JsonVal(resp, "omml")
    If Len(omml) = 0 Then
        MsgBox "No OMML in response." & vbCrLf & Left$(resp, 300), vbCritical, "LaTeXSnipper"
        Exit Sub
    End If

    Dim clean As String
    clean = CleanOmml(omml)

    On Error GoTo InsertErr
    Application.Selection.Range.InsertXML BuildFlatOpc(clean)
    If numbered Then InsertBasicNumberLabel
    Exit Sub

InsertErr:
    MsgBox "InsertXML failed: " & Err.Description & " (Err#" & Err.Number & ")" & vbCrLf & _
           "OMML len=" & Len(clean), vbCritical, "LaTeXSnipper"
    Exit Sub

HttpErr:
    MsgBox "Bridge request failed: " & Err.Description, vbCritical, "LaTeXSnipper"
End Sub

Public Sub LaTeXInsertFormula()
    InsertFormulaCore True, False
End Sub

Public Sub LaTeXInsertInlineFormula()
    InsertFormulaCore False, False
End Sub

Public Sub LaTeXInsertDisplayFormula()
    InsertFormulaCore True, False
End Sub

Public Sub LaTeXInsertNumberedFormula()
    InsertFormulaCore True, True
End Sub

Public Sub LaTeXLoadSelectionXml()
    On Error Resume Next

    Dim eqCount As Long
    eqCount = Application.Selection.OMaths.Count
    Dim ommlXml As String

    If eqCount > 0 Then
        ommlXml = Application.Selection.OMaths(1).Range.Xml
    Else
        Dim rng As Object
        Set rng = Application.Selection.Range
        rng.Expand Unit:=4
        If rng.OMaths.Count > 0 Then
            Dim i As Long
            For i = 1 To rng.OMaths.Count
                If rng.OMaths(i).Range.Start <= Application.Selection.Start And _
                   rng.OMaths(i).Range.End >= Application.Selection.End Then
                    ommlXml = rng.OMaths(i).Range.Xml
                    Exit For
                End If
            Next i
        End If
    End If

    On Error GoTo 0

    If Len(ommlXml) > 0 Then
        Dim fPath As String
        fPath = Environ("TEMP") & "\latexsnipper_selection.16"

        Dim stream As Object
        Set stream = CreateObject("ADODB.Stream")
        stream.Type = 2
        stream.Charset = "Unicode"
        stream.Open
        stream.WriteText ommlXml
        stream.Position = 0
        stream.Type = 1
        Dim bytes() As Byte
        bytes = stream.Read
        stream.Close

        Set stream = CreateObject("ADODB.Stream")
        stream.Type = 1
        stream.Open
        stream.Write bytes
        stream.SaveToFile fPath, 2
        stream.Close
        Set stream = Nothing
        LaTeXShowApp
    Else
        MsgBox "No equation found at cursor position.", vbInformation, "LaTeXSnipper"
    End If
End Sub

Public Sub LaTeXLoadSelection()
    LaTeXLoadSelectionXml
End Sub

Public Sub LaTeXDeleteSelection()
    On Error Resume Next
    Application.Selection.Delete
End Sub

Public Sub LaTeXShowApp()
    Dim resp As String
    resp = HttpPost(API_BASE & "/api/office/show-app", "{}")
    If Len(resp) = 0 Then
        MsgBox "Start LaTeXSnipper Office first.", vbInformation, "LaTeXSnipper"
    End If
End Sub

Public Sub LaTeXScreenshotOcr()
    LaTeXShowApp
    MsgBox "Use the OCR tab in the LaTeXSnipper Office app, then send the result back to Word.", vbInformation, "LaTeXSnipper"
End Sub

Public Sub LaTeXInsertReference()
    MsgBox "References require the VSTO Office plugin metadata model. Use the released office_plugin build for full reference support.", vbInformation, "LaTeXSnipper"
End Sub

Public Sub LaTeXAutoNumberSelected()
    InsertBasicNumberLabel
End Sub

Public Sub LaTeXRenumberAll()
    On Error Resume Next
    ActiveDocument.Variables(DOC_COUNTER_NAME).Value = "0"
    MsgBox "Basic numbering counter reset. Full document renumbering requires the VSTO Office plugin.", vbInformation, "LaTeXSnipper"
End Sub

Public Sub LaTeXInsertChapterBoundary()
    Application.Selection.TypeText "[LaTeXSnipper chapter boundary]"
End Sub

Public Sub LaTeXInsertSectionBoundary()
    Application.Selection.TypeText "[LaTeXSnipper section boundary]"
End Sub

Public Sub LaTeXFormatSelection()
    MsgBox "Managed formula formatting requires the VSTO Office plugin.", vbInformation, "LaTeXSnipper"
End Sub

Public Sub LaTeXFormatAll()
    MsgBox "Document-wide formula formatting requires the VSTO Office plugin.", vbInformation, "LaTeXSnipper"
End Sub

Public Sub LaTeXConvertSelectedToOle()
    MsgBox "OLE conversion requires the native VSTO/OLE Office plugin.", vbInformation, "LaTeXSnipper"
End Sub

Public Sub LaTeXConvertSelectedToOmml()
    MsgBox "Selected managed formula conversion requires the VSTO Office plugin metadata model.", vbInformation, "LaTeXSnipper"
End Sub

Public Sub LaTeXSettings()
    LaTeXShowApp
End Sub

Public Sub LaTeXShowHelp()
    MsgBox "LaTeXSnipper Office" & vbCrLf & _
           "This VBA add-in supports basic Word OMML insertion and selection loading." & vbCrLf & _
           "Full OLE, PowerPoint, metadata, references, and robust numbering require the VSTO office_plugin.", _
           vbInformation, "LaTeXSnipper"
End Sub

Public Sub LaTeXTestInsert()
    Dim omml As String
    omml = "<m:oMathPara xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math""><m:oMath><m:r><m:t>E=mc^2</m:t></m:r></m:oMath></m:oMathPara>"

    On Error GoTo Fail
    Application.Selection.Range.InsertXML BuildFlatOpc(omml)
    MsgBox "Hardcoded OMML inserted OK", vbInformation, "Test"
    Exit Sub
Fail:
    MsgBox "FAIL: " & Err.Description, vbCritical, "Test"
End Sub

Public Sub LaTeXTestConnection()
    Dim resp As String
    Debug.Print "[Test] Connecting to " & API_BASE & "..."
    resp = HttpPost(API_BASE & "/api/office/load-selection", "{""text"":""test""}")
    If Len(resp) > 0 Then
        Debug.Print "[Test] OK: " & resp
        MsgBox "Connection OK: " & resp, vbInformation, "LaTeXSnipper"
    Else
        Debug.Print "[Test] FAILED - HttpPost returned empty"
        MsgBox "Connection FAILED. Start LaTeXSnipper Office first.", vbExclamation, "LaTeXSnipper"
    End If
End Sub
