using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Word.Metadata;

namespace LaTeXSnipper.NativeOffice.Word;

public partial class ThisAddIn
{
    private PipeClient? _pipeClient;
    private WordAdapter? _adapter;
    private NumberingManager? _numbering;
    private ReferenceManager? _reference;
    private CancellationTokenSource? _listenCts;
    private string? _sessionId;

    private void ThisAddIn_Startup(object sender, EventArgs e)
    {
        try
        {
            _adapter = new WordAdapter(Application);
            _numbering = new NumberingManager(Application);
            _reference = new ReferenceManager(Application, _numbering);

            // Connect to Desktop pipe
            _pipeClient = new PipeClient();
            _ = ConnectAndListen();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ThisAddIn] Startup error: {ex.Message}");
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

        // Send HELLO
        var handshakeOk = await _pipeClient.SendHelloAsync(secret, "word", Application.Version);
        if (!handshakeOk)
        {
            System.Diagnostics.Debug.WriteLine("[ThisAddIn] Handshake failed");
            return;
        }

        _sessionId = Guid.NewGuid().ToString("N")[..12];

        // Send HOST_READY
        string? docId = null;
        try { docId = Application.ActiveDocument?.Name; } catch { }
        await _pipeClient.SendHostReadyAsync(_sessionId, "word", Application.Version, docId);

        // Start listening for Desktop commands
        _listenCts = new CancellationTokenSource();
        _pipeClient.MessageReceived += OnMessageReceived;
        _pipeClient.Disconnected += OnDisconnected;
        await _pipeClient.StartListeningAsync(_listenCts.Token);
    }

    private void OnMessageReceived(object? sender, DesktopMessage message)
    {
        if (_adapter == null || _sessionId == null) return;

        try
        {
            // All COM Interop calls must run on the Office UI thread
            Microsoft.Office.Tools.Word.ApplicationFactory.ExecuteOnUIThread(() =>
            {
                HandleCommand(message);
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ThisAddIn] Command handler error: {ex.Message}");
        }
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
                    System.Diagnostics.Debug.WriteLine(
                        $"[ThisAddIn] Renumber completed: {result.Count} formulas"
                    );
                }
                break;
            }

            case DesktopInsertWordReference cmd:
            {
                if (_reference != null)
                {
                    var success = _reference.InsertReference(cmd.FormulaId, cmd.ReferenceType);
                    System.Diagnostics.Debug.WriteLine(
                        $"[ThisAddIn] InsertReference: {cmd.FormulaId} -> {success}"
                    );
                }
                break;
            }

            case DesktopPing:
            {
                // Respond with ping ack
                _ = _pipeClient.SendAsync(new DesktopPing
                {
                    RequestId = message.RequestId,
                    SessionId = message.SessionId
                });
                break;
            }
        }
    }

    private void OnDisconnected(object? sender, EventArgs e)
    {
        System.Diagnostics.Debug.WriteLine("[ThisAddIn] Disconnected from Desktop");
    }

    private void ThisAddIn_Shutdown(object sender, EventArgs e)
    {
        _listenCts?.Cancel();
        _pipeClient?.Dispose();
    }

    #region VSTO generated code

    private void InternalStartup()
    {
        Startup += new EventHandler(ThisAddIn_Startup);
        Shutdown += new EventHandler(ThisAddIn_Shutdown);
    }

    #endregion
}
