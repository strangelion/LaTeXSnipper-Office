namespace LaTeXSnipper.Excel
{
    partial class FormulaRibbon : Microsoft.Office.Tools.Ribbon.RibbonBase
    {
        private System.ComponentModel.IContainer components = null;

        public FormulaRibbon() : base(Globals.Factory.GetRibbonFactory())
        {
            InitializeComponent();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        private void InitializeComponent()
        {
            this.tabLaTeXSnipper = this.Factory.CreateRibbonTab();
            this.groupFormula = this.Factory.CreateRibbonGroup();
            this.groupTools = this.Factory.CreateRibbonGroup();
            this.btnInsertFormula = this.Factory.CreateRibbonButton();
            this.btnLoadFormula = this.Factory.CreateRibbonButton();
            this.btnDeleteFormula = this.Factory.CreateRibbonButton();
            this.btnOpenEditor = this.Factory.CreateRibbonButton();
            this.tabLaTeXSnipper.SuspendLayout();
            this.groupFormula.SuspendLayout();
            this.groupTools.SuspendLayout();
            this.SuspendLayout();

            this.tabLaTeXSnipper.ControlId.ControlIdType = Microsoft.Office.Tools.Ribbon.RibbonControlIdType.Custom;
            this.tabLaTeXSnipper.Groups.Add(this.groupFormula);
            this.tabLaTeXSnipper.Groups.Add(this.groupTools);
            this.tabLaTeXSnipper.Label = "LaTeXSnipper";
            this.tabLaTeXSnipper.Name = "tabLaTeXSnipper";

            this.groupFormula.Items.Add(this.btnInsertFormula);
            this.groupFormula.Items.Add(this.btnLoadFormula);
            this.groupFormula.Items.Add(this.btnDeleteFormula);
            this.groupFormula.Label = "Formula";
            this.groupFormula.Name = "groupFormula";

            this.groupTools.Items.Add(this.btnOpenEditor);
            this.groupTools.Label = "Tools";
            this.groupTools.Name = "groupTools";

            this.btnInsertFormula.Label = "Insert Formula";
            this.btnInsertFormula.Name = "btnInsertFormula";
            this.btnInsertFormula.Click += new Microsoft.Office.Tools.Ribbon.RibbonControlEventHandler(this.btnInsertFormula_Click);

            this.btnLoadFormula.Label = "Read Selection";
            this.btnLoadFormula.Name = "btnLoadFormula";
            this.btnLoadFormula.Click += new Microsoft.Office.Tools.Ribbon.RibbonControlEventHandler(this.btnLoadFormula_Click);

            this.btnDeleteFormula.Label = "Delete";
            this.btnDeleteFormula.Name = "btnDeleteFormula";
            this.btnDeleteFormula.Click += new Microsoft.Office.Tools.Ribbon.RibbonControlEventHandler(this.btnDeleteFormula_Click);

            this.btnOpenEditor.Label = "Desktop";
            this.btnOpenEditor.Name = "btnOpenEditor";
            this.btnOpenEditor.Click += new Microsoft.Office.Tools.Ribbon.RibbonControlEventHandler(this.btnOpenEditor_Click);

            this.Name = "FormulaRibbon";
            this.RibbonType = "Microsoft.Excel.Workbook";
            this.Tabs.Add(this.tabLaTeXSnipper);
            this.tabLaTeXSnipper.ResumeLayout(false);
            this.tabLaTeXSnipper.PerformLayout();
            this.groupFormula.ResumeLayout(false);
            this.groupFormula.PerformLayout();
            this.groupTools.ResumeLayout(false);
            this.groupTools.PerformLayout();
            this.ResumeLayout(false);
        }

        internal Microsoft.Office.Tools.Ribbon.RibbonTab tabLaTeXSnipper;
        internal Microsoft.Office.Tools.Ribbon.RibbonGroup groupFormula;
        internal Microsoft.Office.Tools.Ribbon.RibbonGroup groupTools;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnInsertFormula;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnLoadFormula;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnDeleteFormula;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnOpenEditor;
    }

    partial class ThisRibbonCollection
    {
        internal FormulaRibbon FormulaRibbon
        {
            get { return this.GetRibbon<FormulaRibbon>(); }
        }
    }
}
