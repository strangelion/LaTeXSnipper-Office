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
        private PipeReconnectCoordinator? _pipeReconnect;
        private OfficeStaDispatcher? _staDispatcher;
        private VisioRibbonExtensibility? _ribbon;
        private string _sessionId = "";
        private volatile bool _pipeConnected;
        private string _hostVersion = "";

        internal Host.VisioAdapter? Adapter => _adapter;
        internal bool PipeConnected => _pipeConnected;
        internal string SessionId => _sessionId;

        protected override Microsoft.Office.Core.IRibbonExtensibility CreateRibbonExtensibilityObject()
        {
            _ribbon = new VisioRibbonExtensibility();
            return _ribbon;
        }

        internal void Send(VstoMessage message)
        {
            if (_pipeClient != null && _pipeConnected) _ = _pipeClient.SendAsync(message);
        }

        private void ThisAddIn_Startup(object sender, EventArgs e)
        {
            _staDispatcher = new OfficeStaDispatcher("visio");
            _sessionId = Guid.NewGuid().ToString("N").Substring(0, 12);
            _hostVersion = Application.Version;
            _adapter = new Host.VisioAdapter(Application);
            SubscribeApplicationEvents();
            _pipeReconnect = new PipeReconnectCoordinator(
                "visio",
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
                    "visio",
                    _hostVersion).ConfigureAwait(false);
                if (!helloOk)
                {
                    _pipeClient.Dispose();
                    _pipeClient = null;
                    return false;
                }

                PipeClient connectedClient = _pipeClient;
                _staDispatcher?.TryPost("visio-send-host-ready", () => SendHostReady(connectedClient));
                return true;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return false;
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("connect-pipe", "visio", null, ex);
                _pipeClient?.Dispose();
                _pipeClient = null;
                return false;
            }
        }

        private void OnPipeConnectionChanged(bool connected)
        {
            _pipeConnected = connected;
            _staDispatcher?.TryPost("visio-refresh-ribbon-connection", () =>
            {
                try
                {
                    _ribbon?.NotifyConnectionChanged();
                }
                catch (Exception ex)
                {
                    OfficeOperationLog.Failure("refresh-ribbon-connection", "visio", null, ex);
                }
            });
        }

        private void SendHostReady(PipeClient connectedClient)
        {
            if (_adapter == null || !ReferenceEquals(_pipeClient, connectedClient)) return;
            _ = connectedClient.SendHostReadyAsync(
                _sessionId,
                "visio",
                _hostVersion,
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
            _pipeReconnect?.Dispose();
            _pipeClient?.Disconnect();
            _staDispatcher?.Dispose();
            _pipeConnected = false;
        }

        private void InternalStartup()
        {
            Startup += ThisAddIn_Startup;
            Shutdown += ThisAddIn_Shutdown;
        }
    }
}
