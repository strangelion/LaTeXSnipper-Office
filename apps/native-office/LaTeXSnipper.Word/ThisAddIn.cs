using System;
using Word = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word
{
    public partial class ThisAddIn
    {
        private Host.WordAdapter _adapter;

        internal Host.WordAdapter Adapter => _adapter;

        private void ThisAddIn_Startup(object sender, System.EventArgs e)
        {
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] ThisAddIn_Startup reached.");

            _adapter = new Host.WordAdapter(Application);
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] WordAdapter created.");
        }

        private void ThisAddIn_Shutdown(object sender, System.EventArgs e)
        {
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] ThisAddIn_Shutdown reached.");
        }

        #region VSTO 生成的代码

        /// <summary>
        /// 设计器支持所需的方法 - 不要修改
        /// 使用代码编辑器修改此方法的内容。
        /// </summary>
        private void InternalStartup()
        {
            this.Startup += new System.EventHandler(ThisAddIn_Startup);
            this.Shutdown += new System.EventHandler(ThisAddIn_Shutdown);
        }
        
        #endregion
    }
}
