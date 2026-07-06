using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Office.Core;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Excel
{
    [ComVisible(true)]
    public sealed class ExcelRibbonExtensibility : IRibbonExtensibility
    {
        private IRibbonUI _ribbon;

        public string GetCustomUI(string ribbonId)
        {
            var asm = System.Reflection.Assembly.GetExecutingAssembly();
            using var stream = asm.GetManifestResourceStream("LaTeXSnipper.Excel.Ribbon.ExcelRibbon.xml");
            if (stream == null) return "";
            using var reader = new System.IO.StreamReader(stream);
            return reader.ReadToEnd();
        }

        public void OnRibbonLoad(IRibbonUI ribbon)
        {
            _ribbon = ribbon;
        }

        public bool GetDesktopCommandEnabled(IRibbonControl control)
        {
            var addIn = Globals.ThisAddIn;
            return addIn != null && addIn.PipeConnected;
        }

        public void OnButtonClick(IRibbonControl control)
        {
            var addIn = Globals.ThisAddIn;
            if (addIn == null) return;

            string rid = Guid.NewGuid().ToString("N").Substring(0, 12);
            var sid = addIn.SessionId;

            switch (control.Tag as string)
            {
                case "insertFormula":
                    addIn.Send(new VstoOpenEditor
                    {
                        RequestId = rid,
                        SessionId = sid,
                        Action = "insert",
                        Display = "display"
                    });
                    break;

                case "readSelection":
                    try
                    {
                        var f = addIn.Adapter.ReadSelection();
                        if (f != null && !string.IsNullOrEmpty(f.Latex))
                            MessageBox.Show("LaTeX: " + f.Latex, "LaTeXSnipper");
                        else
                            MessageBox.Show("No formula selected", "LaTeXSnipper");
                    }
                    catch (Exception ex) { MessageBox.Show("Error: " + ex.Message, "LaTeXSnipper"); }
                    break;

                case "delete":
                    var ok = addIn.Adapter.DeleteCurrent();
                    MessageBox.Show(ok ? "Deleted" : "No formula found", "LaTeXSnipper");
                    break;

                case "showPane":
                    addIn.Send(new VstoOpenEditor
                    {
                        RequestId = rid,
                        SessionId = sid,
                        Action = "focus"
                    });
                    break;

                case "ocr":
                    addIn.Send(new VstoFocusOcr { RequestId = rid, SessionId = sid });
                    break;

                case "settings":
                    addIn.Send(new VstoFocusSettings { RequestId = rid, SessionId = sid });
                    break;

                case "help":
                    MessageBox.Show("LaTeXSnipper v1.0.0", "LaTeXSnipper");
                    break;

                default:
                    MessageBox.Show("Not implemented: " + control.Tag, "LaTeXSnipper");
                    break;
            }
        }

        public void NotifyConnected()
        {
            _ribbon?.Invalidate();
        }
    }
}
