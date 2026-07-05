using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Excel.Metadata;

namespace LaTeXSnipper.NativeOffice.Excel;

public partial class ThisAddIn
{
    private PipeClient _pipeClient;
    private ExcelAdapter _adapter;
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

            _adapter = new ExcelAdapter(Application);
            _tableConverter = new TableConverter(Application);

            // Subscribe to workbook activation events for context tracking
            Application.WorkbookActivate += OnWorkbookActivate;

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
    /// Called when user activates a different workbook.
    /// Sends VstoContextChanged to Desktop.
    /// </summary>
    private void OnWorkbookActivate(Excel.Workbook Wb)
    {
        if (_pipeClient == null || _sessionId == null) return;

        try
        {
            var contextId = GetCurrentDocumentContextId();
            if (string.IsNullOrEmpty(contextId)) return;

            _ = _pipeClient.SendAsync(new VstoContextChanged
            {
                RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
                SessionId = _sessionId,
                DocumentContextId = contextId,
                DocumentTitle = Wb?.Name,
                DocumentKind = "workbook"
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
        var handshakeOk = await _pipeClient.SendHelloAsync(_sessionId, secret, "excel", Application.Version);
        if (!handshakeOk)
        {
            System.Diagnostics.Debug.WriteLine("[ThisAddIn] Handshake failed");
            return;
        }

        // Send HOST_READY
        string docId = null;
        try { docId = Application.ActiveWorkbook?.Name; } catch { }
        await _pipeClient.SendHostReadyAsync(_sessionId, "excel", Application.Version, docId);

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
            var currentContext = GetCurrentDocumentContextId();
            if (!string.IsNullOrEmpty(currentContext) &&
                !StringComparer.Ordinal.Equals(docCmd.ExpectedContextId, currentContext))
            {
                System.Diagnostics.Debug.WriteLine($"[ThisAddIn] Context mismatch: expected={docCmd.ExpectedContextId}, current={currentContext}");
                _ = _pipeClient.SendAsync(new VstoHostError
                {
                    RequestId = docCmd.RequestId,
                    SessionId = docCmd.SessionId,
                    ErrorCode = "CONTEXT_CHANGED",
                    Error = "Workbook context changed since command was issued"
                });
                return;
            }
        }

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
                var range = Application.Selection as Microsoft.Office.Interop.Excel.Range;
                if (range != null)
                {
                    if (cmd.Options.FontFamily != null)
                        range.Font.Name = cmd.Options.FontFamily;
                    if (cmd.Options.FontSize.HasValue)
                        range.Font.Size = cmd.Options.FontSize.Value;
                    if (cmd.Options.FontColor != null && cmd.Options.FontColor.StartsWith("#"))
                    {
                        int r = Convert.ToInt32(cmd.Options.FontColor.Substring(1, 2), 16);
                        int g = Convert.ToInt32(cmd.Options.FontColor.Substring(3, 2), 16);
                        int b = Convert.ToInt32(cmd.Options.FontColor.Substring(5, 2), 16);
                        range.Font.Color = r + (g << 8) + (b << 16);
                    }
                }
                break;
            }

            case DesktopFormatAll cmd:
            {
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

    /// <summary>
    /// Get the current workbook context ID.
    /// Uses FullName for saved workbooks, or a combination of Name + window handle for unsaved.
    /// </summary>
    private string GetCurrentDocumentContextId()
    {
        try
        {
            var wb = Application.ActiveWorkbook;
            if (wb == null) return "";

            if (!string.IsNullOrEmpty(wb.FullName))
            {
                return $"excel:{wb.FullName}";
            }

            return $"excel:unsaved:{wb.Name}:{Application.ActiveWindow.Hwnd}";
        }
        catch
        {
            return "";
        }
    }

    private void ThisAddIn_Shutdown(object sender, EventArgs e)
    {
        _listenCts?.Cancel();
        _pipeClient?.Dispose();
    }
}
