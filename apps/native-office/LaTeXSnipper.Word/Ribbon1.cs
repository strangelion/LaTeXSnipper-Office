using Microsoft.Office.Tools.Ribbon;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace LaTeXSnipper.Word
{
    public partial class Ribbon1
    {
        private void Ribbon1_Load(object sender, RibbonUIEventArgs e)
        {

        }

        private void btnSmokeTest_Click(
        object sender,
        Microsoft.Office.Tools.Ribbon.RibbonControlEventArgs e)
        {
            System.Windows.Forms.MessageBox.Show(
                "Word VSTO Ribbon is loaded.",
                "LaTeXSnipper");
        }
    }
}
