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
            this.tabLaTeXSnipper = this.Factory.CreateRibbonTab();
            this.tabLaTeXSnipper.ControlId.ControlIdType = Microsoft.Office.Tools.Ribbon.RibbonControlIdType.Custom;
            this.tabLaTeXSnipper.Label = "LaTeXSnipper";
            this.tabLaTeXSnipper.Name = "tabLaTeXSnipper";

            this.groupFormula = this.Factory.CreateRibbonGroup();
            this.btnInsertInline = MakeButton("Insert Inline", "btnInsertInline", "EquationProfessional");
            this.btnInsertInline.Click += this.btnInsertInline_Click;
            this.btnInsertDisplay = MakeButton("Insert Display", "btnInsertDisplay", "EquationInsertGallery");
            this.btnInsertDisplay.Click += this.btnInsertDisplay_Click;
            this.btnInsertNumbered = MakeButton("Insert Numbered", "btnInsertNumbered", "Numbering");
            this.btnInsertNumbered.Click += this.btnInsertNumbered_Click;
            this.btnOcrSelector = MakeButton("Screenshot OCR", "btnOcrSelector", "ScreenshotInsertGallery");
            this.btnOcrSelector.Click += this.btnOcrSelector_Click;
            this.groupFormula.Items.Add(this.btnInsertInline);
            this.groupFormula.Items.Add(this.btnInsertDisplay);
            this.groupFormula.Items.Add(this.btnInsertNumbered);
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
            this.btnToOmml = MakeButton("To OMML", "btnToOmml", "ConvertTextToTable");
            this.btnToOmml.Click += this.btnToOmml_Click;

            this.groupReference = this.Factory.CreateRibbonGroup();
            this.btnInsertReference = MakeButton("Insert Reference", "btnInsertReference", "CrossReferenceInsert");
            this.btnInsertReference.Click += this.btnInsertReference_Click;

            this.groupNumbering = this.Factory.CreateRibbonGroup();
            this.btnAutoNumber = MakeButton("Auto Number", "btnAutoNumber", "NumberingRestart");
            this.btnAutoNumber.Click += this.btnAutoNumber_Click;
            this.btnRenumber = MakeButton("Renumber", "btnRenumber", "RecurrenceEdit");
            this.btnRenumber.Click += this.btnRenumber_Click;

            this.groupBoundary = this.Factory.CreateRibbonGroup();
            this.btnChapterBoundary = MakeButton("Chapter", "btnChapterBoundary", "BookmarkInsert");
            this.btnChapterBoundary.Click += this.btnChapterBoundary_Click;
            this.btnSectionBoundary = MakeButton("Section", "btnSectionBoundary", "BreaksGallery");
            this.btnSectionBoundary.Click += this.btnSectionBoundary_Click;

            this.groupFormatting = this.Factory.CreateRibbonGroup();
            this.btnFormatSelected = MakeButton("Format Selected", "btnFormatSelected", "FormatPainter");
            this.btnFormatSelected.Click += this.btnFormatSelected_Click;
            this.btnFormatAll = MakeButton("Format All", "btnFormatAll", "FontDialog");
            this.btnFormatAll.Click += this.btnFormatAll_Click;

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

        private Microsoft.Office.Tools.Ribbon.RibbonButton MakeButton(string label, string name, string imageId)
        {
            var btn = this.Factory.CreateRibbonButton();
            btn.Label = label;
            btn.Name = name;
            btn.OfficeImageId = imageId;
            btn.ShowImage = true;
            return btn;
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
