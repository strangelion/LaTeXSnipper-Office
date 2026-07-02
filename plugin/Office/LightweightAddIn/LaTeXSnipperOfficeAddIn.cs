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
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface ILaTeXSnipperAutomation
    {
        [DispId(1)]
        bool InsertLatex(string latex, bool display, bool numbered);

        [DispId(2)]
        bool LoadSelection();
    }

    [ComVisible(true)]
    [Guid("71CE99BB-D608-45D7-B837-ABDE82B9B61A")]
    [ProgId("LaTeXSnipper.Office")]
    [ClassInterface(ClassInterfaceType.None)]
    [ComDefaultInterface(typeof(ILaTeXSnipperAutomation))]
    public sealed class LaTeXSnipperOfficeAddIn : IDTExtensibility2, IRibbonExtensibility, ILaTeXSnipperAutomation
    {
        private const string BridgeUrl = "http://127.0.0.1:19876";
        private const string PendingFileName = "latexsnipper_pending.txt";
        private object wordApplication;

        public void OnConnection(object application, ext_ConnectMode connectMode, object addInInst, ref Array custom)
        {
            Log("OnConnection mode=" + connectMode);
            wordApplication = application;
            try
            {
                SetProperty(addInInst, "Object", (ILaTeXSnipperAutomation)this);
            }
            catch (Exception ex)
            {
                Log("Failed to expose add-in object: " + ex.Message);
            }
        }

        public void OnDisconnection(ext_DisconnectMode removeMode, ref Array custom)
        {
            Log("OnDisconnection mode=" + removeMode);
            wordApplication = null;
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
        <group id=""InsertGroup"" label=""Insert"">
          <button id=""InsertInline"" label=""Inline Formula"" size=""large"" onAction=""OnInsertInline"" imageMso=""EquationInsertInline"" />
          <button id=""InsertDisplay"" label=""Display Formula"" size=""large"" onAction=""OnInsertDisplay"" imageMso=""EquationInsertGallery"" />
          <button id=""InsertNumbered"" label=""Numbered Equation"" size=""large"" onAction=""OnInsertNumbered"" imageMso=""EquationProfessional"" />
        </group>
        <group id=""SelectionGroup"" label=""Selection"">
          <button id=""LoadSelection"" label=""Load Selection"" size=""large"" onAction=""OnLoadSelection"" imageMso=""EquationOptions"" />
          <button id=""ShowApp"" label=""Show App"" size=""large"" onAction=""OnShowApp"" imageMso=""WindowSwitch"" />
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
                ShowMessage("Load Selection error: " + ex.Message);
            }
        }

        public bool LoadSelection()
        {
            try
            {
                Log("LoadSelection start");
                object selection = GetProperty(wordApplication, "Selection");
                object range = GetProperty(selection, "Range");
                string latex = ReadLatexMetadataFromSelection(selection, range);
                Log("LoadSelection latex=" + (latex == null ? "null" : latex));
                if (!string.IsNullOrWhiteSpace(latex))
                {
                    PostJson("/api/office/load-selection-latex", "{\"latex\":\"" + JsonEscape(latex) + "\"}", 5000);
                    ShowApp();
                    return true;
                }

                string xml = Convert.ToString(GetProperty(range, "WordOpenXML"));
                Log("LoadSelection xml length=" + (xml == null ? 0 : xml.Length));
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
                    ShowMessage("Please select a formula or text first.");
                    return false;
                }

                PostJson("/api/office/load-selection", "{\"text\":\"" + JsonEscape(text.Trim()) + "\"}", 5000);
                ShowApp();
                return true;
            }
            catch (Exception ex)
            {
                Log("OnLoadSelection failed: " + ex);
                ShowMessage("Load selection failed: " + ex.Message);
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
                ShowMessage("Formula editor is ready. Send a formula from LaTeXSnipper, then click Insert again.");
                return;
            }

            InsertFormulaFromLatex(latex, display, numbered);
        }

        private void InsertFormulaFromLatex(string latex, bool display, bool numbered)
        {
            if (string.IsNullOrWhiteSpace(latex))
            {
                ShowMessage("Formula is empty.");
                return;
            }

            try
            {
                Log("InsertFormulaFromLatex display=" + display + " numbered=" + numbered);
                string body = "{\"latex\":\"" + JsonEscape(latex) + "\",\"display\":" + display.ToString().ToLowerInvariant() + "}";
                string json = PostJson("/api/office/convert", body, 15000);
                string omml = ExtractOmml(json);
                if (string.IsNullOrWhiteSpace(omml))
                {
                    ShowMessage("Failed to convert formula.");
                    return;
                }

                string cleaned = CleanOmml(omml);
                Log("OMML raw (" + omml.Length + "b): " + omml.Substring(0, Math.Min(200, omml.Length)));
                Log("OMML cleaned (" + cleaned.Length + "b): " + cleaned.Substring(0, Math.Min(200, cleaned.Length)));

                object selection = GetProperty(wordApplication, "Selection");
                object document = GetProperty(wordApplication, "ActiveDocument");
                object controls = GetProperty(document, "ContentControls");

                object selRange = GetProperty(selection, "Range");

                // Insert FlatOpc
                Invoke(selRange, "InsertXML", BuildFlatOpc(cleaned));

                // After InsertXML, cursor is after the formula.
                // Get the paragraph containing the cursor.
                object curRange = GetProperty(selection, "Range");
                object curPara = GetProperty(curRange, "Paragraphs");
                object para = Invoke(curPara, "Item", 1);
                object paraRange = GetProperty(para, "Range");

                int paraStart = Convert.ToInt32(GetProperty(paraRange, "Start"));
                int paraEnd = Convert.ToInt32(GetProperty(paraRange, "End"));
                // Exclude trailing paragraph mark (\r)
                int ccEnd = paraEnd - 1;
                int ccStart = paraStart;
                if (ccEnd <= ccStart) ccEnd = ccStart + 1;

                if (display)
                {
                    try
                    {
                        object displayRange = Invoke(document, "Range", ccStart, ccEnd);
                        object paragraph = GetProperty(displayRange, "ParagraphFormat");
                        SetProperty(paragraph, "Alignment", 1);
                    }
                    catch { }
                }

                object insertedRange = Invoke(document, "Range", ccStart, ccEnd);
                object contentControl = Invoke(controls, "Add", 0, insertedRange);
                SetProperty(contentControl, "Title", "LaTeXSnipper Formula");
                SetProperty(contentControl, "Tag", BuildFormulaTag(latex, display, numbered));
                if (numbered)
                {
                    Invoke(selection, "TypeText", " " + NextEquationNumber());
                }
            }
            catch (Exception ex)
            {
                Log("InsertFormula failed: " + ex);
                ShowMessage("Insert failed: " + ex.Message);
            }
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
                Log("ReadLatexFromContentControl failed: " + ex.Message);
                return string.Empty;
            }
        }

        private static string PostJson(string endpoint, string body, int timeoutMs)
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
                return reader.ReadToEnd();
            }
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
            // Remove empty text runs like <m:r><m:t></m:t></m:r>
            s = System.Text.RegularExpressions.Regex.Replace(s, @"<m:r>\s*<m:t\s*/>\s*</m:r>", "");
            s = System.Text.RegularExpressions.Regex.Replace(s, @"<m:r>\s*<m:t></m:t>\s*</m:r>", "");
            // Trim leading spaces inside <m:t> content
            s = System.Text.RegularExpressions.Regex.Replace(s, @"<m:t>(\s+)", "<m:t>");
            return s;
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

        private string NextEquationNumber()
        {
            try
            {
                object doc = GetProperty(wordApplication, "ActiveDocument");
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

        private static void Log(string message)
        {
            try
            {
                string path = Path.Combine(Path.GetTempPath(), "latexsnipper-office-addin.log");
                File.AppendAllText(path, DateTime.Now.ToString("O") + " " + message + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }
    }
}
