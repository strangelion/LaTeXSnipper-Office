using Microsoft.Office.Tools.Ribbon;
using System;

namespace LaTeXSnipper.Word
{
    partial class FormulaRibbon
    {
        private void btnInsertFormula_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show(
                "Pipe not connected yet.\n\nThis will insert a formula from the LaTeXSnipper Desktop editor.",
                "LaTeXSnipper");
        }

        private void btnReadSelection_Click(object sender, RibbonControlEventArgs e)
        {
            var contextId = Globals.ThisAddIn.Adapter.GetCurrentContextId();
            System.Windows.Forms.MessageBox.Show(
                "Current context: " + contextId,
                "LaTeXSnipper");
        }

        private void btnSmokeTest_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show(
                "FormulaRibbon is loaded.",
                "LaTeXSnipper");
        }
    }
}
