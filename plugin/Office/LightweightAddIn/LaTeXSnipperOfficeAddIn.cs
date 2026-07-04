using System;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

namespace LaTeXSnipper.OfficeAddIn
{
    public enum ext_ConnectMode
    {
        ext_cm_AfterStartup = 0,
        ext_cm_Startup = 1,
        ext_cm_External = 2,
        ext_cm_CommandLine = 3,
        ext_cm_Solution = 4,
        ext_cm_UISetup = 5,
    }

    public enum ext_DisconnectMode
    {
        ext_dm_HostShutdown = 0,
        ext_dm_UserClosed = 1,
        ext_dm_UISetupComplete = 2,
        ext_dm_SolutionClosed = 3,
    }

    [ComVisible(true)]
    [Guid("B65AD801-ABAF-11D0-BB8B-00A0C90F2744")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IDTExtensibility2
    {
        [DispId(1)]
        void OnConnection(
            [In, MarshalAs(UnmanagedType.IDispatch)] object application,
            [In] ext_ConnectMode connectMode,
            [In, MarshalAs(UnmanagedType.IDispatch)] object addInInst,
            [In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);
        [DispId(2)]
        void OnDisconnection(
            [In] ext_DisconnectMode removeMode,
            [In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);
        [DispId(3)]
        void OnAddInsUpdate(
            [In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);
        [DispId(4)]
        void OnStartupComplete(
            [In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);
        [DispId(5)]
        void OnBeginShutdown(
            [In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_VARIANT)] ref Array custom);
    }

    [ComVisible(true)]
    [Guid("000C0396-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IRibbonExtensibility
    {
        [DispId(1)]
        string GetCustomUI(string ribbonId);
    }

    [ComVisible(true)]
    [Guid("1B9F2D6D-3C6B-4654-A4C1-7EB83393C944")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface ILaTeXSnipperAutomation
    {
        [DispId(1)]
        bool InsertLatex(string latex, bool display, bool numbered);

        [DispId(2)]
        bool LoadSelection();

        [DispId(3)]
        bool DeleteSelection();

        [DispId(4)]
        bool AutoNumberSelected();

        [DispId(5)]
        bool RenumberAll();

        [DispId(6)]
        bool FormatSelected();

        [DispId(7)]
        bool FormatAll();

        [DispId(8)]
        string GetVersion();

        [DispId(9)]
        string LoadTable();
    }

    public enum OfficeHostApp
    {
        Word,
        Excel,
        PowerPoint,
        Unknown
    }

    [ComVisible(true)]
    [Guid("71CE99BB-D608-45D7-B837-ABDE82B9B61A")]
    [ProgId("LaTeXSnipper.Office")]
    [ClassInterface(ClassInterfaceType.AutoDual)]
    public sealed class LaTeXSnipperOfficeAddIn : IDTExtensibility2, IRibbonExtensibility, ILaTeXSnipperAutomation
    {
        private const string BridgeUrl = "http://127.0.0.1:19876";
        private const string PendingFileName = "latexsnipper_pending.txt";
        private object officeApplication;
        private OfficeHostApp hostApp = OfficeHostApp.Unknown;

        public void OnConnection(object application, ext_ConnectMode connectMode, object addInInst, ref Array custom)
        {
            Log("OnConnection mode=" + connectMode);
            officeApplication = application;

            // Detect host application type
            hostApp = DetectHostApplication(application);

            Log("Host application: " + hostApp);

            try
            {
                SetProperty(addInInst, "Object", (ILaTeXSnipperAutomation)this);
            }
            catch (Exception ex)
            {
                LogError("OnConnection failed", ex);
            }
        }

        public void OnDisconnection(ext_DisconnectMode removeMode, ref Array custom)
        {
            Log("OnDisconnection mode=" + removeMode);
            officeApplication = null;
        }

        private OfficeHostApp DetectHostApplication(object application)
        {
            try
            {
                string appTypeName = application.GetType().Name;
                string appFullName = application.GetType().FullName ?? "";
                Log("Detecting host: type=" + appTypeName + ", full=" + appFullName);

                // Check by namespace first (most reliable)
                if (appFullName.Contains("Microsoft.Office.Interop.Word"))
                    return OfficeHostApp.Word;
                if (appFullName.Contains("Microsoft.Office.Interop.Excel"))
                    return OfficeHostApp.Excel;
                if (appFullName.Contains("Microsoft.Office.Interop.PowerPoint"))
                    return OfficeHostApp.PowerPoint;

                // Check by type name
                if (appTypeName.Contains("Word") || appTypeName == "_Application")
                    return OfficeHostApp.Word;
                if (appTypeName.Contains("Excel"))
                    return OfficeHostApp.Excel;
                if (appTypeName.Contains("PowerPoint"))
                    return OfficeHostApp.PowerPoint;

                // For __ComObject, try to check the COM ProgID
                if (appTypeName == "__ComObject")
                {
                    // Try to get the COM ProgID
                    try
                    {
                        string progId = application.GetType().InvokeMember("ProgID", 
                            System.Reflection.BindingFlags.GetProperty, null, application, null) as string ?? "";
                        Log("COM ProgID: " + progId);
                        if (progId.Contains("Word"))
                            return OfficeHostApp.Word;
                        if (progId.Contains("Excel"))
                            return OfficeHostApp.Excel;
                        if (progId.Contains("PowerPoint"))
                            return OfficeHostApp.PowerPoint;
                    }
                    catch { }
                }
            }
            catch (Exception ex)
            {
                LogError("DetectHostApplication failed", ex);
            }

            return OfficeHostApp.Unknown;
        }

        public void OnAddInsUpdate(ref Array custom)
        {
            Log("OnAddInsUpdate");
        }

        public void OnStartupComplete(ref Array custom)
        {
            Log("OnStartupComplete");
        }

        public void OnBeginShutdown(ref Array custom)
        {
            Log("OnBeginShutdown");
        }

        public string GetCustomUI(string ribbonId)
        {
            Log("GetCustomUI ribbonId=" + ribbonId);
            return @"<?xml version=""1.0"" encoding=""UTF-8""?>
<customUI xmlns=""http://schemas.microsoft.com/office/2009/07/customui"">
  <ribbon>
    <tabs>
      <tab id=""LaTeXSnipperTab"" label=""LaTeXSnipper"" insertAfterMso=""TabReferences"">
        <group id=""InsertGroup"" label=""插入"">
          <button id=""InsertInline"" label=""行内公式"" size=""large"" onAction=""OnInsertInline"" imageMso=""EquationInsertInline"" />
          <button id=""InsertDisplay"" label=""显示公式"" size=""large"" onAction=""OnInsertDisplay"" imageMso=""EquationInsertGallery"" />
          <button id=""InsertNumbered"" label=""编号公式"" size=""large"" onAction=""OnInsertNumbered"" imageMso=""EquationProfessional"" />
        </group>
        <group id=""EditGroup"" label=""编辑"">
          <button id=""LoadSel"" label=""加载公式"" size=""large"" onAction=""OnLoadSelection"" imageMso=""ReviewDisplayForReview"" />
          <button id=""DeleteSel"" label=""删除公式"" size=""large"" onAction=""OnDeleteSelection"" imageMso=""Delete"" />
        </group>
        <group id=""NumberingGroup"" label=""编号"">
          <button id=""AutoNumber"" label=""自动编号"" size=""large"" onAction=""OnAutoNumber"" imageMso=""Numbering"" />
          <button id=""Renumber"" label=""重新编号"" size=""large"" onAction=""OnRenumber"" imageMso=""NumberingRestart"" />
        </group>
        <group id=""FormattingGroup"" label=""格式"">
          <button id=""FormatSelected"" label=""格式化选中"" size=""large"" onAction=""OnFormatSelected"" imageMso=""FormatPainter"" />
          <button id=""FormatAll"" label=""格式化全部"" size=""large"" onAction=""OnFormatAll"" imageMso=""FontDialog"" />
        </group>
        <group id=""ToolsGroup"" label=""工具"">
          <button id=""ShowAppBtn"" label=""打开应用"" size=""large"" onAction=""OnShowApp"" imageMso=""ReviewingPane"" />
          <button id=""HelpBtn"" label=""帮助"" size=""large"" onAction=""OnHelp"" imageMso=""Help"" />
        </group>
      </tab>
    </tabs>
  </ribbon>
</customUI>";
        }

        public void OnInsertInline(object control)
        {
            Log("OnInsertInline");
            InsertFormula(false, false);
        }

        public void OnInsertDisplay(object control)
        {
            Log("OnInsertDisplay");
            InsertFormula(true, false);
        }

        public void OnInsertNumbered(object control)
        {
            Log("OnInsertNumbered");
            InsertFormula(true, true);
        }

        public void OnShowApp(object control)
        {
            Log("OnShowApp");
            ShowApp();
        }

        public void OnLoadSelection(object control)
        {
            Log("OnLoadSelection called");
            try
            {
                bool result = LoadSelection();
                Log("OnLoadSelection result=" + result);
            }
            catch (Exception ex)
            {
                Log("OnLoadSelection exception: " + ex);
                ShowMessage("加载失败: " + ex.Message);
            }
        }

        public void OnDeleteSelection(object control)
        {
            Log("OnDeleteSelection");
            try
            {
                DeleteSelection();
            }
            catch (Exception ex)
            {
                Log("OnDeleteSelection error: " + ex);
                ShowMessage("删除失败: " + ex.Message);
            }
        }

        public void OnAutoNumber(object control)
        {
            Log("OnAutoNumber");
            try
            {
                AutoNumberSelected();
            }
            catch (Exception ex)
            {
                Log("OnAutoNumber error: " + ex);
                ShowMessage("自动编号失败: " + ex.Message);
            }
        }

        public void OnRenumber(object control)
        {
            Log("OnRenumber");
            try
            {
                RenumberAll();
            }
            catch (Exception ex)
            {
                Log("OnRenumber error: " + ex);
                ShowMessage("重新编号失败: " + ex.Message);
            }
        }

        public void OnFormatSelected(object control)
        {
            Log("OnFormatSelected");
            try
            {
                FormatSelected();
            }
            catch (Exception ex)
            {
                Log("OnFormatSelected error: " + ex);
                ShowMessage("格式化失败: " + ex.Message);
            }
        }

        public void OnFormatAll(object control)
        {
            Log("OnFormatAll");
            try
            {
                FormatAll();
            }
            catch (Exception ex)
            {
                Log("OnFormatAll error: " + ex);
                ShowMessage("格式化全部失败: " + ex.Message);
            }
        }

        public void OnHelp(object control)
        {
            Log("OnHelp");
            ShowMessage("LaTeXSnipper Word 加载项\n从 LaTeXSnipper 应用插入公式到 Word。\n\n功能：\n  行内/显示/编号公式插入\n  加载已有公式到编辑器\n  删除公式\n  自动编号 / 重新编号\n  格式化公式");
        }

        public bool LoadSelection()
        {
            try
            {
                Log("LoadSelection start");
                object selection = GetProperty(officeApplication, "Selection");
                object range = GetProperty(selection, "Range");
                string latex = ReadLatexMetadataFromSelection(selection, range);
                Log("LoadSelection latex=" + (latex == null ? "null" : latex));
                if (!string.IsNullOrWhiteSpace(latex))
                {
                    PostJson("/api/office/load-selection-latex", "{\"latex\":\"" + JsonEscape(latex) + "\"}", 5000);
                    ShowApp();
                    return true;
                }

                // Try expanding selection to find math element
                object expandedRange = GetProperty(selection, "Range");
                try { Invoke(expandedRange, "Expand", 6); } catch { } // wdParagraph=6
                string xml = Convert.ToString(GetProperty(expandedRange, "WordOpenXML"));
                Log("LoadSelection expanded xml length=" + (xml == null ? 0 : xml.Length));
                if (!string.IsNullOrWhiteSpace(xml) && xml.IndexOf("<m:oMath", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    PostJson("/api/office/load-selection-omml", "{\"omml\":\"" + JsonEscape(xml) + "\"}", 5000);
                    ShowApp();
                    return true;
                }

                string text = Convert.ToString(GetProperty(selection, "Text"));
                Log("LoadSelection text=" + (text == null ? "null" : text));
                if (string.IsNullOrWhiteSpace(text))
                {
                    ShowMessage("请先选中公式或文本。");
                    return false;
                }

                PostJson("/api/office/load-selection", "{\"text\":\"" + JsonEscape(text.Trim()) + "\"}", 5000);
                ShowApp();
                return true;
            }
            catch (Exception ex)
            {
                LogError("OnLoadSelection failed", ex);
                ShowMessage("加载失败: " + ex.Message);
                return false;
            }
        }

        public bool InsertLatex(string latex, bool display, bool numbered)
        {
            Log("InsertLatex display=" + display + " numbered=" + numbered);
            InsertFormulaFromLatex(latex, display, numbered);
            return true;
        }

        private void InsertFormula(bool display, bool numbered)
        {
            string latex = ReadPendingFormula();
            if (string.IsNullOrWhiteSpace(latex))
            {
                ShowApp();
                ShowMessage("编辑器已就绪。从 LaTeXSnipper 发送公式后，再次点击插入按钮。");
                return;
            }

            InsertFormulaFromLatex(latex, display, numbered);
        }

        private void InsertFormulaFromLatex(string latex, bool display, bool numbered)
        {
            if (string.IsNullOrWhiteSpace(latex))
            {
                ShowMessage("公式为空。");
                return;
            }

            try
            {
                Log("InsertFormulaFromLatex display=" + display + " numbered=" + numbered + " hostApp=" + hostApp);
                string body = "{\"latex\":\"" + JsonEscape(latex) + "\",\"display\":" + display.ToString().ToLowerInvariant() + "}";
                string json = PostJson("/api/office/convert", body, 15000);
                string omml = ExtractOmml(json);
                if (string.IsNullOrWhiteSpace(omml))
                {
                    ShowMessage("公式转换失败。");
                    return;
                }

                string cleaned = CleanOmml(omml);
                Log("OMML raw (" + omml.Length + "b): " + omml.Substring(0, Math.Min(200, omml.Length)));
                Log("OMML cleaned (" + cleaned.Length + "b): " + cleaned.Substring(0, Math.Min(200, cleaned.Length)));

                switch (hostApp)
                {
                    case OfficeHostApp.Word:
                        InsertFormulaWord(cleaned, display, numbered);
                        break;
                    case OfficeHostApp.Excel:
                        InsertFormulaExcel(cleaned, display);
                        break;
                    case OfficeHostApp.PowerPoint:
                        InsertFormulaPowerPoint(cleaned, display);
                        break;
                    default:
                        InsertFormulaWord(cleaned, display, numbered);
                        break;
                }

                // Replace placeholders with actual Word objects (Word only)
                if (hostApp == OfficeHostApp.Word)
                {
                    ReplacePlaceholders();
                }
            }
            catch (Exception ex)
            {
                LogError("InsertFormula failed", ex);
                ShowMessage("插入失败: " + ex.Message);
            }
        }

        private void InsertFormulaWord(string cleaned, bool display, bool numbered)
        {
            try
            {
                // Only run for Word application
                if (hostApp != OfficeHostApp.Word)
                {
                    Log("InsertFormulaWord skipped - not Word application");
                    return;
                }

                object selection = GetProperty(officeApplication, "Selection");
                object document = GetProperty(officeApplication, "ActiveDocument");

                object selRange = GetProperty(selection, "Range");

                if (display)
                {
                    // Display/numbered: paragraph-merge, then center
                    int originalPos = Convert.ToInt32(GetProperty(selRange, "Start"));

                    Invoke(selection, "TypeParagraph");
                    object tempSelRange = GetProperty(selection, "Range");
                    Invoke(tempSelRange, "InsertXML", BuildFlatOpc(cleaned));

                    // Delete paragraph mark to merge
                    object pMark = Invoke(document, "Range", originalPos, originalPos + 1);
                    Invoke(pMark, "Delete", 1, 1);

                    // Center the paragraph
                    try
                    {
                        object curRange = GetProperty(selection, "Range");
                        object curPara = GetProperty(curRange, "Paragraphs");
                        object para = Invoke(curPara, "Item", 1);
                        object paraRange = GetProperty(para, "Range");
                        int paraStart = Convert.ToInt32(GetProperty(paraRange, "Start"));
                        int paraEnd = Convert.ToInt32(GetProperty(paraRange, "End"));
                        int ccEnd = paraEnd - 1;
                        int ccStart = paraStart;
                        if (ccEnd <= ccStart) ccEnd = ccStart + 1;
                        object displayRange = Invoke(document, "Range", ccStart, ccEnd);
                        object paragraph = GetProperty(displayRange, "ParagraphFormat");
                        SetProperty(paragraph, "Alignment", 1);
                    }
                    catch { }

                    if (numbered)
                    {
                        Invoke(selection, "TypeText", " " + NextEquationNumber());
                    }
                }
                else
                {
                    // Inline: paragraph-merge without ContentControl (clean, no dividing line)
                    int originalPos = Convert.ToInt32(GetProperty(selRange, "Start"));

                    Invoke(selection, "TypeParagraph");
                    object tempSelRange = GetProperty(selection, "Range");
                    Invoke(tempSelRange, "InsertXML", BuildFlatOpc(cleaned));

                    // Delete the paragraph mark to merge into original paragraph
                    object pMark = Invoke(document, "Range", originalPos, originalPos + 1);
                    Invoke(pMark, "Delete", 1, 1);
                }

                // Replace placeholders with actual Word objects
                ReplacePlaceholders();
            }
            catch (Exception ex)
            {
                LogError("InsertFormulaWord failed", ex);
                ShowMessage("插入失败: " + ex.Message);
            }
        }

        private void ReplacePlaceholders()
        {
            try
            {
                object document = GetProperty(officeApplication, "ActiveDocument");
                object selection = GetProperty(officeApplication, "Selection");

                // Replace [^footnote] with actual footnote
                object selRange = GetProperty(selection, "Range");
                object findObj = selRange.GetType().InvokeMember("Find", BindingFlags.GetProperty, null, selRange, null);
                findObj.GetType().InvokeMember("ClearFormatting", BindingFlags.InvokeMethod, null, findObj, null);
                findObj.GetType().InvokeMember("Text", BindingFlags.SetProperty, null, findObj, new object[] { "[^footnote]" });
                findObj.GetType().InvokeMember("Forward", BindingFlags.SetProperty, null, findObj, new object[] { true });
                findObj.GetType().InvokeMember("Wrap", BindingFlags.SetProperty, null, findObj, new object[] { 0 });
                bool found = Convert.ToBoolean(findObj.GetType().InvokeMember("Execute", BindingFlags.InvokeMethod, null, findObj, null));

                while (found)
                {
                    try
                    {
                        object footnotes = GetProperty(document, "Footnotes");
                        Invoke(footnotes, "Add", GetProperty(selection, "Range"), "Footnote from LaTeXSnipper");
                        Log("Replaced [^footnote] placeholder");
                    }
                    catch (Exception ex)
                    {
                        Log("Failed to insert footnote: " + ex.Message);
                    }
                    found = Convert.ToBoolean(findObj.GetType().InvokeMember("Execute", BindingFlags.InvokeMethod, null, findObj, null));
                }

                Log("Placeholder replacement completed");
            }
            catch (Exception ex)
            {
                LogError("ReplacePlaceholders failed", ex);
            }
        }

        private void InsertFormulaExcel(string cleaned, bool display)
        {
            try
            {
                object selection = GetProperty(officeApplication, "Selection");
                object activeCell = GetProperty(selection, "ActiveCell");

                // Insert formula as text with OMML marker
                SetProperty(activeCell, "Value", ".Formula: " + cleaned.Substring(0, Math.Min(50, cleaned.Length)));

                Log("Excel formula inserted at cell");
            }
            catch (Exception ex)
            {
                LogError("InsertFormulaExcel failed", ex);
                ShowMessage("Excel 插入失败: " + ex.Message);
            }
        }

        private void InsertFormulaPowerPoint(string cleaned, bool display)
        {
            try
            {
                object selection = GetProperty(officeApplication, "Selection");
                object slide = GetProperty(selection, "SlideRange");
                object shapes = GetProperty(slide, "Shapes");

                // Add a text box for the formula
                object left = 100;
                object top = 100;
                object width = 300;
                object height = 50;

                object shape = Invoke(shapes, "AddTextbox", 1, left, top, width, height);
                object textFrame = GetProperty(shape, "TextFrame");
                object textRange = GetProperty(textFrame, "TextRange");

                // Insert the formula as text
                SetProperty(textRange, "Text", "Formula: " + cleaned.Substring(0, Math.Min(50, cleaned.Length)));

                Log("PowerPoint formula inserted");
            }
            catch (Exception ex)
            {
                LogError("InsertFormulaPowerPoint failed", ex);
                ShowMessage("PowerPoint 插入失败: " + ex.Message);
            }
        }

        // ═══ Delete Selection ═══
        public bool DeleteSelection()
        {
            object selection = GetProperty(officeApplication, "Selection");
            object range = GetProperty(selection, "Range");
            object document = GetProperty(officeApplication, "ActiveDocument");

            // Try to find and delete ContentControl containing the cursor
            object controls = GetProperty(document, "ContentControls");
            int count = Convert.ToInt32(GetProperty(controls, "Count"));
            for (int i = 1; i <= count; i++)
            {
                object cc = Invoke(controls, "Item", i);
                object ccRange = GetProperty(cc, "Range");
                int ccStart = Convert.ToInt32(GetProperty(ccRange, "Start"));
                int ccEnd = Convert.ToInt32(GetProperty(ccRange, "End"));
                int curPos = Convert.ToInt32(GetProperty(range, "Start"));
                if (curPos >= ccStart && curPos <= ccEnd)
                {
                    string tag = Convert.ToString(GetProperty(cc, "Tag"));
                    if (!string.IsNullOrEmpty(tag) && tag.StartsWith("latexsnipper:"))
                    {
                        Invoke(ccRange, "Delete");
                        ShowMessage("公式已删除。");
                        return true;
                    }
                }
            }

            // Fallback: try to delete the current math element
            try
            {
                object mathRange = GetProperty(selection, "Range");
                object math = Invoke(mathRange, "OMaths", null);
                int mathCount = Convert.ToInt32(GetProperty(math, "Count"));
                if (mathCount > 0)
                {
                    object firstMath = Invoke(math, "Item", 1);
                    object mathParentRange = GetProperty(firstMath, "Range");
                    Invoke(mathParentRange, "Delete");
                        ShowMessage("公式已删除。");
                    return true;
                }
            }
            catch { }

            ShowMessage("光标位置未找到公式。");
            return false;
        }

        // ═══ Auto Number ═══
        public bool AutoNumberSelected()
        {
            object selection = GetProperty(officeApplication, "Selection");
            object range = GetProperty(selection, "Range");
            object document = GetProperty(officeApplication, "ActiveDocument");

            // Find ContentControl with formula tag
            object controls = GetProperty(document, "ContentControls");
            int count = Convert.ToInt32(GetProperty(controls, "Count"));
            for (int i = 1; i <= count; i++)
            {
                object cc = Invoke(controls, "Item", i);
                object ccRange = GetProperty(cc, "Range");
                int ccStart = Convert.ToInt32(GetProperty(ccRange, "Start"));
                int ccEnd = Convert.ToInt32(GetProperty(ccRange, "End"));
                int curPos = Convert.ToInt32(GetProperty(range, "Start"));
                if (curPos >= ccStart && curPos <= ccEnd)
                {
                    string tag = Convert.ToString(GetProperty(cc, "Tag"));
                    if (!string.IsNullOrEmpty(tag) && tag.StartsWith("latexsnipper:"))
                    {
                        // Add equation number after the formula
                        object afterRange = Invoke(document, "Range", ccEnd, ccEnd);
                        string num = NextEquationNumber();
                        Invoke(selection, "TypeText", " " + num);
                        ShowMessage("已添加编号: " + num);
                        return true;
                    }
                }
            }

            ShowMessage("光标位置未找到公式。");
            return false;
        }

        // ═══ Renumber All ═══
        public bool RenumberAll()
        {
            object selection = GetProperty(officeApplication, "Selection");
            object document = GetProperty(officeApplication, "ActiveDocument");

            // Find all ContentControls with LaTeXSnipper tags and renumber
            object controls = GetProperty(document, "ContentControls");
            int count = Convert.ToInt32(GetProperty(controls, "Count"));
            int eqNum = 1;

            for (int i = 1; i <= count; i++)
            {
                object cc = Invoke(controls, "Item", i);
                string tag = Convert.ToString(GetProperty(cc, "Tag"));
                if (!string.IsNullOrEmpty(tag) && tag.StartsWith("latexsnipper:"))
                {
                    string tagContent = Encoding.UTF8.GetString(Convert.FromBase64String(tag.Substring("latexsnipper:".Length)));
                    if (tagContent.Contains("\"numbered\":true"))
                    {
                        // Find the equation number text after this ContentControl
                        object ccRange = GetProperty(cc, "Range");
                        int ccEnd = Convert.ToInt32(GetProperty(ccRange, "End"));
                        object nextRange = Invoke(document, "Range", ccEnd, ccEnd + 20);
                        string nextText = Convert.ToString(GetProperty(nextRange, "Text"));

                        // Look for existing number pattern like (1), (2), etc.
                        var numMatch = System.Text.RegularExpressions.Regex.Match(nextText, @"\(\d+\)");
                        if (numMatch.Success)
                        {
                            object numRange = Invoke(document, "Range", ccEnd, ccEnd + numMatch.Length);
                            Invoke(numRange, "Delete");
                            string newNum = "(" + eqNum + ")";
                            Invoke(selection, "TypeText", newNum);
                            eqNum++;
                        }
                    }
                }
            }

            // Reset equation counter
            try
            {
                object variables = GetProperty(document, "Variables");
                object variable = Invoke(variables, "Item", "LaTeXSnipperEqNum");
                SetProperty(variable, "Value", (eqNum - 1).ToString());
            }
            catch
            {
                try
                {
                    object variables = GetProperty(document, "Variables");
                    Invoke(variables, "Add", "LaTeXSnipperEqNum", (eqNum - 1).ToString());
                }
                catch { }
            }

            ShowMessage("已重新编号 " + (eqNum - 1) + " 个公式。");
            return true;
        }

        // ═══ Format Selected ═══
        public bool FormatSelected()
        {
            object selection = GetProperty(officeApplication, "Selection");
            object range = GetProperty(selection, "Range");

            // Apply consistent formatting to math elements in selection
            try
            {
                object math = Invoke(range, "OMaths", null);
                int mathCount = Convert.ToInt32(GetProperty(math, "Count"));
                if (mathCount > 0)
                {
                    for (int i = 1; i <= mathCount; i++)
                    {
                        object m = Invoke(math, "Item", i);
                        object mRange = GetProperty(m, "Range");
                        object font = GetProperty(mRange, "Font");
                        SetProperty(font, "Name", "Cambria Math");
                        SetProperty(font, "Size", 12);
                    }
                    ShowMessage("已格式化 " + mathCount + " 个公式。");
                    return true;
                }
            }
            catch { }

            ShowMessage("选中范围内未找到公式。");
            return false;
        }

        // ═══ Format All ═══
        public bool FormatAll()
        {
            object selection = GetProperty(officeApplication, "Selection");
            object document = GetProperty(officeApplication, "ActiveDocument");
            object wholeRange = GetProperty(document, "Content");

            try
            {
                object math = Invoke(wholeRange, "OMaths", null);
                int mathCount = Convert.ToInt32(GetProperty(math, "Count"));
                for (int i = 1; i <= mathCount; i++)
                {
                    object m = Invoke(math, "Item", i);
                    object mRange = GetProperty(m, "Range");
                    object font = GetProperty(mRange, "Font");
                    SetProperty(font, "Name", "Cambria Math");
                    SetProperty(font, "Size", 12);
                }
                ShowMessage("已格式化 " + mathCount + " 个公式。");
                return true;
            }
            catch (Exception ex)
            {
                ShowMessage("格式化全部失败: " + ex.Message);
            }
            return false;
        }

        private static string ReadPendingFormula()
        {
            try
            {
                string path = Path.Combine(Path.GetTempPath(), PendingFileName);
                if (!File.Exists(path))
                {
                    return string.Empty;
                }

                string json = File.ReadAllText(path, Encoding.UTF8);
                File.Delete(path);
                var doc = new JavaScriptSerializer().DeserializeObject(json) as System.Collections.Generic.Dictionary<string, object>;
                return doc != null && doc.ContainsKey("latex") ? Convert.ToString(doc["latex"]) : string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string ExtractOmml(string json)
        {
            try
            {
                var doc = new JavaScriptSerializer().DeserializeObject(json) as System.Collections.Generic.Dictionary<string, object>;
                if (doc == null || !doc.ContainsKey("omml"))
                {
                    return string.Empty;
                }
                return Convert.ToString(doc["omml"]);
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string BuildFormulaTag(string latex, bool display, bool numbered)
        {
            string json = "{\"latex\":\"" + JsonEscape(latex) + "\",\"display\":" + display.ToString().ToLowerInvariant() + ",\"numbered\":" + numbered.ToString().ToLowerInvariant() + "}";
            string b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
            return "latexsnipper:" + b64;
        }

        private static string ReadLatexMetadataFromSelection(object selection, object range)
        {
            string latex = ReadLatexFromContentControl(selection);
            if (!string.IsNullOrWhiteSpace(latex))
            {
                return latex;
            }

            return ReadLatexFromContentControl(range);
        }

        private static string ReadLatexFromContentControl(object source)
        {
            try
            {
                object control = GetProperty(source, "ParentContentControl");
                if (control == null)
                {
                    return string.Empty;
                }

                string tag = Convert.ToString(GetProperty(control, "Tag"));
                if (string.IsNullOrWhiteSpace(tag) || !tag.StartsWith("latexsnipper:", StringComparison.OrdinalIgnoreCase))
                {
                    return string.Empty;
                }

                string b64 = tag.Substring("latexsnipper:".Length);
                string json = Encoding.UTF8.GetString(Convert.FromBase64String(b64));
                var doc = new JavaScriptSerializer().DeserializeObject(json) as System.Collections.Generic.Dictionary<string, object>;
                return doc != null && doc.ContainsKey("latex") ? Convert.ToString(doc["latex"]) : string.Empty;
            }
            catch (Exception ex)
            {
                LogError("ReadLatexFromContentControl failed", ex);
                return string.Empty;
            }
        }

        private static string PostJson(string endpoint, string body, int timeoutMs)
        {
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            int maxRetries = 2;
            int retryCount = 0;

            while (retryCount <= maxRetries)
            {
                try
                {
                    byte[] data = Encoding.UTF8.GetBytes(body);
                    var request = (HttpWebRequest)WebRequest.Create(BridgeUrl + endpoint);
                    request.Method = "POST";
                    request.ContentType = "application/json";
                    request.Timeout = timeoutMs;
                    request.ReadWriteTimeout = timeoutMs;
                    request.ContentLength = data.Length;

                    using (Stream stream = request.GetRequestStream())
                    {
                        stream.Write(data, 0, data.Length);
                    }

                    using (var response = (HttpWebResponse)request.GetResponse())
                    using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    {
                        string result = reader.ReadToEnd();
                        stopwatch.Stop();
                        Log(string.Format("[HTTP] {0} -> {1} ({2}ms)", endpoint, (int)response.StatusCode, stopwatch.ElapsedMilliseconds));
                        return result;
                    }
                }
                catch (WebException ex)
                {
                    stopwatch.Stop();
                    var response = ex.Response as HttpWebResponse;
                    int statusCode = response != null ? (int)response.StatusCode : 0;
                    Log(string.Format("[HTTP ERROR] {0} -> {1} ({2}ms): {3}", endpoint, statusCode, stopwatch.ElapsedMilliseconds, ex.Message));

                    // Don't retry on client errors (4xx)
                    if (statusCode >= 400 && statusCode < 500)
                    {
                        throw;
                    }

                    retryCount++;
                    if (retryCount <= maxRetries)
                    {
                        Log(string.Format("[HTTP RETRY] {0} attempt {1}/{2}", endpoint, retryCount, maxRetries));
                        System.Threading.Thread.Sleep(100 * retryCount); // Exponential backoff
                    }
                    else
                    {
                        throw;
                    }
                }
                catch (Exception ex)
                {
                    stopwatch.Stop();
                    Log(string.Format("[HTTP ERROR] {0} ({1}ms): {2}", endpoint, stopwatch.ElapsedMilliseconds, ex.Message));
                    throw;
                }
            }

            throw new Exception("Max retries exceeded");
        }

        private static string CleanOmml(string omml)
        {
            string s = omml ?? string.Empty;
            s = s.Replace("<?xml version=\"1.0\"?>", "");
            s = s.Replace("<?xml version=\"1.0\" encoding=\"utf-8\"?>", "");
            s = s.Replace(" xmlns:mml=\"http://www.w3.org/1998/Math/MathML\"", "");
            s = s.Replace("\r\n", " ").Replace("\r", " ").Replace("\n", " ").Trim();
            int startIdx = s.IndexOf("<m:oMath", StringComparison.OrdinalIgnoreCase);
            if (startIdx > 0)
            {
                s = s.Substring(startIdx);
            }
            // Word InsertXML does not support m:oMathPara; convert to m:oMath
            s = ConvertMathParaToMath(s);
            // Fix double-encoded UTF-8 characters throughout the OMML string
            s = FixDoubleEncodedUtf8(s);
            // Remove empty text runs like <m:r><m:t></m:t></m:r>
            s = System.Text.RegularExpressions.Regex.Replace(s, @"<m:r>\s*<m:t\s*/>\s*</m:r>", "");
            s = System.Text.RegularExpressions.Regex.Replace(s, @"<m:r>\s*<m:t></m:t>\s*</m:r>", "");
            // Trim leading spaces inside <m:t> content
            s = System.Text.RegularExpressions.Regex.Replace(s, @"<m:t>(\s+)", "<m:t>");
            return s;
        }

        /// <summary>
        /// Fix double-encoded UTF-8 throughout the string.
        /// Detects consecutive chars in 0x80-0xFF range, tries to decode as UTF-8.
        /// </summary>
        private static string FixDoubleEncodedUtf8(string input)
        {
            var result = new System.Text.StringBuilder(input.Length);
            int i = 0;
            while (i < input.Length)
            {
                char c = input[i];
                if (c >= 0x80 && c <= 0xFF)
                {
                    // Collect consecutive high-byte chars
                    var raw = new System.Collections.Generic.List<byte>();
                    int j = i;
                    while (j < input.Length && input[j] >= 0x80 && input[j] <= 0xFF)
                    {
                        raw.Add((byte)input[j]);
                        j++;
                    }
                    if (raw.Count >= 2)
                    {
                        try
                        {
                            string decoded = System.Text.Encoding.UTF8.GetString(raw.ToArray());
                            // Only use if it decoded to fewer characters (was double-encoded)
                            if (decoded.Length < raw.Count && decoded.Length > 0)
                            {
                                result.Append(decoded);
                                i = j;
                                continue;
                            }
                        }
                        catch { }
                    }
                }
                result.Append(c);
                i++;
            }
            return result.ToString();
        }

        /// <summary>
        /// Replace &lt;m:oMathPara&gt;...&lt;/m:oMathPara&gt; with &lt;m:oMath&gt;...&lt;/m:oMath&gt;
        /// so that Word Range.InsertXML accepts the OMML.
        /// </summary>
        private static string ConvertMathParaToMath(string omml)
        {
            int openIdx = omml.IndexOf("<m:oMathPara", StringComparison.OrdinalIgnoreCase);
            if (openIdx < 0) return omml;

            // Find the matching close tag
            int closeIdx = omml.IndexOf("</m:oMathPara>", StringComparison.OrdinalIgnoreCase);
            if (closeIdx < 0) return omml;

            string inner = omml.Substring(openIdx + "<m:oMathPara".Length,
                                          closeIdx - openIdx - "<m:oMathPara".Length);
            return "<m:oMath" + inner + "</m:oMath>";
        }

        private static string BuildFlatOpc(string mathBody)
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
                "<pkg:package xmlns:pkg=\"http://schemas.microsoft.com/office/2006/xmlPackage\">" +
                "<pkg:part pkg:name=\"/_rels/.rels\" pkg:contentType=\"application/vnd.openxmlformats-package.relationships+xml\" pkg:padding=\"512\">" +
                "<pkg:xmlData><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
                "</Relationships></pkg:xmlData></pkg:part>" +
                "<pkg:part pkg:name=\"/word/document.xml\" pkg:contentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\">" +
                "<pkg:xmlData><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\">" +
                "<w:body><w:p>" + mathBody + "</w:p></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>";
        }

        private static string BuildFlatOpcInline(string mathBody)
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
                "<pkg:package xmlns:pkg=\"http://schemas.microsoft.com/office/2006/xmlPackage\">" +
                "<pkg:part pkg:name=\"/_rels/.rels\" pkg:contentType=\"application/vnd.openxmlformats-package.relationships+xml\" pkg:padding=\"512\">" +
                "<pkg:xmlData><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
                "</Relationships></pkg:xmlData></pkg:part>" +
                "<pkg:part pkg:name=\"/word/document.xml\" pkg:contentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\">" +
                "<pkg:xmlData><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\">" +
                "<w:body><w:r>" + mathBody + "</w:r></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>";
        }

        private string NextEquationNumber()
        {
            try
            {
                object doc = GetProperty(officeApplication, "ActiveDocument");
                object variables = GetProperty(doc, "Variables");
                int next = 1;
                try
                {
                    object variable = Invoke(variables, "Item", "LaTeXSnipperEqNum");
                    next = int.Parse(Convert.ToString(GetProperty(variable, "Value"))) + 1;
                    SetProperty(variable, "Value", next.ToString());
                }
                catch
                {
                    Invoke(variables, "Add", "LaTeXSnipperEqNum", next.ToString());
                }
                return "(" + next + ")";
            }
            catch
            {
                return "(1)";
            }
        }

        private static string JsonEscape(string value)
        {
            return (value ?? string.Empty)
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r\n", "\\n")
                .Replace("\r", "\\n")
                .Replace("\n", "\\n");
        }

        private static object GetProperty(object target, string name)
        {
            return target.GetType().InvokeMember(name, BindingFlags.GetProperty, null, target, null);
        }

        private static void SetProperty(object target, string name, object value)
        {
            target.GetType().InvokeMember(name, BindingFlags.SetProperty, null, target, new[] { value });
        }

        private static object Invoke(object target, string name, params object[] args)
        {
            return target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, args);
        }

        private static void ShowMessage(string message)
        {
            try
            {
                System.Windows.Forms.MessageBox.Show(message, "LaTeXSnipper");
            }
            catch { }
        }

        private static void ShowApp()
        {
            try
            {
                PostJson("/api/office/show-app", "{}", 2000);
            }
            catch { }
        }

        public string GetVersion()
        {
            return "0.2.0";
        }

        public string LoadTable()
        {
            try
            {
                Log("LoadTable start");
                string appName = officeApplication.GetType().Name;
                Log("Host application: " + appName);

                if (appName.Contains("Excel"))
                    return LoadTableExcel();
                else if (appName.Contains("PowerPoint"))
                    return LoadTablePowerPoint();
                else
                    return LoadTableWord();
            }
            catch (Exception ex)
            {
                LogError("LoadTable failed", ex);
                return "{}";
            }
        }

        private string LoadTableWord()
        {
            object selection = GetProperty(officeApplication, "Selection");
            object range = GetProperty(selection, "Range");

            object tables = Invoke(range, "Tables", null);
            int tableCount = Convert.ToInt32(GetProperty(tables, "Count"));

            if (tableCount == 0)
            {
                Log("No table found in Word selection");
                return "0\t0\n";
            }

            object table = Invoke(tables, "Item", 1);
            int rows = Convert.ToInt32(GetProperty(table, "Rows"));
            int cols = Convert.ToInt32(GetProperty(table, "Columns"));

                Log(string.Format("Word table: {0} rows x {1} cols", rows, cols));

            var result = new System.Text.StringBuilder();
            result.Append(rows);
            result.Append("\t");
            result.Append(cols);
            result.Append("\n");

            for (int r = 1; r <= rows; r++)
            {
                for (int c = 1; c <= cols; c++)
                {
                    if (c > 1) result.Append("\t");
                    object cell = Invoke(table, "Cell", r, c);
                    object cellRange = GetProperty(cell, "Range");
                    string text = Convert.ToString(GetProperty(cellRange, "Text"));
                    text = text.TrimEnd('\r', '\n');
                    text = text.Replace("\t", " ").Replace("\n", " ");
                    result.Append(text);
                }
                result.Append("\n");
            }

            return result.ToString();
        }

        private string LoadTableExcel()
        {
            object selection = GetProperty(officeApplication, "Selection");
            object range = GetProperty(selection, "Range");

            int rows = Convert.ToInt32(GetProperty(range, "Rows"));
            int cols = Convert.ToInt32(GetProperty(range, "Columns"));

                Log(string.Format("Excel range: {0} rows x {1} cols", rows, cols));

            var result = new System.Text.StringBuilder();
            result.Append(rows);
            result.Append("\t");
            result.Append(cols);
            result.Append("\n");

            for (int r = 1; r <= rows; r++)
            {
                for (int c = 1; c <= cols; c++)
                {
                    if (c > 1) result.Append("\t");
                    object cell = Invoke(range, "Cells", r, c);
                    string text = "";
                    try
                    {
                        object val = GetProperty(cell, "Text");
                        text = Convert.ToString(val);
                    }
                    catch { }
                    text = text.Replace("\t", " ").Replace("\n", " ");
                    result.Append(text);
                }
                result.Append("\n");
            }

            return result.ToString();
        }

        private string LoadTablePowerPoint()
        {
            object selection = GetProperty(officeApplication, "Selection");
            object shapeRange = GetProperty(selection, "ShapeRange");

            int shapeCount = Convert.ToInt32(GetProperty(shapeRange, "Count"));
            Log("PowerPoint shapes: " + shapeCount);

            for (int i = 1; i <= shapeCount; i++)
            {
                object shape = Invoke(shapeRange, "Item", i);
                int shapeType = Convert.ToInt32(GetProperty(shape, "Type"));

                // ppTable = 19
                if (shapeType == 19)
                {
                    object table = GetProperty(shape, "Table");
                    int rows = Convert.ToInt32(GetProperty(table, "Rows"));
                    int cols = Convert.ToInt32(GetProperty(table, "Columns"));

                    Log(string.Format("PPT table: {0} rows x {1} cols", rows, cols));

                    var result = new System.Text.StringBuilder();
                    result.Append(rows);
                    result.Append("\t");
                    result.Append(cols);
                    result.Append("\n");

                    for (int r = 1; r <= rows; r++)
                    {
                        for (int c = 1; c <= cols; c++)
                        {
                            if (c > 1) result.Append("\t");
                            object cell = Invoke(table, "Cell", r, c);
                            object cellShape = GetProperty(cell, "Shape");
                            object textFrame = GetProperty(cellShape, "TextFrame");
                            object textRange = GetProperty(textFrame, "TextRange");
                            string text = Convert.ToString(GetProperty(textRange, "Text"));
                            text = text.TrimEnd('\r', '\n');
                            text = text.Replace("\t", " ").Replace("\n", " ");
                            result.Append(text);
                        }
                        result.Append("\n");
                    }

                    return result.ToString();
                }
            }

            Log("No table shape found in PowerPoint selection");
            return "0\t0\n";
        }

        private static void Log(string message, string level = "INFO")
        {
            try
            {
                string path = Path.Combine(Path.GetTempPath(), "latexsnipper-office-addin.log");
                string timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
                string logLine = string.Format("[{0}] [{1}] {2}{3}", timestamp, level, message, Environment.NewLine);

                // Rotate log file if it's too large (> 1MB)
                if (File.Exists(path))
                {
                    var fileInfo = new FileInfo(path);
                    if (fileInfo.Length > 1024 * 1024)
                    {
                        string backupPath = path + ".old";
                        if (File.Exists(backupPath))
                        {
                            File.Delete(backupPath);
                        }
                        File.Move(path, backupPath);
                    }
                }

                File.AppendAllText(path, logLine, Encoding.UTF8);
            }
            catch { }
        }

        private static void LogError(string message, Exception ex = null)
        {
                string fullMessage = ex != null ? string.Format("{0}: {1}", message, ex.Message) : message;
            Log(fullMessage, "ERROR");
            if (ex != null && ex.InnerException != null)
            {
                Log(string.Format("  Inner: {0}", ex.InnerException.Message), "ERROR");
            }
        }
    }
}
