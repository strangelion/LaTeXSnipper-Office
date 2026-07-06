using Microsoft.Office.Tools.Ribbon;
using System;

namespace LaTeXSnipper.PowerPoint
{
    partial class FormulaRibbon
    {
        private void btnInsertFormula_Click(object sender, RibbonControlEventArgs e)
        {
            if (Globals.ThisAddIn.PipeConnected)
                System.Windows.Forms.MessageBox.Show("请使用 LaTeXSnipper Desktop 插入公式。", "LaTeXSnipper");
            else
                System.Windows.Forms.MessageBox.Show("请先启动 LaTeXSnipper Desktop。", "LaTeXSnipper");
        }

        private void btnOcrSelector_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show("OCR 功能需要 LaTeXSnipper Desktop 支持。", "LaTeXSnipper");
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
            System.Windows.Forms.MessageBox.Show("删除操作已执行。", "LaTeXSnipper");
        }

        private void btnToOle_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show("该功能尚未实现。", "LaTeXSnipper");
        }

        private void btnToPng_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show("该功能尚未实现。", "LaTeXSnipper");
        }

        private void btnFormatSelected_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show("该功能尚未实现。", "LaTeXSnipper");
        }

        private void btnFormatAll_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show("该功能尚未实现。", "LaTeXSnipper");
        }

        private void btnShowTaskPane_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show("任务窗格功能需要 Desktop 连接。", "LaTeXSnipper");
        }

        private void btnSettings_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show("请在 LaTeXSnipper Desktop 中打开设置。", "LaTeXSnipper");
        }

        private void btnHelp_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show("LaTeXSnipper — 原生 Office 公式插件\n版本 1.0.0", "LaTeXSnipper");
        }
    }
}
