using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Excel
{
    [ComVisible(true)]
    public partial class ThisAddIn
    {
        private Host.ExcelAdapter _adapter;
        private PipeClient _pipeClient;
        private SynchronizationContext _syncContext;
        private string _sessionId;
        private bool _pipeConnected;

        internal Host.ExcelAdapter Adapter => _adapter;
        internal bool PipeConnected => _pipeConnected;
        internal PipeClient PipeClient => _pipeClient;
        internal string SessionId => _sessionId;

        internal void Send(VstoMessage msg)
        {
            if (_pipeClient != null && _pipeConnected)
                _ = _pipeClient.SendAsync(msg);
        }

        protected override Microsoft.Office.Core.IRibbonExtensibility CreateRibbonExtensibilityObject()
        {
            return new ExcelRibbonExtensibility();
        }

        private void ThisAddIn_Startup(object sender, System.EventArgs e)
        {
            System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] Startup reached.");
            _syncContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            _sessionId = Guid.NewGuid().ToString("N").Substring(0, 12);
            _adapter = new Host.ExcelAdapter(Application);
            _ = InitializePipeAsync();

            // Track workbook/sheet changes
            Application.WorkbookActivate += OnWorkbookChange;
            Application.SheetActivate += OnWorkbookChange;
        }

        private void OnWorkbookChange(object workbook)
        {
            if (_pipeClient == null || _sessionId == null || _adapter == null) return;
            try
            {
                var ctx = _adapter.GetCurrentContextId();
                var wb = Application.ActiveWorkbook;
                _ = _pipeClient.SendAsync(new VstoContextChanged
                {
                    RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
                    SessionId = _sessionId,
                    DocumentContextId = ctx,
                    DocumentTitle = wb?.Name
                });
            }
            catch { }
        }

        private async Task InitializePipeAsync()
        {
            for (int attempt = 1; attempt <= 60; attempt++)
            {
                try
                {
                    if (_pipeClient != null) { _pipeClient.Dispose(); _pipeClient = null; }
                    _pipeClient = new PipeClient();
                    if (!await _pipeClient.ConnectAsync())
                    {
                        if (attempt == 1) System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] Waiting for Desktop...");
                        await Task.Delay(3000);
                        continue;
                    }
                    System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] Pipe connected.");
                    _pipeClient.MessageReceived += OnMessageReceived;
                    _ = _pipeClient.StartListeningAsync(CancellationToken.None);
                    var secret = Handshake.GetOrCreateSecret();
                    if (await _pipeClient.SendHelloAsync(_sessionId, secret, "excel", Application.Version))
                    {
                        _pipeConnected = true;
                        _syncContext.Post(_ =>
                        {
                            try
                            {
                                var ctx = _adapter.GetCurrentContextId();
                                _ = _pipeClient.SendHostReadyAsync(_sessionId, "excel", Application.Version, ctx);
                            }
                            catch (Exception ex)
                            {
                                System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] HOST_READY error: " + ex.Message);
                            }
                        }, null);
                        return;
                    }
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] Init " + attempt + ": " + ex.Message);
                }
                await Task.Delay(3000);
            }
        }

        private void OnMessageReceived(object sender, DesktopMessage message)
        {
            if (_adapter == null) return;
            _syncContext?.Post(_ =>
            {
                try { HandleCommand(message); }
                catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] Handler error: " + ex.Message); }
            }, null);
        }

        private void HandleCommand(DesktopMessage message)
        {
            if (_adapter == null || _pipeClient == null) return;
            switch (message)
            {
                case DesktopInsertFormula cmd:
                {
                    var result = _adapter.InsertFormula(cmd.Formula, cmd.Mode);
                    _ = _pipeClient.SendAsync(new VstoInsertResult
                    {
                        RequestId = cmd.RequestId, SessionId = cmd.SessionId,
                        Success = result.Success, FormulaId = result.FormulaId, Error = result.Error
                    });
                    break;
                }
                case DesktopRequestReadSelection readCmd:
                {
                    var formula = _adapter.ReadSelection();
                    _ = _pipeClient.SendAsync(new VstoReadSelection
                    {
                        RequestId = readCmd.RequestId, SessionId = readCmd.SessionId,
                        Formula = formula, RangeXml = formula?.Omml
                    });
                    break;
                }
                case DesktopDeleteCurrent delCmd:
                {
                    var ok = _adapter.DeleteCurrent();
                    _ = _pipeClient.SendAsync(new VstoDeleteResult
                    {
                        RequestId = delCmd.RequestId, SessionId = delCmd.SessionId,
                        Success = ok
                    });
                    break;
                }
                case DesktopReplaceFormula repCmd:
                {
                    var ok = _adapter.ReplaceFormula(repCmd.FormulaId, repCmd.Formula);
                    _ = _pipeClient.SendAsync(new VstoReplaceResult
                    {
                        RequestId = repCmd.RequestId, SessionId = repCmd.SessionId,
                        Success = ok
                    });
                    break;
                }
                case DesktopPing:
                    break;
            }
        }

        private void ThisAddIn_Shutdown(object sender, System.EventArgs e)
        {
            _pipeClient?.Disconnect();
        }

        private void InternalStartup()
        {
            this.Startup += new System.EventHandler(ThisAddIn_Startup);
            this.Shutdown += new System.EventHandler(ThisAddIn_Shutdown);
        }
    }
}
