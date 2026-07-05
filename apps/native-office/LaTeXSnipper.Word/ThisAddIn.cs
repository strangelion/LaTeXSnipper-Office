using System;
using System.Threading;
using System.Threading.Tasks;
using LaTeXSnipper.NativeOffice.Shared;
using Word = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word
{
    public partial class ThisAddIn
    {
        private Host.WordAdapter _adapter;
        private PipeClient _pipeClient;
        private SynchronizationContext _syncContext;
        private string _sessionId;
        private bool _pipeConnected;

        internal Host.WordAdapter Adapter => _adapter;
        internal bool PipeConnected => _pipeConnected;

        private void ThisAddIn_Startup(object sender, System.EventArgs e)
        {
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] ThisAddIn_Startup reached.");

            _syncContext = SynchronizationContext.Current;
            _sessionId = Guid.NewGuid().ToString("N").Substring(0, 12);

            System.Diagnostics.Debug.WriteLine(
                $"[LaTeXSnipper.Word] SID: {WindowsIdentityHelper.CurrentUserSid()}");
            System.Diagnostics.Debug.WriteLine(
                $"[LaTeXSnipper.Word] pipe leaf: {WindowsIdentityHelper.PipeLeafName}");

            _adapter = new Host.WordAdapter(Application);
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] WordAdapter created.");

            // Start Pipe connection in background
            _ = InitializePipeAsync();
        }

        private async Task InitializePipeAsync()
        {
            try
            {
                _pipeClient = new PipeClient();
                System.Diagnostics.Debug.WriteLine(
                    "[LaTeXSnipper.Word] PipeClient created.");

                var connected = await _pipeClient.ConnectAsync();
                if (!connected)
                {
                    System.Diagnostics.Debug.WriteLine(
                        "[LaTeXSnipper.Word] Pipe connect failed (Desktop not running?)");
                    return;
                }
                System.Diagnostics.Debug.WriteLine(
                    "[LaTeXSnipper.Word] Pipe connected.");

                // Start reader loop before sending HELLO
                _ = _pipeClient.StartListeningAsync(CancellationToken.None);
                System.Diagnostics.Debug.WriteLine(
                    "[LaTeXSnipper.Word] Pipe reader loop started.");

                // Send HELLO
                var dpapiSecret = Handshake.GetOrCreateSecret();
                var helloOk = await _pipeClient.SendHelloAsync(
                    _sessionId, dpapiSecret, "word", "1.0.0");

                if (!helloOk)
                {
                    System.Diagnostics.Debug.WriteLine(
                        "[LaTeXSnipper.Word] HELLO handshake failed.");
                    return;
                }
                System.Diagnostics.Debug.WriteLine(
                    "[LaTeXSnipper.Word] HELLO_ACK received.");

                _pipeConnected = true;

                // Send HOST_READY on UI thread
                if (_syncContext != null)
                {
                    _syncContext.Post(_ =>
                    {
                        var contextId = _adapter.GetCurrentContextId();
                        System.Diagnostics.Debug.WriteLine(
                            $"[LaTeXSnipper.Word] context ID: {contextId}");

                        _ = _pipeClient.SendHostReadyAsync(
                            _sessionId, "word", "1.0.0", contextId);

                        System.Diagnostics.Debug.WriteLine(
                            "[LaTeXSnipper.Word] HOST_READY sent.");
                    }, null);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"[LaTeXSnipper.Word] Pipe init failed: {ex.Message}");
                _pipeConnected = false;
            }
        }

        private void ThisAddIn_Shutdown(object sender, System.EventArgs e)
        {
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] ThisAddIn_Shutdown reached.");

            _pipeClient?.Disconnect();
            _pipeConnected = false;
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
