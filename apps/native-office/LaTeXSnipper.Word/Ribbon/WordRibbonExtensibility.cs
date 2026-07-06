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
        public string GetCustomUI(string ribbonId)
        {
            var asm = System.Reflection.Assembly.GetExecutingAssembly();
            using var stream = asm.GetManifestResourceStream("LaTeXSnipper.Word.Ribbon.LaTeXSnipperRibbon.xml");
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
                            MessageBox.Show("未选中公式。", "LaTeXSnipper");
                    }
                    catch (Exception ex) { MessageBox.Show("错误: " + ex.Message, "LaTeXSnipper"); }
                    break;

                case "delete":
                    var r = addIn.Adapter.DeleteCurrent();
                    MessageBox.Show(r.Success ? "已删除。" : "失败: " + r.Error, "LaTeXSnipper");
                    break;

                case "toOmml":
                    var f2 = addIn.Adapter.ReadSelection();
                    var xml = f2?.Omml ?? "";
                    MessageBox.Show(xml.Length > 100 ? xml.Substring(0, 100) + "..." : (xml.Length > 0 ? xml : "无公式"), "LaTeXSnipper - OMML");
                    break;

                case "settings":
                    addIn.Send(new VstoFocusSettings { RequestId = rid, SessionId = sid });
                    break;

                case "ocr":
                    addIn.Send(new VstoRequestOcr { RequestId = rid, SessionId = sid });
                    break;

                case "insertReference":
                    addIn.Send(new VstoRequestReference { RequestId = rid, SessionId = sid });
                    break;

                case "autoNumber":
                case "renumber":
                    addIn.Send(new VstoRequestNumbering { RequestId = rid, SessionId = sid, Action = control.Tag as string });
                    break;

                case "chapterBoundary":
                case "sectionBoundary":
                    addIn.Send(new VstoRequestBoundary { RequestId = rid, SessionId = sid, Type = control.Tag as string });
                    break;

                case "formatSelected":
                case "formatAll":
                    addIn.Send(new VstoRequestFormat { RequestId = rid, SessionId = sid, Action = control.Tag as string });
                    break;

                case "help":
                    MessageBox.Show("LaTeXSnipper v1.0.0\n原生 Office 公式插件", "LaTeXSnipper");
                    break;

                default: // insertInline, insertDisplay, insertNumbered, toOle, showPane
                    addIn.Send(new VstoOpenEditor { RequestId = rid, SessionId = sid });
                    break;
            }
        }
    }
}
