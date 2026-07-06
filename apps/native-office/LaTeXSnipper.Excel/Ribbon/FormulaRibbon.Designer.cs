namespace LaTeXSnipper.Excel
{
    partial class FormulaRibbon : Microsoft.Office.Tools.Ribbon.RibbonBase
    {
        private System.ComponentModel.IContainer components = null;

        public FormulaRibbon() : base(Globals.Factory.GetRibbonFactory()) { InitializeComponent(); }
        protected override void Dispose(bool disposing)
        { if (disposing && (components != null)) components.Dispose(); base.Dispose(disposing); }

        private void InitializeComponent()
        {
            this.tabLaTeXSnipper = this.Factory.CreateRibbonTab();
            this.tabLaTeXSnipper.ControlId.ControlIdType = Microsoft.Office.Tools.Ribbon.RibbonControlIdType.Custom;
            this.tabLaTeXSnipper.Label = "LaTeXSnipper";
            this.tabLaTeXSnipper.Name = "tabLaTeXSnipper";

            // Formula group
            this.groupFormula = this.Factory.CreateRibbonGroup();
            this.btnInsertFormula = this.Factory.CreateRibbonButton();
            this.btnOcrSelector = this.Factory.CreateRibbonButton();
            this.groupFormula.Items.Add(this.btnInsertFormula);
            this.groupFormula.Items.Add(this.btnOcrSelector);
            this.groupFormula.Label = "Formula";
            this.groupFormula.Name = "groupFormula";
            this.btnInsertFormula.Label = "Insert Formula";
            this.btnInsertFormula.Name = "btnInsertFormula";
            this.btnInsertFormula.Click += this.btnInsertFormula_Click;
            this.btnOcrSelector.Label = "Screenshot OCR";
            this.btnOcrSelector.Name = "btnOcrSelector";
            this.btnOcrSelector.Click += this.btnOcrSelector_Click;

            // Edit group
            this.groupEdit = this.Factory.CreateRibbonGroup();
            this.btnLoadSelected = this.Factory.CreateRibbonButton();
            this.btnDeleteSelected = this.Factory.CreateRibbonButton();
            this.groupEdit.Items.Add(this.btnLoadSelected);
            this.groupEdit.Items.Add(this.btnDeleteSelected);
            this.groupEdit.Label = "Edit";
            this.groupEdit.Name = "groupEdit";
            this.btnLoadSelected.Label = "Read Selection";
            this.btnLoadSelected.Name = "btnLoadSelected";
            this.btnLoadSelected.Click += this.btnLoadSelected_Click;
            this.btnDeleteSelected.Label = "Delete";
            this.btnDeleteSelected.Name = "btnDeleteSelected";
            this.btnDeleteSelected.Click += this.btnDeleteSelected_Click;

            // Conversion group
            this.groupConversion = this.Factory.CreateRibbonGroup();
            this.btnToOle = this.Factory.CreateRibbonButton();
            this.btnToPng = this.Factory.CreateRibbonButton();
            this.groupConversion.Items.Add(this.btnToOle);
            this.groupConversion.Items.Add(this.btnToPng);
            this.groupConversion.Label = "Conversion";
            this.groupConversion.Name = "groupConversion";
            this.btnToOle.Label = "To OLE";
            this.btnToOle.Name = "btnToOle";
            this.btnToOle.Click += this.btnToOle_Click;
            this.btnToPng.Label = "To PNG";
            this.btnToPng.Name = "btnToPng";
            this.btnToPng.Click += this.btnToPng_Click;

            // Formatting group
            this.groupFormatting = this.Factory.CreateRibbonGroup();
            this.btnFormatSelected = this.Factory.CreateRibbonButton();
            this.btnFormatAll = this.Factory.CreateRibbonButton();
            this.groupFormatting.Items.Add(this.btnFormatSelected);
            this.groupFormatting.Items.Add(this.btnFormatAll);
            this.groupFormatting.Label = "Formatting";
            this.groupFormatting.Name = "groupFormatting";
            this.btnFormatSelected.Label = "Format Selected";
            this.btnFormatSelected.Name = "btnFormatSelected";
            this.btnFormatSelected.Click += this.btnFormatSelected_Click;
            this.btnFormatAll.Label = "Format All";
            this.btnFormatAll.Name = "btnFormatAll";
            this.btnFormatAll.Click += this.btnFormatAll_Click;

            // Tools group
            this.groupTools = this.Factory.CreateRibbonGroup();
            this.btnShowTaskPane = this.Factory.CreateRibbonButton();
            this.btnSettings = this.Factory.CreateRibbonButton();
            this.btnHelp = this.Factory.CreateRibbonButton();
            this.groupTools.Items.Add(this.btnShowTaskPane);
            this.groupTools.Items.Add(this.btnSettings);
            this.groupTools.Items.Add(this.btnHelp);
            this.groupTools.Label = "Tools";
            this.groupTools.Name = "groupTools";
            this.btnShowTaskPane.Label = "Show Pane";
            this.btnShowTaskPane.Name = "btnShowTaskPane";
            this.btnShowTaskPane.Click += this.btnShowTaskPane_Click;
            this.btnSettings.Label = "Settings";
            this.btnSettings.Name = "btnSettings";
            this.btnSettings.Click += this.btnSettings_Click;
            this.btnHelp.Label = "Help";
            this.btnHelp.Name = "btnHelp";
            this.btnHelp.Click += this.btnHelp_Click;

            this.tabLaTeXSnipper.Groups.Add(this.groupFormula);
            this.tabLaTeXSnipper.Groups.Add(this.groupEdit);
            this.tabLaTeXSnipper.Groups.Add(this.groupConversion);
            this.tabLaTeXSnipper.Groups.Add(this.groupFormatting);
            this.tabLaTeXSnipper.Groups.Add(this.groupTools);

            this.Name = "FormulaRibbon";
            this.RibbonType = "Microsoft.Excel.Workbook";
            this.Tabs.Add(this.tabLaTeXSnipper);
            this.ResumeLayout(false);
        }

        internal Microsoft.Office.Tools.Ribbon.RibbonTab tabLaTeXSnipper;
        internal Microsoft.Office.Tools.Ribbon.RibbonGroup groupFormula, groupEdit, groupConversion;
        internal Microsoft.Office.Tools.Ribbon.RibbonGroup groupFormatting, groupTools;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnInsertFormula, btnOcrSelector;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnLoadSelected, btnDeleteSelected;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnToOle, btnToPng;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnFormatSelected, btnFormatAll;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnShowTaskPane, btnSettings, btnHelp;
    }

    partial class ThisRibbonCollection
    {
        internal FormulaRibbon FormulaRibbon { get { return this.GetRibbon<FormulaRibbon>(); } }
    }
}
