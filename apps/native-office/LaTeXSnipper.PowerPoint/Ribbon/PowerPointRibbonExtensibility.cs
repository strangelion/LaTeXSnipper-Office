using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Office.Core;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.PowerPoint
{
    [ComVisible(true)]
    public sealed class PowerPointRibbonExtensibility : IRibbonExtensibility
    {
        private IRibbonUI _ribbon;

        public string GetCustomUI(string ribbonId)
        {
            var asm = System.Reflection.Assembly.GetExecutingAssembly();
            using var stream = asm.GetManifestResourceStream("LaTeXSnipper.PowerPoint.Ribbon.PowerPointRibbon.xml");
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

        public string GetLabel(IRibbonControl control)
        {
            return RibbonLocalizer.GetString(control.Id);
        }

        public string GetScreentip(IRibbonControl control)
        {
            return RibbonLocalizer.GetString(control.Id + "_screentip");
        }

        public string GetSupertip(IRibbonControl control)
        {
            return RibbonLocalizer.GetString(control.Id + "_supertip");
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
                            MessageBox.Show(RibbonLocalizer.GetString("ReadFormulaPrefix") + f.Latex, RibbonLocalizer.GetString("ErrorTitle"));
                        else
                            MessageBox.Show(RibbonLocalizer.GetString("NoFormulaSelected"), RibbonLocalizer.GetString("ErrorTitle"));
                    }
                    catch (Exception ex) { MessageBox.Show("Error: " + ex.Message, RibbonLocalizer.GetString("ErrorTitle")); }
                    break;

                case "delete":
                    var ok = addIn.Adapter.DeleteCurrent();
                    MessageBox.Show(ok ? RibbonLocalizer.GetString("FormulaDeleted") : RibbonLocalizer.GetString("NoFormulaSelected"), RibbonLocalizer.GetString("ErrorTitle"));
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
                    MessageBox.Show("LaTeXSnipper v1.0.0", RibbonLocalizer.GetString("ErrorTitle"));
                    break;

                default:
                    MessageBox.Show(RibbonLocalizer.GetString("NotImplemented") + ": " + control.Tag, RibbonLocalizer.GetString("ErrorTitle"));
                    break;
            }
        }

        public void NotifyConnected()
        {
            _ribbon?.Invalidate();
        }
    }
}
