using LaTeXSnipper.NativeOffice.Shared;
using Microsoft.Office.Tools.Ribbon;
using System;

namespace LaTeXSnipper.PowerPoint
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

        private void btnInsertFormula_Click(object sender, RibbonControlEventArgs e)
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
            Globals.ThisAddIn.Adapter.DeleteCurrent();
            System.Windows.Forms.MessageBox.Show("已尝试删除选中公式。", "LaTeXSnipper");
        }

        private void btnToOle_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoOpenEditor
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId });
        }

        private void btnToPng_Click(object sender, RibbonControlEventArgs e)
        {
            SendToDesktop(new VstoOpenEditor
            { RequestId = Guid.NewGuid().ToString("N").Substring(0, 12), SessionId = Globals.ThisAddIn.SessionId });
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
            System.Windows.Forms.MessageBox.Show("LaTeXSnipper v1.0.0", "LaTeXSnipper");
        }
    }
}
