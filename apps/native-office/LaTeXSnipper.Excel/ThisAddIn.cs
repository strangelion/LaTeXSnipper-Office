#nullable enable
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.Excel
{
    [ComVisible(true)]
    public partial class ThisAddIn
    {
        private Host.ExcelAdapter _adapter;
        private PipeClient _pipeClient;
        private SynchronizationContext _syncContext;
        private System.Windows.Forms.Control? _uiDispatcher;
        private int _uiThreadId;
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
            _uiThreadId = Thread.CurrentThread.ManagedThreadId;
            _uiDispatcher = new System.Windows.Forms.Control();
            _uiDispatcher.CreateControl();
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
            catch (Exception ex) { OfficeOperationLog.Failure("startup-dispatch", "excel", null, ex); }
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
                        _uiDispatcher.BeginInvoke(new Action(() =>
                        {
                            if (Thread.CurrentThread.ManagedThreadId != _uiThreadId)
                            {
                                System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] FATAL: HOST_READY not on UI thread");
                                return;
                            }
                            try
                            {
                                var ctx = _adapter.GetCurrentContextId();
                                _ = _pipeClient.SendHostReadyAsync(_sessionId, "excel", Application.Version,
                                    new Capabilities
                                    {
                                        InsertFormula = true,
                                        ReplaceFormula = true,
                                        ReadSelection = true,
                                        InsertTable = false,
                                        ReadTable = false,
                                    },
                                    ctx);
                            }
                            catch (Exception ex)
                            {
                                System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] HOST_READY error: " + ex.Message);
                            }
                        }));
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
            if (_uiDispatcher != null && !_uiDispatcher.IsDisposed)
            {
                _uiDispatcher.BeginInvoke(new Action(() =>
                {
                    if (Thread.CurrentThread.ManagedThreadId != _uiThreadId)
                    {
                        System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] FATAL: Command not on UI thread");
                        return;
                    }
                    try { HandleCommand(message); }
                    catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] Handler error: " + ex.Message); }
                }));
            }
            else
            {
                System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] No dispatcher available - message dropped");
            }
        }

        private void HandleCommand(DesktopMessage message)
        {
            if (_adapter == null || _pipeClient == null) return;

            // Context validation for document-scoped commands
            if (message is DesktopDocumentCommand docCmd &&
                !NativeOfficeProtocol.EnsureExpectedContext(docCmd, _adapter.GetCurrentContextId(), _pipeClient))
                return;

            switch (message)
            {
                case DesktopInsertFormula cmd:
                {
                    ResolveStorageMode(cmd);
                    var result = _adapter.InsertFormula(cmd.Formula, cmd.Mode);
                    if (result.Success && !string.IsNullOrEmpty(result.FormulaId))
                    {
                        try
                        {
                            var wb = Application.ActiveWorkbook;
                            if (wb != null)
                                FormulaDocumentManifest.WriteEntry(wb.CustomXMLParts, cmd.Formula, "excel");
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"[LaTeXSnipper.Excel] Manifest write error: {ex.Message}");
                        }
                    }
                    _ = _pipeClient.SendAsync(new VstoInsertResult
                    {
                        RequestId = cmd.RequestId, SessionId = cmd.SessionId,
                        Success = result.Success, FormulaId = result.FormulaId,
                        RequestedStorageMode = cmd.IntegrationMode ?? "auto",
                        ActualStorageMode = result.ActualStorageMode,
                        FallbackReason = result.FallbackReason,
                        Error = result.Error,
                        ErrorCode = result.ErrorCode
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
                    var formulaId = delCmd.FormulaId;

                    // If no formulaId provided, try to extract from selection
                    if (string.IsNullOrEmpty(formulaId))
                        formulaId = ExtractFormulaIdFromSelection();

                    var ok = false;
                    if (!string.IsNullOrEmpty(formulaId))
                        ok = _adapter.DeleteFormula(formulaId);
                    else
                        ok = _adapter.DeleteCurrent();

                    if (ok && !string.IsNullOrEmpty(formulaId))
                    {
                        try
                        {
                            var wb = Application.ActiveWorkbook;
                            if (wb != null)
                                FormulaDocumentManifest.RemoveEntry(wb.CustomXMLParts, formulaId);
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"[LaTeXSnipper.Excel] Manifest cleanup error: {ex.Message}");
                        }
                    }
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
                        Success = ok,
                        ActualStorageMode = repCmd.Formula.StorageMode ?? "auto"
                    });
                    break;
                }
                case DesktopPing:
                    break;
                default:
                {
                    var unknown = message as DesktopMessage;
                    System.Diagnostics.Debug.WriteLine(
                        $"[LaTeXSnipper.Excel] Unhandled DesktopMessage type: {unknown?.GetType().Name}");
                    _pipeClient?.SendOnlyAsync(new VstoHostError
                    {
                        RequestId = unknown?.RequestId ?? "",
                        SessionId = unknown?.SessionId ?? _sessionId ?? "",
                        ErrorCode = "NOT_IMPLEMENTED",
                        Error = $"Command {unknown?.GetType().Name} is not implemented for Excel"
                    });
                    break;
                }
            }
        }

        private void ThisAddIn_Shutdown(object sender, System.EventArgs e)
        {
            _pipeClient?.Disconnect();
        }

        /// <summary>
        /// Extract formulaId from the currently selected LSNO_ shape.
        /// </summary>
        private string? ExtractFormulaIdFromSelection()
        {
            try
            {
                var sel = Application.Selection;
                if (sel is Microsoft.Office.Interop.Excel.ShapeRange shapeRange && shapeRange.Count > 0)
                {
                    var shape = shapeRange.Item(1);
                    var name = shape.Name as string;
                    if (!string.IsNullOrEmpty(name) && name.StartsWith("LSNO_") && name.Length > 5)
                        return name.Substring(5);
                }
            }
            catch (Exception ex) { OfficeOperationLog.Failure("read-selected-formula-id", "excel", null, ex); }
            return null;
        }

        private static void ResolveStorageMode(DesktopInsertFormula cmd)
        {
            var im = cmd.IntegrationMode;
            if (string.IsNullOrEmpty(im) || im == "auto")
                return; // leave StorageMode as-is for adapter auto-detection
            cmd.Formula.StorageMode = im switch
            {
                "ole" => "ole",
                "image" => "image",
                "native" => "native-omml",
                _ => null,
            };
        }

        private void InternalStartup()
        {
            this.Startup += new System.EventHandler(ThisAddIn_Startup);
            this.Shutdown += new System.EventHandler(ThisAddIn_Shutdown);
        }
    }
}
