using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.PowerPoint.Metadata;

namespace LaTeXSnipper.NativeOffice.PowerPoint;

public partial class ThisAddIn
{
    private PipeClient _pipeClient;
    private PowerPointAdapter _adapter;
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

            _adapter = new PowerPointAdapter(Application);
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
        var handshakeOk = await _pipeClient.SendHelloAsync(_sessionId, secret, "powerpoint", Application.Version);
        if (!handshakeOk)
        {
            System.Diagnostics.Debug.WriteLine("[ThisAddIn] Handshake failed");
            return;
        }

        // Send HOST_READY
        string docId = null;
        try { docId = Application.ActivePresentation?.Name; } catch { }
        await _pipeClient.SendHostReadyAsync(_sessionId, "powerpoint", Application.Version, docId);

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

            case DesktopRequestReadSelection cmd:
            {
                var formula = _adapter.ReadSelection();
                if (formula != null)
                {
                    _ = _pipeClient.SendAsync(new VstoReadSelection
                    {
                        RequestId = cmd.RequestId,
                        SessionId = cmd.SessionId,
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
                try
                {
                    if (Application.Selection.Type == Microsoft.Office.Interop.PowerPoint.PpSelectionType.ppSelectionShapes)
                    {
                        var shapeRange = Application.Selection.ShapeRange;
                        foreach (var shape in shapeRange)
                        {
                            if (cmd.Options.FontFamily != null)
                                shape.TextFrame2.TextRange.Font.Name = cmd.Options.FontFamily;
                            if (cmd.Options.FontSize.HasValue)
                                shape.TextFrame2.TextRange.Font.Size = cmd.Options.FontSize.Value;
                            if (cmd.Options.FontColor != null && cmd.Options.FontColor.StartsWith("#"))
                            {
                                int r = Convert.ToInt32(cmd.Options.FontColor.Substring(1, 2), 16);
                                int g = Convert.ToInt32(cmd.Options.FontColor.Substring(3, 2), 16);
                                int b = Convert.ToInt32(cmd.Options.FontColor.Substring(5, 2), 16);
                                shape.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = r + (g << 8) + (b << 16);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[ThisAddIn] FormatSelection error: {ex.Message}");
                }
                break;
            }

            case DesktopFormatAll cmd:
            {
                try
                {
                    var slide = Application.ActiveWindow?.Selection?.SlideRange?[1];
                    if (slide != null)
                    {
                        foreach (var shape in slide.Shapes)
                        {
                            if (cmd.Options.FontFamily != null)
                                shape.TextFrame2.TextRange.Font.Name = cmd.Options.FontFamily;
                            if (cmd.Options.FontSize.HasValue)
                                shape.TextFrame2.TextRange.Font.Size = cmd.Options.FontSize.Value;
                        }
                    }
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[ThisAddIn] FormatAll error: {ex.Message}");
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
