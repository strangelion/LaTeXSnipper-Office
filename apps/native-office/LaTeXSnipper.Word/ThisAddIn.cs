using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using LaTeXSnipper.Word.Host;
using Word = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word
{
    [ComVisible(true)]
    public partial class ThisAddIn
    {
        private Host.WordAdapter _adapter;
        private Metadata.TableConverter _tableConverter;
        private PipeClient _pipeClient;
        private PipeReconnectCoordinator _pipeReconnect;
        private OfficeStaDispatcher? _staDispatcher;
        private WordRibbonExtensibility _ribbon;
        private string _sessionId;
        private volatile bool _pipeConnected;

        internal Host.WordAdapter Adapter => _adapter;
        internal bool PipeConnected => _pipeConnected;
        internal PipeClient PipeClient => _pipeClient;
        internal string SessionId => _sessionId;

        internal void Send(VstoMessage msg)
        {
            if (_pipeClient != null && _pipeConnected)
                _pipeClient.SendOnlyAsync(msg);
        }

        protected override Microsoft.Office.Core.IRibbonExtensibility CreateRibbonExtensibilityObject()
        {
            _ribbon = new WordRibbonExtensibility();
            return _ribbon;
        }

        private void ThisAddIn_Startup(object sender, System.EventArgs e)
        {
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] ThisAddIn_Startup reached.");

            _staDispatcher = new OfficeStaDispatcher("word");
            _sessionId = Guid.NewGuid().ToString("N").Substring(0, 12);

            System.Diagnostics.Debug.WriteLine(
                $"[LaTeXSnipper.Word] SID: {WindowsIdentityHelper.CurrentUserSid()}");
            System.Diagnostics.Debug.WriteLine(
                $"[LaTeXSnipper.Word] pipe leaf: {WindowsIdentityHelper.PipeLeafName}");

            _adapter = new Host.WordAdapter(Application);
            _tableConverter = new Metadata.TableConverter(Application);
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] WordAdapter created.");

            // Migrate: hide ContentControls created by older versions
            try
            {
                Host.WordAdapter.HideExistingFormulaContentControls(Application.ActiveDocument);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"[LaTeXSnipper.Word] ContentControl migration error: {ex.Message}");
            }

            // Subscribe to document change events for context tracking
            Application.DocumentChange += OnDocumentChange;

            _pipeReconnect = new PipeReconnectCoordinator(
                "word",
                ConnectPipeOnceAsync,
                OnPipeConnectionChanged);
            _pipeReconnect.Start();
        }

        private async Task<bool> ConnectPipeOnceAsync(Action disconnected, CancellationToken cancellationToken)
        {
            try
            {
                _pipeClient?.Dispose();
                _pipeClient = new PipeClient();
                _pipeClient.Disconnected += (_, __) => disconnected();
                if (!await _pipeClient.ConnectAsync(cancellationToken).ConfigureAwait(false))
                {
                    _pipeClient.Dispose();
                    _pipeClient = null;
                    return false;
                }

                _pipeClient.MessageReceived += OnMessageReceived;
                _ = _pipeClient.StartListeningAsync(cancellationToken);
                bool helloOk = await _pipeClient.SendHelloAsync(
                    _sessionId,
                    Handshake.GetOrCreateSecret(),
                    "word",
                    "1.0.0").ConfigureAwait(false);
                if (!helloOk)
                {
                    _pipeClient.Dispose();
                    _pipeClient = null;
                    return false;
                }

                PipeClient connectedClient = _pipeClient;
                _staDispatcher?.TryPost("send-host-ready", () =>
                {
                    if (!ReferenceEquals(_pipeClient, connectedClient)) return;
                    try
                    {
                        var contextId = _adapter.GetCurrentContextId();
                        var doc = Application.ActiveDocument;
                        _ = connectedClient.SendHostReadyAsync(
                            _sessionId, "word", "1.0.0",
                            new Capabilities
                            {
                                InsertFormula = true,
                                ReplaceFormula = true,
                                ReadSelection = true,
                                InsertTable = true,
                                ReadTable = true,
                                Features = new System.Collections.Generic.Dictionary<string, bool>
                                {
                                    ["read_formula_by_id"] = true,
                                    ["replace_result_revision"] = true,
                                },
                            },
                            contextId, doc?.Name);
                    }
                    catch (Exception ex)
                    {
                        OfficeOperationLog.Failure("send-host-ready", "word", null, ex);
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
                OfficeOperationLog.Failure("connect-pipe", "word", null, ex);
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
                    OfficeOperationLog.Failure("refresh-ribbon-connection", "word", null, ex);
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
                    try
                    {
                        HandleCommand(message);
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine(
                            $"[LaTeXSnipper.Word] Command handler error: {ex.Message}");
                    }
                });
            }
            else
            {
                System.Diagnostics.Debug.WriteLine(
                    "[LaTeXSnipper.Word] No dispatcher available - message dropped");
            }
        }

        private void HandleCommand(DesktopMessage message)
        {
            if (_adapter == null || _pipeClient == null) return;

            if (message is DesktopDocumentCommand docCmd && !string.IsNullOrEmpty(docCmd.ExpectedContextId))
            {
                var currentContext = _adapter.GetCurrentContextId();
                if (!string.IsNullOrEmpty(currentContext) &&
                    !StringComparer.Ordinal.Equals(docCmd.ExpectedContextId, currentContext))
                {
                    System.Diagnostics.Debug.WriteLine(
                        $"[LaTeXSnipper.Word] Context mismatch: expected={docCmd.ExpectedContextId}, current={currentContext}");
                    _pipeClient.SendOnlyAsync(new VstoHostError
                    {
                        RequestId = docCmd.RequestId,
                        SessionId = docCmd.SessionId,
                        ErrorCode = "CONTEXT_CHANGED",
                        Error = "Document context changed since command was issued"
                    });
                    return;
                }
            }

            switch (message)
            {
                case DesktopInsertFormula cmd:
                {
                    ResolveStorageMode(cmd);
                    var result = _adapter.InsertFormula(cmd.Formula, cmd.Mode);
                    _pipeClient.SendOnlyAsync(new VstoInsertResult
                    {
                        RequestId = cmd.RequestId,
                        SessionId = cmd.SessionId,
                        Success = result.Success,
                        FormulaId = result.FormulaId,
                        RequestedStorageMode = cmd.IntegrationMode ?? "auto",
                        ActualStorageMode = result.StorageMode,
                        FallbackReason = result.FallbackReason,
                        RangeStart = result.RangeStart,
                        RangeEnd = result.RangeEnd,
                        Error = result.Error,
                        ErrorCode = result.ErrorCode
                    });
                    break;
                }

                case DesktopImportConversation cmd:
                {
                    var result = new ConversationImporter(Application).Commit(cmd.Plan);
                    _pipeClient.SendOnlyAsync(new VstoConversationImportResult
                    {
                        RequestId = cmd.RequestId,
                        SessionId = cmd.SessionId,
                        ImportId = cmd.Plan.ImportId,
                        Success = result.Success,
                        ErrorCode = result.ErrorCode,
                        Error = result.Error
                    });
                    break;
                }

                case DesktopRequestReadSelection readCmd:
                {
                    var formula = _adapter.ReadSelection();
                    _pipeClient.SendOnlyAsync(new VstoReadSelection
                    {
                        RequestId = readCmd.RequestId,
                        SessionId = readCmd.SessionId,
                        Formula = formula,
                        RangeXml = formula?.Omml
                    });
                    break;
                }

                case DesktopRequestReadFormula readFormulaCmd:
                {
                    var formula = _adapter.ReadFormulaById(readFormulaCmd.FormulaId);
                    _pipeClient.SendOnlyAsync(new VstoFormulaSnapshot
                    {
                        RequestId = readFormulaCmd.RequestId,
                        SessionId = readFormulaCmd.SessionId,
                        Formula = formula,
                        ErrorCode = formula == null ? "FORMULA_NOT_FOUND" : null,
                        Error = formula == null ? "Formula was not found in the active document" : null
                    });
                    break;
                }

                case DesktopDeleteCurrent delCmd:
                {
                    InsertResult result;
                    var formulaId = delCmd.FormulaId;
                    if (!string.IsNullOrEmpty(formulaId))
                        result = _adapter.DeleteFormula(formulaId);
                    else
                        result = _adapter.DeleteCurrent();
                    if (result.Success && !string.IsNullOrEmpty(formulaId))
                    {
                        try
                        {
                            var doc = Application.ActiveDocument;
                            if (doc != null)
                                FormulaDocumentManifest.Remove(doc, formulaId);
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"[LaTeXSnipper.Word] Manifest cleanup error: {ex.Message}");
                        }
                    }
                    _pipeClient.SendOnlyAsync(new VstoDeleteResult
                    {
                        RequestId = delCmd.RequestId, SessionId = delCmd.SessionId,
                        Success = result.Success, Error = result.Error
                    });
                    break;
                }

                case DesktopReplaceFormula repCmd:
                {
                    var result = _adapter.ReplaceFormula(repCmd.FormulaId, repCmd.Formula);
                    _pipeClient.SendOnlyAsync(new VstoReplaceResult
                    {
                        RequestId = repCmd.RequestId, SessionId = repCmd.SessionId,
                        Success = result.Success,
                        FormulaId = result.FormulaId,
                        Revision = result.Revision,
                        ActualStorageMode = result.StorageMode,
                        ErrorCode = result.ErrorCode,
                        Error = result.Error
                    });
                    break;
                }

                case DesktopPing:
                    System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Word] Ping received");
                    break;

                case DesktopInsertTable insertTable:
                {
                    try
                    {
                        var ok = _tableConverter.InsertTable(insertTable.Table);
                        _pipeClient.SendOnlyAsync(new VstoInsertTableResult
                        {
                            RequestId = insertTable.RequestId,
                            SessionId = insertTable.SessionId,
                            Success = ok,
                            TableId = insertTable.Table.TableId,
                        });
                    }
                    catch (Exception ex)
                    {
                        _pipeClient.SendOnlyAsync(new VstoInsertTableResult
                        {
                            RequestId = insertTable.RequestId,
                            SessionId = insertTable.SessionId,
                            Success = false,
                            Error = ex.Message
                        });
                    }
                    break;
                }

                case DesktopRequestReadTable readTableCmd:
                {
                    var table = _tableConverter.ReadSelection();
                    _pipeClient.SendOnlyAsync(new VstoReadTable
                    {
                        RequestId = readTableCmd.RequestId,
                        SessionId = readTableCmd.SessionId,
                        Table = table
                    });
                    break;
                }

                case DesktopConvertFormula convertCmd:
                {
                    var result = _adapter.ConvertFormula(convertCmd.FormulaId, convertCmd.TargetMode);
                    _pipeClient.SendOnlyAsync(new VstoConvertResult
                    {
                        RequestId = convertCmd.RequestId,
                        SessionId = convertCmd.SessionId,
                        Success = result.Success,
                        NewFormulaId = result.FormulaId,
                        NewStorageMode = result.StorageMode,
                        Error = result.Error
                    });
                    break;
                }
                case DesktopScanLatex scanCmd:
                {
                    var scanner = new WordBatchLatexScanner(Application);
                    var candidates = scanner.Scan(scanCmd.Scope);
                    // Populate locators with Word story-based positions
                    // (simplified: using Range.Start/End for body text)
                    _pipeClient.SendOnlyAsync(new VstoScanLatexResult
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
                    var executor = new WordBatchConversionExecutor(Application);
                    var items = System.Text.Json.JsonSerializer
                        .Deserialize<List<BatchConversionItem>>(
                            batchCmd.Plan.GetRawText(),
                            new System.Text.Json.JsonSerializerOptions
                            { PropertyNameCaseInsensitive = true });
                    var result = executor.Execute(batchCmd.PlanId, items ?? new List<BatchConversionItem>());
                    _pipeClient.SendOnlyAsync(result);
                    break;
                }
                default:
                {
                    var unknown = message as DesktopMessage;
                    System.Diagnostics.Debug.WriteLine(
                        $"[LaTeXSnipper.Word] Unhandled DesktopMessage type: {unknown?.GetType().Name}");
                    _pipeClient.SendOnlyAsync(new VstoHostError
                    {
                        RequestId = unknown?.RequestId ?? "",
                        SessionId = unknown?.SessionId ?? _sessionId ?? "",
                        ErrorCode = "NOT_IMPLEMENTED",
                        Error = $"Command {unknown?.GetType().Name} is not implemented for Word"
                    });
                    break;
                }
            }
        }

        private void OnDocumentChange()
        {
            if (_pipeClient == null || _sessionId == null) return;

            try
            {
                var contextId = _adapter?.GetCurrentContextId();
                var doc = Application.ActiveDocument;
                if (string.IsNullOrEmpty(contextId)) return;

                System.Diagnostics.Debug.WriteLine(
                    $"[LaTeXSnipper.Word] Document changed: {contextId}");

                _pipeClient.SendOnlyAsync(new VstoContextChanged
                {
                    RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
                    SessionId = _sessionId,
                    DocumentContextId = contextId,
                    DocumentTitle = doc?.Name
                });
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"[LaTeXSnipper.Word] OnDocumentChange error: {ex.Message}");
            }
        }

        private void ThisAddIn_Shutdown(object sender, System.EventArgs e)
        {
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] ThisAddIn_Shutdown reached.");

            Application.DocumentChange -= OnDocumentChange;
            _pipeReconnect?.Dispose();
            _pipeClient?.Disconnect();
            _staDispatcher?.Dispose();
            _pipeConnected = false;
        }

        private static void ResolveStorageMode(DesktopInsertFormula cmd)
        {
            var im = cmd.IntegrationMode;
            if (string.IsNullOrEmpty(im) || im == "auto")
                return;
            cmd.Formula.StorageMode = im switch
            {
                "ole" => "ole",
                "image" => "image",
                "native" => "native-omml",
                _ => null,
            };
        }

        #region VSTO 生成的代码

        private void InternalStartup()
        {
            this.Startup += new System.EventHandler(ThisAddIn_Startup);
            this.Shutdown += new System.EventHandler(ThisAddIn_Shutdown);
        }
        
        #endregion
    }
}
