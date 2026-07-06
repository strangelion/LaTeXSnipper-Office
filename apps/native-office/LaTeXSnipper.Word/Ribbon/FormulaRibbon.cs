using LaTeXSnipper.NativeOffice.Shared;
using Microsoft.Office.Tools.Ribbon;
using System;

namespace LaTeXSnipper.Word
{
    partial class FormulaRibbon
    {
        private void SendToDesktop(VstoMessage msg)
        {
            if (Globals.ThisAddIn.PipeConnected)
                Globals.ThisAddIn.PipeClient?.SendAsync(msg);
            else
                System.Windows.Forms.MessageBox.Show("请先启动 LaTeXSnipper Desktop。", "LaTeXSnipper");
        }

        private void btnInsertInline_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoOpenEditor
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId });
        }

        private void btnInsertDisplay_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoOpenEditor
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId });
        }

        private void btnInsertNumbered_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoOpenEditor
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId });
        }

        private void btnOcrSelector_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoRequestOcr
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId });
        }

        private void btnLoadSelected_Click(object sender, RibbonControlEventArgs e)
        {
            try {
                var f = Globals.ThisAddIn.Adapter.ReadSelection();
                if (f != null && !string.IsNullOrEmpty(f.Latex))
                    System.Windows.Forms.MessageBox.Show("LaTeX: " + f.Latex, "LaTeXSnipper");
                else
                    System.Windows.Forms.MessageBox.Show("未选中公式。", "LaTeXSnipper");
            } catch (Exception ex) {
                System.Windows.Forms.MessageBox.Show("错误: " + ex.Message, "LaTeXSnipper");
            }
        }

        private void btnDeleteSelected_Click(object sender, RibbonControlEventArgs e)
        {
            var r = Globals.ThisAddIn.Adapter.DeleteCurrent();
            System.Windows.Forms.MessageBox.Show(r.Success ? "公式已删除。" : "错误: " + r.Error, "LaTeXSnipper");
        }

        private void btnToOle_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoOpenEditor
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId });
        }

        private void btnToOmml_Click(object sender, RibbonControlEventArgs e)
        {
            var f = Globals.ThisAddIn.Adapter.ReadSelection();
            var msg = f?.Omml ?? "No formula selected";
            System.Windows.Forms.MessageBox.Show(msg.Length > 200 ? msg.Substring(0, 200) + "..." : msg, "LaTeXSnipper - OMML");
        }

        private void btnInsertReference_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoRequestReference
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId });
        }

        private void btnAutoNumber_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoRequestNumbering
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId, Action = "auto" });
        }

        private void btnRenumber_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoRequestNumbering
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId, Action = "renumber" });
        }

        private void btnChapterBoundary_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoRequestBoundary
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId, Type = "chapter" });
        }

        private void btnSectionBoundary_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoRequestBoundary
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId, Type = "section" });
        }

        private void btnFormatSelected_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoRequestFormat
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId, Action = "selection" });
        }

        private void btnFormatAll_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoRequestFormat
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId, Action = "all" });
        }

        private void btnShowTaskPane_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoOpenEditor
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId });
        }

        private void btnSettings_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoFocusSettings
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId });
        }

        private void btnHelp_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show("LaTeXSnipper v1.0.0\n原生 Office 公式插件\n通过 Desktop 应用插入公式。", "LaTeXSnipper");
        }
    }
}
