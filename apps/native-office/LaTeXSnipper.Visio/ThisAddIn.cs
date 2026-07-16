#nullable enable
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using LaTeXSnipper.NativeOffice.Shared;
using VisioInterop = Microsoft.Office.Interop.Visio;

namespace LaTeXSnipper.Visio
{
    [ComVisible(true)]
    public partial class ThisAddIn
    {
        private Host.VisioAdapter? _adapter;
        private PipeClient? _pipeClient;
        private OfficeStaDispatcher? _staDispatcher;
        private string _sessionId = "";
        private bool _pipeConnected;

        internal Host.VisioAdapter? Adapter => _adapter;
        internal bool PipeConnected => _pipeConnected;
        internal string SessionId => _sessionId;

        protected override Microsoft.Office.Core.IRibbonExtensibility CreateRibbonExtensibilityObject() =>
            new VisioRibbonExtensibility();

        internal void Send(VstoMessage message)
        {
            if (_pipeClient != null && _pipeConnected) _ = _pipeClient.SendAsync(message);
        }

        private void ThisAddIn_Startup(object sender, EventArgs e)
        {
            _staDispatcher = new OfficeStaDispatcher("visio");
            _sessionId = Guid.NewGuid().ToString("N").Substring(0, 12);
            _adapter = new Host.VisioAdapter(Application);
            SubscribeApplicationEvents();
            _ = InitializePipeAsync();
        }

        private async Task InitializePipeAsync()
        {
            for (int attempt = 1; attempt <= 60; attempt++)
            {
                try
                {
                    _pipeClient?.Dispose();
                    _pipeClient = new PipeClient();
                    if (!await _pipeClient.ConnectAsync())
                    {
                        await Task.Delay(3000).ConfigureAwait(false);
                        continue;
                    }
                    _pipeClient.MessageReceived += OnMessageReceived;
                    _ = _pipeClient.StartListeningAsync(CancellationToken.None);
                    if (await _pipeClient.SendHelloAsync(_sessionId, Handshake.GetOrCreateSecret(), "visio", Application.Version))
                    {
                        _pipeConnected = true;
                        _staDispatcher?.TryPost("visio-send-host-ready", SendHostReady);
                        return;
                    }
                }
                catch (Exception ex)
                {
                    OfficeOperationLog.Failure("connect-pipe", "visio", null, ex);
                }
                await Task.Delay(3000).ConfigureAwait(false);
            }
        }

        private void SendHostReady()
        {
            if (_adapter == null || _pipeClient == null) return;
            _ = _pipeClient.SendHostReadyAsync(
                _sessionId,
                "visio",
                Application.Version,
                new Capabilities
                {
                    InsertFormula = true,
                    ReplaceFormula = true,
                    ReadSelection = true,
                    InsertTable = false,
                    ReadTable = false,
                    RequiresSvgForFormula = false,
                    Features = new Dictionary<string, bool>
                    {
                        ["visio.vectorSvg"] = true,
                        ["visio.pngFallback"] = true,
                        ["visio.shapeSheetMetadataV3"] = true,
                        ["visio.selectionOnlyMutation"] = true,
                        ["visio.ole"] = false
                    }
                },
                _adapter.GetCurrentContextId(),
                _adapter.GetCurrentDocumentTitle());
        }

        private void OnMessageReceived(object sender, DesktopMessage message)
        {
            if (_staDispatcher == null || !_staDispatcher.IsAvailable) return;
            _staDispatcher.TryPost("visio-handle-pipe-command", () =>
            {
                try { HandleCommand(message); }
                catch (Exception ex) { OfficeOperationLog.Failure("handle-pipe-command", "visio", null, ex); }
            });
        }

        private void HandleCommand(DesktopMessage message)
        {
            if (_adapter == null || _pipeClient == null) return;
            if (message is DesktopDocumentCommand documentCommand &&
                !NativeOfficeProtocol.EnsureExpectedContext(documentCommand, _adapter.GetCurrentContextId(), _pipeClient))
                return;

            switch (message)
            {
                case DesktopInsertFormula command:
                {
                    ResolveStorageMode(command);
                    Host.InsertResult result = _adapter.InsertFormula(command.Formula, command.Mode);
                    _ = _pipeClient.SendAsync(new VstoInsertResult
                    {
                        RequestId = command.RequestId,
                        SessionId = command.SessionId,
                        Success = result.Success,
                        FormulaId = result.FormulaId,
                        RequestedStorageMode = command.IntegrationMode ?? "auto",
                        ActualStorageMode = result.ActualStorageMode,
                        FallbackReason = result.FallbackReason,
                        ErrorCode = result.ErrorCode,
                        Error = result.Error
                    });
                    break;
                }
                case DesktopRequestReadSelection command:
                {
                    FormulaPayload? formula = _adapter.ReadSelection();
                    _ = _pipeClient.SendAsync(new VstoReadSelection
                    {
                        RequestId = command.RequestId,
                        SessionId = command.SessionId,
                        Formula = formula
                    });
                    break;
                }
                case DesktopDeleteCurrent command:
                {
                    bool success = string.IsNullOrWhiteSpace(command.FormulaId)
                        ? _adapter.DeleteCurrent()
                        : _adapter.DeleteFormula(command.FormulaId!);
                    _ = _pipeClient.SendAsync(new VstoDeleteResult
                    {
                        RequestId = command.RequestId,
                        SessionId = command.SessionId,
                        Success = success,
                        Error = success ? null : "Select exactly one matching Visio formula shape."
                    });
                    break;
                }
                case DesktopReplaceFormula command:
                {
                    bool success = _adapter.ReplaceFormula(command.FormulaId, command.Formula);
                    _ = _pipeClient.SendAsync(new VstoReplaceResult
                    {
                        RequestId = command.RequestId,
                        SessionId = command.SessionId,
                        Success = success,
                        ActualStorageMode = success ? "image" : null,
                        Error = success ? null : "Visio replacement rejected or failed."
                    });
                    break;
                }
                case DesktopPing:
                    break;
                default:
                    _pipeClient.SendOnlyAsync(new VstoHostError
                    {
                        RequestId = message.RequestId,
                        SessionId = message.SessionId,
                        ErrorCode = "NOT_IMPLEMENTED",
                        Error = "Command is not implemented for Visio: " + message.GetType().Name
                    });
                    break;
            }
        }

        private void SubscribeApplicationEvents()
        {
            Application.DocumentOpened += OnDocumentOpened;
            Application.DocumentCreated += OnDocumentCreated;
            Application.DocumentChanged += OnDocumentChanged;
            Application.PageChanged += OnPageChanged;
            Application.WindowTurnedToPage += OnWindowTurnedToPage;
            Application.SelectionChanged += OnSelectionChanged;
            Application.BeforeDocumentClose += OnBeforeDocumentClose;
        }

        private void UnsubscribeApplicationEvents()
        {
            Application.DocumentOpened -= OnDocumentOpened;
            Application.DocumentCreated -= OnDocumentCreated;
            Application.DocumentChanged -= OnDocumentChanged;
            Application.PageChanged -= OnPageChanged;
            Application.WindowTurnedToPage -= OnWindowTurnedToPage;
            Application.SelectionChanged -= OnSelectionChanged;
            Application.BeforeDocumentClose -= OnBeforeDocumentClose;
        }

        private void OnDocumentOpened(VisioInterop.Document document) => SendContextChanged();
        private void OnDocumentCreated(VisioInterop.Document document) => SendContextChanged();
        private void OnDocumentChanged(VisioInterop.Document document) => SendContextChanged();
        private void OnPageChanged(VisioInterop.Page page) => SendContextChanged();
        private void OnWindowTurnedToPage(VisioInterop.Window window) => SendContextChanged();
        private void OnSelectionChanged(VisioInterop.Window window) => SendContextChanged();
        private void OnBeforeDocumentClose(VisioInterop.Document document) => _adapter?.ForgetDocument(document);

        private void SendContextChanged()
        {
            try
            {
                if (_adapter == null || _pipeClient == null || !_pipeConnected) return;
                _pipeClient.SendOnlyAsync(new VstoContextChanged
                {
                    RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
                    SessionId = _sessionId,
                    DocumentContextId = _adapter.GetCurrentContextId(),
                    DocumentTitle = _adapter.GetCurrentDocumentTitle(),
                    DocumentKind = "visio-page"
                });
            }
            catch (Exception ex) { OfficeOperationLog.Failure("send-context-changed", "visio", null, ex); }
        }

        private static void ResolveStorageMode(DesktopInsertFormula command)
        {
            if (string.IsNullOrEmpty(command.IntegrationMode) || command.IntegrationMode == "auto") return;
            command.Formula.StorageMode = command.IntegrationMode switch
            {
                "ole" => "ole",
                "image" => "image",
                "vector" => "vector",
                "native" => "native-omml",
                _ => command.Formula.StorageMode
            };
        }

        private void ThisAddIn_Shutdown(object sender, EventArgs e)
        {
            UnsubscribeApplicationEvents();
            _pipeClient?.Disconnect();
            _staDispatcher?.Dispose();
        }

        private void InternalStartup()
        {
            Startup += ThisAddIn_Startup;
            Shutdown += ThisAddIn_Shutdown;
        }
    }
}
