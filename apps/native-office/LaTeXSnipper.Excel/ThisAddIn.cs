#nullable enable
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.Excel
{
    [ComVisible(true)]
    public partial class ThisAddIn
    {
        private Host.ExcelAdapter _adapter;
        private PipeClient? _pipeClient;
        private PipeReconnectCoordinator? _pipeReconnect;
        private OfficeStaDispatcher? _staDispatcher;
        private ExcelRibbonExtensibility? _ribbon;
        private string _sessionId;
        private string _hostVersion = "";
        private volatile bool _pipeConnected;

        internal Host.ExcelAdapter Adapter => _adapter;
        internal bool PipeConnected => _pipeConnected;
        internal string SessionId => _sessionId;

        internal void Send(VstoMessage msg)
        {
            if (_pipeClient != null && _pipeConnected)
                _ = _pipeClient.SendAsync(msg);
        }

        protected override Microsoft.Office.Core.IRibbonExtensibility CreateRibbonExtensibilityObject()
        {
            _ribbon = new ExcelRibbonExtensibility();
            return _ribbon;
        }

        private void ThisAddIn_Startup(object sender, System.EventArgs e)
        {
            System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] Startup reached.");
            _staDispatcher = new OfficeStaDispatcher("excel");
            _sessionId = Guid.NewGuid().ToString("N").Substring(0, 12);
            _hostVersion = Application.Version ?? "";
            _adapter = new Host.ExcelAdapter(Application);
            _pipeReconnect = new PipeReconnectCoordinator(
                "excel",
                ConnectPipeOnceAsync,
                OnPipeConnectionChanged);
            _pipeReconnect.Start();

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

        private async Task<bool> ConnectPipeOnceAsync(Action disconnected, CancellationToken cancellationToken)
        {
            try
            {
                _pipeClient?.Dispose();
                var candidate = new PipeClient();
                _pipeClient = candidate;
                candidate.Disconnected += (_, __) => disconnected();
                if (!await candidate.ConnectAsync(cancellationToken).ConfigureAwait(false))
                {
                    candidate.Dispose();
                    _pipeClient = null;
                    return false;
                }

                candidate.MessageReceived += OnMessageReceived;
                _ = candidate.StartListeningAsync(cancellationToken);
                bool helloOk = await candidate.SendHelloAsync(
                    _sessionId,
                    Handshake.GetOrCreateSecret(),
                    "excel",
                    _hostVersion).ConfigureAwait(false);
                if (!helloOk)
                {
                    candidate.Dispose();
                    _pipeClient = null;
                    return false;
                }

                PipeClient connectedClient = candidate;
                _staDispatcher?.TryPost("send-host-ready", () =>
                {
                    if (!ReferenceEquals(_pipeClient, connectedClient)) return;
                    try
                    {
                        var ctx = _adapter.GetCurrentContextId();
                        _ = connectedClient.SendHostReadyAsync(
                            _sessionId,
                            "excel",
                            _hostVersion,
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
                        OfficeOperationLog.Failure("send-host-ready", "excel", null, ex);
                    }
                });
                return true;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return false;
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("connect-pipe", "excel", null, ex);
                _pipeClient?.Dispose();
                _pipeClient = null;
                return false;
            }
        }

        private void OnPipeConnectionChanged(bool connected)
        {
            _pipeConnected = connected;
            _staDispatcher?.TryPost("refresh-ribbon-connection", () =>
            {
                try
                {
                    _ribbon?.NotifyConnectionChanged();
                }
                catch (Exception ex)
                {
                    OfficeOperationLog.Failure("refresh-ribbon-connection", "excel", null, ex);
                }
            });
        }

        private void OnMessageReceived(object sender, DesktopMessage message)
        {
            if (_adapter == null) return;
            if (_staDispatcher != null && _staDispatcher.IsAvailable)
            {
                _staDispatcher.TryPost("handle-pipe-command", () =>
                {
                    try { HandleCommand(message); }
                    catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Excel] Handler error: " + ex.Message); }
                });
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
                case DesktopScanLatex scanCmd:
                {
                    var scanner = new ExcelBatchLatexScanner(Application);
                    var candidates = scanner.Scan(scanCmd.Scope);
                    _pipeClient?.SendOnlyAsync(new VstoScanLatexResult
                    {
                        RequestId = scanCmd.RequestId,
                        SessionId = scanCmd.SessionId,
                        Scope = scanCmd.Scope,
                        Candidates = candidates
                    });
                    break;
                }
                case DesktopBatchConvert batchCmd:
                {
                    var executor = new ExcelBatchConversionExecutor(Application);
                    var items = batchCmd.Plan?.Items ?? new List<BatchConversionItem>();
                    var result = executor.Execute(batchCmd.PlanId, items);
                    _pipeClient?.SendOnlyAsync(result);
                    break;
                }
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
            Application.WorkbookActivate -= OnWorkbookChange;
            Application.SheetActivate -= OnWorkbookChange;

            _pipeReconnect?.Dispose();
            _pipeClient?.Disconnect();
            _staDispatcher?.Dispose();
            _pipeConnected = false;
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
