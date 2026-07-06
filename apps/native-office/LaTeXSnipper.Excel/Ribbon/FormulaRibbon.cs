using Microsoft.Office.Tools.Ribbon;
using System;

namespace LaTeXSnipper.Excel
{
    partial class FormulaRibbon
    {
        private void btnInsertFormula_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show(
                "请使用 LaTeXSnipper Desktop 插入公式。",
                "LaTeXSnipper");
        }

        private void btnLoadFormula_Click(object sender, RibbonControlEventArgs e)
        {
            try
            {
                var formula = Globals.ThisAddIn.Adapter.ReadSelection();
                if (formula != null && !string.IsNullOrEmpty(formula.Latex))
                    System.Windows.Forms.MessageBox.Show("LaTeX: " + formula.Latex, "LaTeXSnipper");
                else
                    System.Windows.Forms.MessageBox.Show("未选中公式。", "LaTeXSnipper");
            }
            catch (Exception ex)
            {
                System.Windows.Forms.MessageBox.Show("错误: " + ex.Message, "LaTeXSnipper");
            }
        }

        private void btnDeleteFormula_Click(object sender, RibbonControlEventArgs e)
        {
            if (Globals.ThisAddIn.Adapter.DeleteCurrent())
                System.Windows.Forms.MessageBox.Show("公式已删除。", "LaTeXSnipper");
            else
                System.Windows.Forms.MessageBox.Show("未找到可删除的公式。", "LaTeXSnipper");
        }

        private void btnOpenEditor_Click(object sender, RibbonControlEventArgs e)
        {
            if (Globals.ThisAddIn.PipeConnected)
                System.Windows.Forms.MessageBox.Show("Desktop 已连接，请在 Desktop 中编辑。", "LaTeXSnipper");
            else
                System.Windows.Forms.MessageBox.Show("请先启动 LaTeXSnipper Desktop。", "LaTeXSnipper");
        }
    }
}
