#if OFFICE_PIA
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
        public string GetCustomUI(string ribbonId)
        {
            var asm = System.Reflection.Assembly.GetExecutingAssembly();
            using var stream = asm.GetManifestResourceStream("LaTeXSnipper.PowerPoint.Ribbon.PowerPointRibbon.xml");
            if (stream == null) return "";
            using var reader = new System.IO.StreamReader(stream);
            return reader.ReadToEnd();
        }

        public void OnButtonClick(IRibbonControl control)
        {
            var addIn = Globals.ThisAddIn;
            string rid = Guid.NewGuid().ToString("N").Substring(0, 12);
            var sid = addIn.SessionId;

            switch (control.Tag as string)
            {
                case "readSelection":
                    try
                    {
                        var f = addIn.Adapter.ReadSelection();
                        if (f != null && !string.IsNullOrEmpty(f.Latex))
                            MessageBox.Show("LaTeX: " + f.Latex, "LaTeXSnipper");
                        else
                            MessageBox.Show("未选中公式", "LaTeXSnipper");
                    }
                    catch (Exception ex) { MessageBox.Show("错误: " + ex.Message, "LaTeXSnipper"); }
                    break;

                case "delete":
                    addIn.Adapter.DeleteCurrent();
                    MessageBox.Show("已执行删除", "LaTeXSnipper");
                    break;

                case "settings":
                    addIn.Send(new VstoFocusSettings { RequestId = rid, SessionId = sid });
                    break;

                case "ocr":
                    addIn.Send(new VstoRequestOcr { RequestId = rid, SessionId = sid });
                    break;

                case "formatSelected":
                case "formatAll":
                    addIn.Send(new VstoRequestFormat { RequestId = rid, SessionId = sid, Action = control.Tag as string });
                    break;

                case "help":
                    MessageBox.Show("LaTeXSnipper v1.0.0", "LaTeXSnipper");
                    break;

                default:
                    addIn.Send(new VstoOpenEditor { RequestId = rid, SessionId = sid });
                    break;
            }
        }
    }
}

#endif
