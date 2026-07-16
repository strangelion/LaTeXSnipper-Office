#nullable enable
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;
using Microsoft.Office.Core;

namespace LaTeXSnipper.Visio
{
    [ComVisible(true)]
    public sealed class VisioRibbonExtensibility : IRibbonExtensibility
    {
        private IRibbonUI? _ribbon;

        public string GetCustomUI(string ribbonId)
        {
            using (var stream = typeof(VisioRibbonExtensibility).Assembly.GetManifestResourceStream("LaTeXSnipper.Visio.Ribbon.VisioRibbon.xml"))
            {
                if (stream == null) return "";
                using (var reader = new System.IO.StreamReader(stream)) return reader.ReadToEnd();
            }
        }

        public void OnRibbonLoad(IRibbonUI ribbon) { _ribbon = ribbon; }
        public bool GetDesktopCommandEnabled(IRibbonControl control) => Globals.ThisAddIn?.PipeConnected == true;
        public string GetLabel(IRibbonControl control) => RibbonLocalizer.GetString(control.Id);
        public string GetScreentip(IRibbonControl control) => RibbonLocalizer.GetString(control.Id + "_screentip");
        public string GetSupertip(IRibbonControl control) => RibbonLocalizer.GetString(control.Id + "_supertip");

        public void OnButtonClick(IRibbonControl control)
        {
            ThisAddIn? addIn = Globals.ThisAddIn;
            if (addIn == null) return;
            string requestId = Guid.NewGuid().ToString("N").Substring(0, 12);
            switch (control.Tag as string)
            {
                case "insertFormula":
                    addIn.Send(new VstoOpenEditor { RequestId = requestId, SessionId = addIn.SessionId, Action = "insert", Display = "display", SourceHost = "visio" });
                    break;
                case "readSelection":
                    FormulaPayload? payload = addIn.Adapter?.ReadSelection();
                    MessageBox.Show(payload == null ? RibbonLocalizer.GetString("NoFormulaSelected") : RibbonLocalizer.GetString("ReadFormulaPrefix") + payload.Latex, RibbonLocalizer.GetString("ErrorTitle"));
                    break;
                case "delete":
                    bool deleted = addIn.Adapter?.DeleteCurrent() == true;
                    MessageBox.Show(deleted ? RibbonLocalizer.GetString("FormulaDeleted") : RibbonLocalizer.GetString("NoFormulaSelected"), RibbonLocalizer.GetString("ErrorTitle"));
                    break;
                case "showPane":
                    addIn.Send(new VstoOpenEditor { RequestId = requestId, SessionId = addIn.SessionId, Action = "focus", SourceHost = "visio" });
                    break;
                case "ocr":
                    addIn.Send(new VstoFocusOcr { RequestId = requestId, SessionId = addIn.SessionId });
                    break;
                case "settings":
                    addIn.Send(new VstoFocusSettings { RequestId = requestId, SessionId = addIn.SessionId });
                    break;
                case "help":
                    MessageBox.Show("LaTeXSnipper Native Visio", RibbonLocalizer.GetString("ErrorTitle"));
                    break;
            }
        }

        public void NotifyConnected() => _ribbon?.Invalidate();
    }
}
