using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Office.Core;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Word
{
    [ComVisible(true)]
    public sealed class WordRibbonExtensibility : IRibbonExtensibility
    {
        private IRibbonUI _ribbon;

        public string GetCustomUI(string ribbonId)
        {
            var asm = System.Reflection.Assembly.GetExecutingAssembly();
            using var stream = asm.GetManifestResourceStream("LaTeXSnipper.Word.Ribbon.LaTeXSnipperRibbon.xml");
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
                case "insertInline":
                    addIn.Send(new VstoOpenEditor
                    {
                        RequestId = rid,
                        SessionId = sid,
                        Action = "insert",
                        Display = "inline"
                    });
                    break;

                case "insertDisplay":
                    addIn.Send(new VstoOpenEditor
                    {
                        RequestId = rid,
                        SessionId = sid,
                        Action = "insert",
                        Display = "display"
                    });
                    break;

                case "insertNumbered":
                    addIn.Send(new VstoOpenEditor
                    {
                        RequestId = rid,
                        SessionId = sid,
                        Action = "insert",
                        Display = "numbered"
                    });
                    break;

                case "readSelection":
                    try
                    {
                        var f = addIn.Adapter.ReadSelection();
                        if (f != null && !string.IsNullOrEmpty(f.Latex))
                            MessageBox.Show("LaTeX: " + f.Latex, "LaTeXSnipper");
                        else if (f != null && !string.IsNullOrEmpty(f.Omml))
                            addIn.Send(new VstoOpenEditor
                            {
                                RequestId = rid,
                                SessionId = sid,
                                Action = "edit",
                                Omml = f.Omml
                            });
                        else
                            MessageBox.Show("No formula selected", "LaTeXSnipper");
                    }
                    catch (Exception ex) { MessageBox.Show("Error: " + ex.Message, "LaTeXSnipper"); }
                    break;

                case "delete":
                    addIn.Send(new VstoOpenEditor
                    {
                        RequestId = rid,
                        SessionId = sid,
                        Action = "delete"
                    });
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
                    MessageBox.Show("LaTeXSnipper v1.0.0\nNative Office formula plugin", "LaTeXSnipper");
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
