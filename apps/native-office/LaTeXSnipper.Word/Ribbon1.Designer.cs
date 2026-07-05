namespace LaTeXSnipper.Word
{
    partial class Ribbon1 : Microsoft.Office.Tools.Ribbon.RibbonBase
    {
        /// <summary>
        /// 必需的设计器变量。
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        public Ribbon1()
            : base(Globals.Factory.GetRibbonFactory())
        {
            InitializeComponent();
        }

        /// <summary> 
        /// 清理所有正在使用的资源。
        /// </summary>
        /// <param name="disposing">如果应释放托管资源，为 true；否则为 false。</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region 组件设计器生成的代码

        /// <summary>
        /// 设计器支持所需的方法 - 不要修改
        /// 使用代码编辑器修改此方法的内容。
        /// </summary>
        private void InitializeComponent()
        {
            this.tabLaTeXSnipper = this.Factory.CreateRibbonTab();
            this.groupDevelopment = this.Factory.CreateRibbonGroup();
            this.btnSmokeTest = this.Factory.CreateRibbonButton();
            this.tabLaTeXSnipper.SuspendLayout();
            this.groupDevelopment.SuspendLayout();
            this.SuspendLayout();
            //
            // tabLaTeXSnipper
            //
            this.tabLaTeXSnipper.ControlId.ControlIdType = Microsoft.Office.Tools.Ribbon.RibbonControlIdType.Custom;
            this.tabLaTeXSnipper.Groups.Add(this.groupDevelopment);
            this.tabLaTeXSnipper.Label = "LaTeXSnipper";
            this.tabLaTeXSnipper.Name = "tabLaTeXSnipper";
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
            // Ribbon1
            //
            this.Name = "Ribbon1";
            this.RibbonType = "Microsoft.Word.Document";
            this.Tabs.Add(this.tabLaTeXSnipper);
            this.Load += new Microsoft.Office.Tools.Ribbon.RibbonUIEventHandler(this.Ribbon1_Load);
            this.tabLaTeXSnipper.ResumeLayout(false);
            this.tabLaTeXSnipper.PerformLayout();
            this.groupDevelopment.ResumeLayout(false);
            this.groupDevelopment.PerformLayout();
            this.ResumeLayout(false);
        }

        #endregion

        internal Microsoft.Office.Tools.Ribbon.RibbonTab tabLaTeXSnipper;
        internal Microsoft.Office.Tools.Ribbon.RibbonGroup groupDevelopment;
        internal Microsoft.Office.Tools.Ribbon.RibbonButton btnSmokeTest;
    }

    partial class ThisRibbonCollection
    {
        internal Ribbon1 Ribbon1
        {
            get { return this.GetRibbon<Ribbon1>(); }
        }
    }
}
