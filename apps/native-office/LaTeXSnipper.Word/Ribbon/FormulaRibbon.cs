using Microsoft.Office.Tools.Ribbon;
using System;

namespace LaTeXSnipper.Word
{
    partial class FormulaRibbon
    {
        private void btnInsertFormula_Click(object sender, RibbonControlEventArgs e)
        {
            if (Globals.ThisAddIn.PipeConnected)
            {
                // Desktop handles the insertion via Pipe - notify user
                System.Windows.Forms.MessageBox.Show(
                    "Use the LaTeXSnipper Desktop app to insert formulas.\n\nClick the 'Insert' button in the Desktop editor.",
                    "LaTeXSnipper");
            }
            else
            {
                System.Windows.Forms.MessageBox.Show(
                    "Desktop not connected. Please start LaTeXSnipper Desktop first.",
                    "LaTeXSnipper");
            }
        }

        private void btnReadSelection_Click(object sender, RibbonControlEventArgs e)
        {
            try
            {
                var formula = Globals.ThisAddIn.Adapter.ReadSelection();
                if (formula != null && !string.IsNullOrEmpty(formula.Latex))
                {
                    System.Windows.Forms.MessageBox.Show(
                        "LaTeX: " + formula.Latex + "\n\nFormula ID: " + formula.FormulaId,
                        "LaTeXSnipper - Read Selection");
                }
                else if (formula != null && !string.IsNullOrEmpty(formula.Omml))
                {
                    System.Windows.Forms.MessageBox.Show(
                        "OMML formula detected (length: " + formula.Omml.Length + " chars)\n\nFormula ID: " + formula.FormulaId,
                        "LaTeXSnipper - Read Selection");
                }
                else
                {
                    System.Windows.Forms.MessageBox.Show(
                        "No LaTeX formula found at the current selection.",
                        "LaTeXSnipper");
                }
            }
            catch (Exception ex)
            {
                System.Windows.Forms.MessageBox.Show(
                    "Error: " + ex.Message,
                    "LaTeXSnipper");
            }
        }

        private void btnSmokeTest_Click(object sender, RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show(
                "FormulaRibbon is loaded.",
                "LaTeXSnipper");
        }
    }
}
