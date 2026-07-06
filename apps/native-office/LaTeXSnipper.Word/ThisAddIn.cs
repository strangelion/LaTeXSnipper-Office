using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;
using Word = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word
{
    [ComVisible(true)]
    public partial class ThisAddIn
    {
        private Host.WordAdapter _adapter;
        private Metadata.TableConverter _tableConverter;
        private PipeClient _pipeClient;
        private SynchronizationContext _syncContext;
        private string _sessionId;
        private bool _pipeConnected;

        internal Host.WordAdapter Adapter => _adapter;
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
            return new WordRibbonExtensibility();
        }

        private void ThisAddIn_Startup(object sender, System.EventArgs e)
        {
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] ThisAddIn_Startup reached.");

            _syncContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            _sessionId = Guid.NewGuid().ToString("N").Substring(0, 12);

            System.Diagnostics.Debug.WriteLine(
                $"[LaTeXSnipper.Word] SID: {WindowsIdentityHelper.CurrentUserSid()}");
            System.Diagnostics.Debug.WriteLine(
                $"[LaTeXSnipper.Word] pipe leaf: {WindowsIdentityHelper.PipeLeafName}");

            _adapter = new Host.WordAdapter(Application);
            _tableConverter = new Metadata.TableConverter(Application);
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] WordAdapter created.");

            // Subscribe to document change events for context tracking
            Application.DocumentChange += OnDocumentChange;

            _ = InitializePipeAsync();
        }

        private async Task InitializePipeAsync()
        {
            int retryDelay = 3000;
            int maxRetries = 60;
            for (int attempt = 1; attempt <= maxRetries; attempt++)
            {
                try
                {
                    if (_pipeClient != null)
                    {
                        _pipeClient.Dispose();
                        _pipeClient = null;
                    }

                    _pipeClient = new PipeClient();

                    var connected = await _pipeClient.ConnectAsync();
                    if (!connected)
                    {
                        if (attempt == 1)
                            System.Diagnostics.Debug.WriteLine(
                                "[LaTeXSnipper.Word] Pipe connect failed (Desktop not running?). Retrying...");
                        await Task.Delay(retryDelay);
                        continue;
                    }

                    System.Diagnostics.Debug.WriteLine(
                        "[LaTeXSnipper.Word] Pipe connected.");

                    _pipeClient.MessageReceived += OnMessageReceived;

                    _ = _pipeClient.StartListeningAsync(CancellationToken.None);
                    System.Diagnostics.Debug.WriteLine(
                        "[LaTeXSnipper.Word] Pipe reader loop started.");

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

                    if (_syncContext != null)
                    {
                        _syncContext.Post(_ =>
                        {
                            try
                            {
                                var contextId = _adapter.GetCurrentContextId();
                                var doc = Application.ActiveDocument;
                                System.Diagnostics.Debug.WriteLine(
                                    $"[LaTeXSnipper.Word] Sending HOST_READY...");

                                _ = _pipeClient.SendHostReadyAsync(
                                    _sessionId, "word", "1.0.0", contextId, doc?.Name);

                                System.Diagnostics.Debug.WriteLine(
                                    "[LaTeXSnipper.Word] HOST_READY sent.");
                            }
                            catch (Exception ex)
                            {
                                System.Diagnostics.Debug.WriteLine(
                                    $"[LaTeXSnipper.Word] HOST_READY error: {ex.Message}");
                            }
                        }, null);
                    }

                    System.Diagnostics.Debug.WriteLine(
                        "[LaTeXSnipper.Word] Pipe initialization complete.");
                    return; // Success - exit the retry loop
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine(
                        $"[LaTeXSnipper.Word] Pipe init attempt {attempt} failed: {ex.Message}");
                    _pipeConnected = false;
                    await Task.Delay(retryDelay);
                }
            }
            System.Diagnostics.Debug.WriteLine(
                "[LaTeXSnipper.Word] Pipe init failed after all retries.");
        }

        private void OnMessageReceived(object sender, DesktopMessage message)
        {
            if (_adapter == null) return;

            if (_syncContext != null)
            {
                _syncContext.Post(_ =>
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
                }, null);
            }
            else
            {
                System.Diagnostics.Debug.WriteLine(
                    "[LaTeXSnipper.Word] No sync context - message dropped");
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
                    _ = _pipeClient.SendAsync(new VstoHostError
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
                    var result = _adapter.InsertFormula(cmd.Formula, cmd.Mode);
                    _ = _pipeClient.SendAsync(new VstoInsertResult
                    {
                        RequestId = cmd.RequestId,
                        SessionId = cmd.SessionId,
                        Success = result.Success,
                        FormulaId = result.FormulaId,
                        RangeStart = result.RangeStart,
                        RangeEnd = result.RangeEnd,
                        Error = result.Error
                    });
                    break;
                }

                case DesktopRequestReadSelection readCmd:
                {
                    var formula = _adapter.ReadSelection();
                    _ = _pipeClient.SendAsync(new VstoReadSelection
                    {
                        RequestId = readCmd.RequestId,
                        SessionId = readCmd.SessionId,
                        Formula = formula,
                        RangeXml = formula?.Omml
                    });
                    break;
                }

                case DesktopDeleteCurrent delCmd:
                {
                    var result = _adapter.DeleteCurrent();
                    _ = _pipeClient.SendAsync(new VstoDeleteResult
                    {
                        RequestId = delCmd.RequestId, SessionId = delCmd.SessionId,
                        Success = result.Success, Error = result.Error
                    });
                    break;
                }

                case DesktopReplaceFormula repCmd:
                {
                    var result = _adapter.ReplaceFormula(repCmd.FormulaId, repCmd.Formula);
                    _ = _pipeClient.SendAsync(new VstoReplaceResult
                    {
                        RequestId = repCmd.RequestId, SessionId = repCmd.SessionId,
                        Success = result.Success, Error = result.Error
                    });
                    break;
                }

                case DesktopPing:
                    System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.Word] Ping received");
                    break;

                case DesktopInsertTable insertTable:
                {
                    var success = _tableConverter.InsertTable(insertTable.Table);
                    break;
                }

                case DesktopRequestReadTable readTableCmd:
                {
                    var table = _tableConverter.ReadSelection();
                    _ = _pipeClient.SendAsync(new VstoReadTable
                    {
                        RequestId = readTableCmd.RequestId,
                        SessionId = readTableCmd.SessionId,
                        Table = table
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

                _ = _pipeClient.SendAsync(new VstoContextChanged
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
            _pipeClient?.Disconnect();
            _pipeConnected = false;
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
