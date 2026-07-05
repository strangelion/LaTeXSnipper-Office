namespace LaTeXSnipper.Word
{
    partial class FormulaRibbon : Microsoft.Office.Tools.Ribbon.RibbonBase
    {
        private System.ComponentModel.IContainer components = null;

        public FormulaRibbon()
            : base(Globals.Factory.GetRibbonFactory())
        {
            System.Diagnostics.Debug.WriteLine(
                "[FormulaRibbon] Constructor called.");
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
            this.btnInsertFormula = this.Factory.CreateRibbonButton();
            this.btnReadSelection = this.Factory.CreateRibbonButton();
            this.groupDevelopment = this.Factory.CreateRibbonGroup();
            this.btnSmokeTest = this.Factory.CreateRibbonButton();
            this.tabLaTeXSnipper.SuspendLayout();
            this.groupFormula.SuspendLayout();
            this.groupDevelopment.SuspendLayout();
            this.SuspendLayout();
            // 
            // tabLaTeXSnipper
            // 
            this.tabLaTeXSnipper.Groups.Add(this.groupFormula);
            this.tabLaTeXSnipper.Groups.Add(this.groupDevelopment);
            this.tabLaTeXSnipper.Label = "LaTeXSnipper";
            this.tabLaTeXSnipper.Name = "tabLaTeXSnipper";
            // 
            // groupFormula
            // 
            this.groupFormula.Items.Add(this.btnInsertFormula);
            this.groupFormula.Items.Add(this.btnReadSelection);
            this.groupFormula.Label = "Formula";
            this.groupFormula.Name = "groupFormula";
            // 
            // btnInsertFormula
            // 
            this.btnInsertFormula.Label = "Insert Formula";
            this.btnInsertFormula.Name = "btnInsertFormula";
            this.btnInsertFormula.Click += new Microsoft.Office.Tools.Ribbon.RibbonControlEventHandler(this.btnInsertFormula_Click);
            // 
            // btnReadSelection
            // 
            this.btnReadSelection.Label = "Read Selection";
            this.btnReadSelection.Name = "btnReadSelection";
            this.btnReadSelection.Click += new Microsoft.Office.Tools.Ribbon.RibbonControlEventHandler(this.btnReadSelection_Click);
            // 
            // groupDevelopment
            // 
            this.groupDevelopment.Items.Add(this.btnSmokeTest);
            this.groupDevelopment.Label = "Development";
            this.groupDevelopment.Name = "groupDevelopment";
            // 
            // btnSmokeTest
            // 
            this.btnSmokeTest.Label = "Smoke Test";
            this.btnSmokeTest.Name = "btnSmokeTest";
            this.btnSmokeTest.Click += new Microsoft.Office.Tools.Ribbon.RibbonControlEventHandler(this.btnSmokeTest_Click);
            // 
            // FormulaRibbon
            // 
            this.Name = "FormulaRibbon";
            this.RibbonType = "Microsoft.Word.Document";
            this.Tabs.Add(this.tabLaTeXSnipper);
            this.tabLaTeXSnipper.ResumeLayout(false);
            this.tabLaTeXSnipper.PerformLayout();
            this.groupFormula.ResumeLayout(false);
            this.groupFormula.PerformLayout();
            this.groupDevelopment.ResumeLayout(false);
            this.groupDevelopment.PerformLayout();
            this.ResumeLayout(false);

        }

        internal Microsoft.Office.Tools.Ribbon.RibbonTab tabLaTeXSnipper;
        internal Microsoft.Office.Tools.Ribbon.RibbonGroup groupFormula;
        internal Microsoft.Office.Tools.Ribbon.RibbonGroup groupDevelopment;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnInsertFormula;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnReadSelection;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnSmokeTest;
    }

    partial class ThisRibbonCollection
    {
        internal FormulaRibbon FormulaRibbon
        {
            get { return this.GetRibbon<FormulaRibbon>(); }
        }
    }
}
