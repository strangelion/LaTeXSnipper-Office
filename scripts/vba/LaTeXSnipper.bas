Option Explicit

Private Const API_BASE As String = "http://127.0.0.1:19876"

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

Private Function JsonVal(json As String, key As String) As String
    Dim sk As String, p As Long, q1 As Long, i As Long
    sk = """" & key & """"
    p = InStr(json, sk): If p = 0 Then Exit Function
    p = InStr(p, json, ":"): If p = 0 Then Exit Function
    q1 = InStr(p, json, Chr(34)): If q1 = 0 Then Exit Function
    i = q1 + 1
    Do While i <= Len(json)
        If Mid$(json, i, 1) = "\" Then
            i = i + 2
        ElseIf Mid$(json, i, 1) = Chr(34) Then
            JsonVal = Replace(Mid$(json, q1 + 1, i - q1 - 1), "\""", Chr(34))
            Exit Function
        Else
            i = i + 1
        End If
    Loop
End Function

Private Function CleanOmml(s As String) As String
    s = Replace(s, " xmlns:mml=""http://www.w3.org/1998/Math/MathML""", "")
    s = Replace(s, "<?xml version=""1.0""?>", "")
    s = Replace(s, "<?xml version=""1.0"" encoding=""utf-8""?>", "")
    s = Trim(s)
    Dim a As Long, b As Long
    a = InStr(s, "<m:oMath")
    b = InStr(s, "</m:oMath>")
    If a > 0 And b > a Then s = Mid$(s, a, b + 10 - a)
    CleanOmml = s
End Function

Private Function BuildFlatOpc(oMathXml As String) As String
    BuildFlatOpc = "<?xml version=""1.0"" encoding=""UTF-8""?>" & _
        "<pkg:package xmlns:pkg=""http://schemas.microsoft.com/office/2006/xmlPackage"">" & _
        "<pkg:part pkg:name=""/_rels/.rels"" pkg:contentType=""application/vnd.openxmlformats-package.relationships+xml"" pkg:padding=""512"">" & _
        "<pkg:xmlData><Relationships xmlns=""http://schemas.openxmlformats.org/package/2006/relationships"">" & _
        "<Relationship Id=""rId1"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"" Target=""word/document.xml""/>" & _
        "</Relationships></pkg:xmlData></pkg:part>" & _
        "<pkg:part pkg:name=""/word/document.xml"" pkg:contentType=""application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"">" & _
        "<pkg:xmlData><w:document xmlns:w=""http://schemas.openxmlformats.org/wordprocessingml/2006/main"" xmlns:m=""http://schemas.openxmlformats.org/officeDocument/2006/math"">" & _
        "<w:body><w:p><w:r>" & oMathXml & "</w:r></w:p></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>"
End Function

Public Sub LaTeXInsertFormula()
    Dim latex As String
    Dim resp As String
    Dim omml As String
    Dim fPath As String
    Dim fNum As Integer
    Dim pendingData As String

    On Error Resume Next
    fPath = Environ("TEMP") & "\latexsnipper_pending.txt"
    If Dir(fPath) <> "" Then
        fNum = FreeFile
        Open fPath For Input As #fNum
        pendingData = Input$(LOF(fNum), fNum)
        Close #fNum
        Kill fPath
    End If
    On Error GoTo 0

    If Len(pendingData) > 0 Then
        latex = JsonVal(pendingData, "latex")
    End If

    If Len(latex) = 0 Then
        latex = InputBox("Enter LaTeX:", "LaTeXSnipper", "E=mc^2")
    End If
    If Len(latex) = 0 Then Exit Sub

    Dim body As String
    body = "{""latex"":" & Chr(34) & Replace(Replace(latex, "\", "\\"), """", "\""") & Chr(34) & "}"
    resp = HttpPost(API_BASE & "/api/office/convert", body)
    omml = JsonVal(resp, "omml")
    If Len(omml) = 0 Then
        MsgBox "Conversion failed", vbExclamation, "LaTeXSnipper"
        Exit Sub
    End If

    omml = CleanOmml(omml)

    ' Try direct insert into current document
    On Error GoTo InsertErr
    Application.Selection.Range.InsertXML BuildFlatOpc(omml)
    MsgBox "Formula inserted!", vbInformation, "LaTeXSnipper"
    Exit Sub

InsertErr:
    MsgBox "InsertXML failed: " & Err.Description & " (Err#" & Err.Number & ")", vbCritical, "LaTeXSnipper"
End Sub

Public Sub LaTeXLoadSelection()
    On Error Resume Next

    Dim eqCount As Long
    eqCount = Application.Selection.OMaths.Count
    Dim content As String

    If eqCount > 0 Then
        content = Application.Selection.OMaths(1).Range.Text
    Else
        Dim rng As Object
        Set rng = Application.Selection.Range
        rng.Expand Unit:=4
        If rng.OMaths.Count > 0 Then
            Dim i As Long
            For i = 1 To rng.OMaths.Count
                If rng.OMaths(i).Range.Start <= Application.Selection.Start And _
                   rng.OMaths(i).Range.End >= Application.Selection.End Then
                    content = rng.OMaths(i).Range.Text
                    Exit For
                End If
            Next i
        End If
    End If

    On Error GoTo 0

    If Len(content) > 0 Then
        Dim fPath As String
        fPath = Environ("TEMP") & "\latexsnipper_selection.txt"

        Dim stream As Object
        Set stream = CreateObject("ADODB.Stream")
        stream.Type = 2
        stream.Charset = "UTF-8"
        stream.Open
        stream.WriteText content
        stream.SaveToFile fPath, 2
        stream.Close
        Set stream = Nothing
    Else
        MsgBox "No equation found at cursor position.", vbInformation, "LaTeXSnipper"
    End If
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
        fPath = Environ("TEMP") & "\latexsnipper_selection.xml"

        Dim stream As Object
        Set stream = CreateObject("ADODB.Stream")
        stream.Type = 2
        stream.Charset = "UTF-8"
        stream.Open
        stream.WriteText ommlXml
        stream.SaveToFile fPath, 2
        stream.Close
        Set stream = Nothing
    Else
        MsgBox "No equation found at cursor position.", vbInformation, "LaTeXSnipper"
    End If
End Sub

Public Sub LaTeXDeleteSelection()
    On Error Resume Next
    Application.Selection.Delete
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
        MsgBox "Connection FAILED. Check Debug Output (Ctrl+G) for details.", vbExclamation, "LaTeXSnipper"
    End If
End Sub
