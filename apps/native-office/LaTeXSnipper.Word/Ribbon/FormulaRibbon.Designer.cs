namespace LaTeXSnipper.Word
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
            if (disposing && (components != null)) { components.Dispose(); }
            base.Dispose(disposing);
        }

        private void InitializeComponent()
        {
            // Tab
            this.tabLaTeXSnipper = this.Factory.CreateRibbonTab();
            this.tabLaTeXSnipper.ControlId.ControlIdType = Microsoft.Office.Tools.Ribbon.RibbonControlIdType.Custom;
            this.tabLaTeXSnipper.Label = "LaTeXSnipper";
            this.tabLaTeXSnipper.Name = "tabLaTeXSnipper";

            // --- Formula group ---
            this.groupFormula = this.Factory.CreateRibbonGroup();
            this.btnInsertInline = this.Factory.CreateRibbonButton();
            this.btnInsertDisplay = this.Factory.CreateRibbonButton();
            this.btnInsertNumbered = this.Factory.CreateRibbonButton();
            this.btnOcrSelector = this.Factory.CreateRibbonButton();
            this.groupFormula.Items.Add(this.btnInsertInline);
            this.groupFormula.Items.Add(this.btnInsertDisplay);
            this.groupFormula.Items.Add(this.btnInsertNumbered);
            this.groupFormula.Items.Add(this.btnOcrSelector);
            this.groupFormula.Label = "Formula";
            this.groupFormula.Name = "groupFormula";
            this.btnInsertInline.Label = "Insert Inline";
            this.btnInsertInline.Name = "btnInsertInline";
            this.btnInsertInline.Click += this.btnInsertInline_Click;
            this.btnInsertDisplay.Label = "Insert Display";
            this.btnInsertDisplay.Name = "btnInsertDisplay";
            this.btnInsertDisplay.Click += this.btnInsertDisplay_Click;
            this.btnInsertNumbered.Label = "Insert Numbered";
            this.btnInsertNumbered.Name = "btnInsertNumbered";
            this.btnInsertNumbered.Click += this.btnInsertNumbered_Click;
            this.btnOcrSelector.Label = "Screenshot OCR";
            this.btnOcrSelector.Name = "btnOcrSelector";
            this.btnOcrSelector.Click += this.btnOcrSelector_Click;

            // --- Edit group ---
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

            // --- Conversion group ---
            this.groupConversion = this.Factory.CreateRibbonGroup();
            this.btnToOle = this.Factory.CreateRibbonButton();
            this.btnToOmml = this.Factory.CreateRibbonButton();
            this.groupConversion.Items.Add(this.btnToOle);
            this.groupConversion.Items.Add(this.btnToOmml);
            this.groupConversion.Label = "Conversion";
            this.groupConversion.Name = "groupConversion";
            this.btnToOle.Label = "To OLE";
            this.btnToOle.Name = "btnToOle";
            this.btnToOle.Click += this.btnToOle_Click;
            this.btnToOmml.Label = "To OMML";
            this.btnToOmml.Name = "btnToOmml";
            this.btnToOmml.Click += this.btnToOmml_Click;

            // --- Reference group ---
            this.groupReference = this.Factory.CreateRibbonGroup();
            this.btnInsertReference = this.Factory.CreateRibbonButton();
            this.groupReference.Items.Add(this.btnInsertReference);
            this.groupReference.Label = "Reference";
            this.groupReference.Name = "groupReference";
            this.btnInsertReference.Label = "Insert Reference";
            this.btnInsertReference.Name = "btnInsertReference";
            this.btnInsertReference.Click += this.btnInsertReference_Click;

            // --- Numbering group ---
            this.groupNumbering = this.Factory.CreateRibbonGroup();
            this.btnAutoNumber = this.Factory.CreateRibbonButton();
            this.btnRenumber = this.Factory.CreateRibbonButton();
            this.groupNumbering.Items.Add(this.btnAutoNumber);
            this.groupNumbering.Items.Add(this.btnRenumber);
            this.groupNumbering.Label = "Numbering";
            this.groupNumbering.Name = "groupNumbering";
            this.btnAutoNumber.Label = "Auto Number";
            this.btnAutoNumber.Name = "btnAutoNumber";
            this.btnAutoNumber.Click += this.btnAutoNumber_Click;
            this.btnRenumber.Label = "Renumber";
            this.btnRenumber.Name = "btnRenumber";
            this.btnRenumber.Click += this.btnRenumber_Click;

            // --- Boundary group ---
            this.groupBoundary = this.Factory.CreateRibbonGroup();
            this.btnChapterBoundary = this.Factory.CreateRibbonButton();
            this.btnSectionBoundary = this.Factory.CreateRibbonButton();
            this.groupBoundary.Items.Add(this.btnChapterBoundary);
            this.groupBoundary.Items.Add(this.btnSectionBoundary);
            this.groupBoundary.Label = "Boundary";
            this.groupBoundary.Name = "groupBoundary";
            this.btnChapterBoundary.Label = "Chapter";
            this.btnChapterBoundary.Name = "btnChapterBoundary";
            this.btnChapterBoundary.Click += this.btnChapterBoundary_Click;
            this.btnSectionBoundary.Label = "Section";
            this.btnSectionBoundary.Name = "btnSectionBoundary";
            this.btnSectionBoundary.Click += this.btnSectionBoundary_Click;

            // --- Formatting group ---
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

            // --- Tools group ---
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

            // Assemble
            this.tabLaTeXSnipper.Groups.Add(this.groupFormula);
            this.tabLaTeXSnipper.Groups.Add(this.groupEdit);
            this.tabLaTeXSnipper.Groups.Add(this.groupConversion);
            this.tabLaTeXSnipper.Groups.Add(this.groupReference);
            this.tabLaTeXSnipper.Groups.Add(this.groupNumbering);
            this.tabLaTeXSnipper.Groups.Add(this.groupBoundary);
            this.tabLaTeXSnipper.Groups.Add(this.groupFormatting);
            this.tabLaTeXSnipper.Groups.Add(this.groupTools);

            this.Name = "FormulaRibbon";
            this.RibbonType = "Microsoft.Word.Document";
            this.Tabs.Add(this.tabLaTeXSnipper);
            this.ResumeLayout(false);
        }

        internal Microsoft.Office.Tools.Ribbon.RibbonTab tabLaTeXSnipper;
        internal Microsoft.Office.Tools.Ribbon.RibbonGroup groupFormula, groupEdit, groupConversion;
        internal Microsoft.Office.Tools.Ribbon.RibbonGroup groupReference, groupNumbering, groupBoundary;
        internal Microsoft.Office.Tools.Ribbon.RibbonGroup groupFormatting, groupTools;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnInsertInline, btnInsertDisplay, btnInsertNumbered, btnOcrSelector;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnLoadSelected, btnDeleteSelected;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnToOle, btnToOmml;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnInsertReference;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnAutoNumber, btnRenumber;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnChapterBoundary, btnSectionBoundary;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnFormatSelected, btnFormatAll;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnShowTaskPane, btnSettings, btnHelp;
    }

    partial class ThisRibbonCollection
    {
        internal FormulaRibbon FormulaRibbon { get { return this.GetRibbon<FormulaRibbon>(); } }
    }
}
