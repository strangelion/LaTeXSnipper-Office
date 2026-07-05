using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Word.Metadata;

namespace LaTeXSnipper.NativeOffice.Word;

public partial class ThisAddIn
{
    private PipeClient _pipeClient;
    private WordAdapter _adapter;
    private NumberingManager _numbering;
    private ReferenceManager _reference;
    private TableConverter _tableConverter;
    private CancellationTokenSource _listenCts;
    private string _sessionId;
    private SynchronizationContext _uiContext;

    private void ThisAddIn_Startup(object sender, EventArgs e)
    {
        try
        {
            // Capture the Office UI SynchronizationContext
            _uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();

            _adapter = new WordAdapter(Application);
            _numbering = new NumberingManager(Application);
            _reference = new ReferenceManager(Application, _numbering);
            _tableConverter = new TableConverter(Application);

            // Subscribe to document change events for context tracking
            Application.DocumentChange += OnDocumentChange;

            // Connect to Desktop pipe
            _pipeClient = new PipeClient();
            _ = ConnectAndListen();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ThisAddIn] Startup error: {ex.Message}");
        }
    }

    /// <summary>
    /// Called when user switches to a different document.
    /// Sends VstoContextChanged to Desktop.
    /// </summary>
    private void OnDocumentChange(Word.Document Doc)
    {
        if (_pipeClient == null || _sessionId == null) return;

        try
        {
            var contextId = _adapter?.GetCurrentDocumentContextId();
            if (string.IsNullOrEmpty(contextId)) return;

            _ = _pipeClient.SendAsync(new VstoContextChanged
            {
                RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
                SessionId = _sessionId,
                DocumentContextId = contextId,
                DocumentTitle = Doc?.Name,
                DocumentKind = "document"
            });

            System.Diagnostics.Debug.WriteLine($"[ThisAddIn] Context changed: {contextId}");
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ThisAddIn] Context change error: {ex.Message}");
        }
    }

    private async Task ConnectAndListen()
    {
        if (_pipeClient == null) return;

        var secret = Handshake.GetOrCreateSecret();
        var connected = await _pipeClient.ConnectAsync();
        if (!connected)
        {
            System.Diagnostics.Debug.WriteLine("[ThisAddIn] Failed to connect to Desktop pipe");
            return;
        }

        // Generate session ID once, use for both HELLO and HOST_READY
        _sessionId = Guid.NewGuid().ToString("N").Substring(0, 12);

        // Register event handlers and start ReaderLoop BEFORE sending HELLO
        _listenCts = new CancellationTokenSource();
        _pipeClient.MessageReceived += OnMessageReceived;
        _pipeClient.Disconnected += OnDisconnected;

        // Start ReaderLoop in background (don't await - it runs forever)
        _ = Task.Run(() => _pipeClient.StartListeningAsync(_listenCts.Token));

        // Small delay to ensure reader loop is started
        await Task.Delay(100);

        // Send HELLO
        var handshakeOk = await _pipeClient.SendHelloAsync(_sessionId, secret, "word", Application.Version);
        if (!handshakeOk)
        {
            System.Diagnostics.Debug.WriteLine("[ThisAddIn] Handshake failed");
            return;
        }

        // Send HOST_READY
        string docId = null;
        try { docId = Application.ActiveDocument?.Name; } catch { }
        await _pipeClient.SendHostReadyAsync(_sessionId, "word", Application.Version, docId);

        // Initialize Ribbon on UI thread
        _uiContext.Post(_ =>
        {
            try
            {
                var ribbon = Globals.Ribbons.FormulaRibbon;
                ribbon?.Initialize(_adapter, _pipeClient, _sessionId);
                System.Diagnostics.Debug.WriteLine("[ThisAddIn] Ribbon initialized");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[ThisAddIn] Ribbon init error: {ex.Message}");
            }
        }, null);
    }

    private void OnMessageReceived(object sender, DesktopMessage message)
    {
        if (_adapter == null || _sessionId == null) return;

        // Marshal to Office UI thread using captured SynchronizationContext
        _uiContext.Post(_ =>
        {
            try
            {
                HandleCommand(message);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[ThisAddIn] Command handler error: {ex.Message}");
            }
        }, null);
    }

    private void HandleCommand(DesktopMessage message)
    {
        if (_adapter == null || _pipeClient == null) return;

        // Validate expectedContextId for document commands
        if (message is DesktopDocumentCommand docCmd && !string.IsNullOrEmpty(docCmd.ExpectedContextId))
        {
            var currentContext = _adapter.GetCurrentDocumentContextId();
            if (!string.IsNullOrEmpty(currentContext) &&
                !StringComparer.Ordinal.Equals(docCmd.ExpectedContextId, currentContext))
            {
                System.Diagnostics.Debug.WriteLine($"[ThisAddIn] Context mismatch: expected={docCmd.ExpectedContextId}, current={currentContext}");
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

            case DesktopReplaceFormula cmd:
            {
                var success = _adapter.ReplaceFormula(cmd.FormulaId, cmd.Formula);
                _ = _pipeClient.SendAsync(new VstoReplaceResult
                {
                    RequestId = cmd.RequestId,
                    SessionId = cmd.SessionId,
                    Success = success
                });
                break;
            }

            case DesktopDeleteCurrent cmd:
            {
                var success = _adapter.DeleteCurrent();
                _ = _pipeClient.SendAsync(new VstoDeleteResult
                {
                    RequestId = cmd.RequestId,
                    SessionId = cmd.SessionId,
                    Success = success
                });
                break;
            }

            case DesktopRequestReadSelection cmd:
            {
                var formula = _adapter.ReadSelection();
                if (formula != null)
                {
                    _ = _pipeClient.SendAsync(new VstoReadSelection
                    {
                        RequestId = cmd.RequestId,
                        SessionId = cmd.SessionId,
                        Formula = formula,
                        RangeXml = formula.Omml
                    });
                }
                break;
            }

            case DesktopRequestReadTable cmd:
            {
                var table = _tableConverter?.ReadSelection();
                if (table != null)
                {
                    _ = _pipeClient.SendAsync(new VstoReadTable
                    {
                        RequestId = cmd.RequestId,
                        SessionId = cmd.SessionId,
                        TableXml = System.Text.Json.JsonSerializer.Serialize(table)
                    });
                }
                break;
            }

            case DesktopFormatSelection cmd:
            {
                _adapter.FormatSelection(cmd.Options);
                break;
            }

            case DesktopFormatAll cmd:
            {
                _adapter.FormatAll(cmd.Options);
                break;
            }

            case DesktopRenumberWord cmd:
            {
                if (_numbering != null && _reference != null)
                {
                    var result = _numbering.RenumberAll(startFrom: cmd.StartFrom);
                    _reference.UpdateAllReferences();
                }
                break;
            }

            case DesktopInsertWordReference cmd:
            {
                if (_reference != null)
                {
                    _reference.InsertReference(cmd.FormulaId, cmd.ReferenceType);
                }
                break;
            }

            case DesktopPing:
            {
                // Ping received from Desktop - no response needed
                System.Diagnostics.Debug.WriteLine("[ThisAddIn] Ping received");
                break;
            }
        }
    }

    private void OnDisconnected(object sender, EventArgs e)
    {
        System.Diagnostics.Debug.WriteLine("[ThisAddIn] Disconnected from Desktop");
    }

    private void ThisAddIn_Shutdown(object sender, EventArgs e)
    {
        _listenCts?.Cancel();
        _pipeClient?.Dispose();
    }
}
