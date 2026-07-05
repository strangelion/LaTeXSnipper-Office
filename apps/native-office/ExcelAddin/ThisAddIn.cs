using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Excel.Metadata;

namespace LaTeXSnipper.NativeOffice.Excel;

public partial class ThisAddIn
{
    private PipeClient? _pipeClient;
    private ExcelAdapter? _adapter;
    private TableConverter? _tableConverter;
    private CancellationTokenSource? _listenCts;
    private string? _sessionId;

    private void ThisAddIn_Startup(object sender, EventArgs e)
    {
        try
        {
            _adapter = new ExcelAdapter(Application);
            _tableConverter = new TableConverter(Application);

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
        var handshakeOk = await _pipeClient.SendHelloAsync(secret, "excel", Application.Version);
        if (!handshakeOk)
        {
            System.Diagnostics.Debug.WriteLine("[ThisAddIn] Handshake failed");
            return;
        }

        _sessionId = Guid.NewGuid().ToString("N")[..12];

        // Send HOST_READY
        string? docId = null;
        try { docId = Application.ActiveWorkbook?.Name; } catch { }
        await _pipeClient.SendHostReadyAsync(_sessionId, "excel", Application.Version, docId);

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
            Application.GetType().InvokeMember(
                "Run",
                System.Reflection.BindingFlags.InvokeMethod,
                null,
                Application,
                new object[] { "DummyMacro" }
            );
            // Fallback: execute directly (may need UI thread marshaling)
            HandleCommand(message);
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
                var result = _adapter.InsertFormula(cmd.Formula);
                _ = _pipeClient.SendAsync(new VstoInsertResult
                {
                    RequestId = cmd.RequestId,
                    SessionId = cmd.SessionId,
                    Success = result.Success,
                    FormulaId = result.FormulaId,
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

            case DesktopInsertTable cmd:
            {
                var success = _tableConverter?.InsertTable(cmd.Table) ?? false;
                _ = _pipeClient.SendAsync(new VstoInsertResult
                {
                    RequestId = cmd.RequestId,
                    SessionId = cmd.SessionId,
                    Success = success,
                    FormulaId = cmd.Table.TableId
                });
                break;
            }

            case DesktopFormatSelection cmd:
            {
                // Apply formatting to selected range
                var range = Application.Selection as Microsoft.Office.Interop.Excel.Range;
                if (range != null)
                {
                    if (cmd.Options.FontFamily != null)
                        range.Font.Name = cmd.Options.FontFamily;
                    if (cmd.Options.FontSize.HasValue)
                        range.Font.Size = cmd.Options.FontSize.Value;
                    if (cmd.Options.FontColor != null)
                    {
                        // Convert hex to RGB
                        if (cmd.Options.FontColor.StartsWith("#") && cmd.Options.FontColor.Length == 7)
                        {
                            int r = Convert.ToInt32(cmd.Options.FontColor[1..3], 16);
                            int g = Convert.ToInt32(cmd.Options.FontColor[3..5], 16);
                            int b = Convert.ToInt32(cmd.Options.FontColor[5..7], 16);
                            range.Font.Color = r + (g << 8) + (b << 16);
                        }
                    }
                }
                break;
            }

            case DesktopFormatAll cmd:
            {
                // Format all cells in the active sheet
                var sheet = Application.ActiveSheet as Microsoft.Office.Interop.Excel.Worksheet;
                if (sheet?.UsedRange != null)
                {
                    var range = sheet.UsedRange;
                    if (cmd.Options.FontFamily != null)
                        range.Font.Name = cmd.Options.FontFamily;
                    if (cmd.Options.FontSize.HasValue)
                        range.Font.Size = cmd.Options.FontSize.Value;
                }
                break;
            }

            case DesktopPing:
            {
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
