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

            this.groupFormula = this.Factory.CreateRibbonGroup();
            this.btnInsertFormula = MakeButton("Insert Formula", "btnInsertFormula", "EquationProfessional");
            this.btnInsertFormula.Click += this.btnInsertFormula_Click;
            this.btnOcrSelector = MakeButton("Screenshot OCR", "btnOcrSelector", "ScreenshotInsertGallery");
            this.btnOcrSelector.Click += this.btnOcrSelector_Click;
            this.groupFormula.Items.Add(this.btnInsertFormula);
            this.groupFormula.Items.Add(this.btnOcrSelector);
            this.groupFormula.Label = "Formula";
            this.groupFormula.Name = "groupFormula";

            this.groupEdit = this.Factory.CreateRibbonGroup();
            this.btnLoadSelected = MakeButton("Read Selection", "btnLoadSelected", "ReviewDisplayForReview");
            this.btnLoadSelected.Click += this.btnLoadSelected_Click;
            this.btnDeleteSelected = MakeButton("Delete", "btnDeleteSelected", "Delete");
            this.btnDeleteSelected.Click += this.btnDeleteSelected_Click;
            this.groupEdit.Items.Add(this.btnLoadSelected);
            this.groupEdit.Items.Add(this.btnDeleteSelected);
            this.groupEdit.Label = "Edit";
            this.groupEdit.Name = "groupEdit";

            this.groupConversion = this.Factory.CreateRibbonGroup();
            this.btnToOle = MakeButton("To OLE", "btnToOle", "ObjectEditDialog");
            this.btnToOle.Click += this.btnToOle_Click;
            this.btnToPng = MakeButton("To PNG", "btnToPng", "PictureInsertFromFile");
            this.btnToPng.Click += this.btnToPng_Click;
            this.groupConversion.Items.Add(this.btnToOle);
            this.groupConversion.Items.Add(this.btnToPng);
            this.groupConversion.Label = "Conversion";
            this.groupConversion.Name = "groupConversion";

            this.groupFormatting = this.Factory.CreateRibbonGroup();
            this.btnFormatSelected = MakeButton("Format Selected", "btnFormatSelected", "FormatPainter");
            this.btnFormatSelected.Click += this.btnFormatSelected_Click;
            this.btnFormatAll = MakeButton("Format All", "btnFormatAll", "FontDialog");
            this.btnFormatAll.Click += this.btnFormatAll_Click;
            this.groupFormatting.Items.Add(this.btnFormatSelected);
            this.groupFormatting.Items.Add(this.btnFormatAll);
            this.groupFormatting.Label = "Formatting";
            this.groupFormatting.Name = "groupFormatting";

            this.groupTools = this.Factory.CreateRibbonGroup();
            this.btnShowTaskPane = MakeButton("Show Pane", "btnShowTaskPane", "ReviewingPane");
            this.btnShowTaskPane.Click += this.btnShowTaskPane_Click;
            this.btnSettings = MakeButton("Settings", "btnSettings", "AdvancedFileProperties");
            this.btnSettings.Click += this.btnSettings_Click;
            this.btnHelp = MakeButton("Help", "btnHelp", "Help");
            this.btnHelp.Click += this.btnHelp_Click;
            this.groupTools.Items.Add(this.btnShowTaskPane);
            this.groupTools.Items.Add(this.btnSettings);
            this.groupTools.Items.Add(this.btnHelp);
            this.groupTools.Label = "Tools";
            this.groupTools.Name = "groupTools";

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

        private Microsoft.Office.Tools.Ribbon.RibbonButton MakeButton(string label, string name, string imageId)
        {
            var btn = this.Factory.CreateRibbonButton();
            btn.Label = label; btn.Name = name; btn.OfficeImageId = imageId; btn.ShowImage = true;
            return btn;
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
    { internal FormulaRibbon FormulaRibbon { get { return this.GetRibbon<FormulaRibbon>(); } } }
}
