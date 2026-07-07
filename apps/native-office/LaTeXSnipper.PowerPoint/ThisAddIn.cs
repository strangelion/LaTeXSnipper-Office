using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.PowerPoint
{
    [ComVisible(true)]
    public partial class ThisAddIn
    {
        private Host.PowerPointAdapter _adapter;
        private PipeClient _pipeClient;
        private SynchronizationContext _syncContext;
        private string _sessionId;
        private bool _pipeConnected;

        internal Host.PowerPointAdapter Adapter => _adapter;
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
            return new PowerPointRibbonExtensibility();
        }

        private void ThisAddIn_Startup(object sender, System.EventArgs e)
        {
            System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.PowerPoint] Startup reached.");
            _syncContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            _sessionId = Guid.NewGuid().ToString("N").Substring(0, 12);
            _adapter = new Host.PowerPointAdapter(Application);
            _ = InitializePipeAsync();
        }

        private async Task InitializePipeAsync()
        {
            for (int attempt = 1; attempt <= 60; attempt++)
            {
                try
                {
                    if (_pipeClient != null) { _pipeClient.Dispose(); _pipeClient = null; }
                    _pipeClient = new PipeClient();
                    if (!await _pipeClient.ConnectAsync())
                    {
                        if (attempt == 1) System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.PowerPoint] Waiting for Desktop...");
                        await Task.Delay(3000);
                        continue;
                    }
                    System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.PowerPoint] Pipe connected.");
                    _pipeClient.MessageReceived += OnMessageReceived;
                    _ = _pipeClient.StartListeningAsync(CancellationToken.None);
                    var secret = Handshake.GetOrCreateSecret();
                    if (await _pipeClient.SendHelloAsync(_sessionId, secret, "powerpoint", Application.Version))
                    {
                        _pipeConnected = true;
                        _syncContext.Post(_ =>
                        {
                            try
                            {
                                var ctx = _adapter.GetCurrentContextId();
                                _ = _pipeClient.SendHostReadyAsync(_sessionId, "powerpoint", Application.Version, ctx);
                            }
                            catch (Exception ex)
                            {
                                System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.PowerPoint] HOST_READY error: " + ex.Message);
                            }
                        }, null);
                        return;
                    }
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.PowerPoint] Init " + attempt + ": " + ex.Message);
                }
                await Task.Delay(3000);
            }
        }

        private void OnMessageReceived(object sender, DesktopMessage message)
        {
            if (_adapter == null) return;
            _syncContext?.Post(_ =>
            {
                try { HandleCommand(message); }
                catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[LaTeXSnipper.PowerPoint] Handler error: " + ex.Message); }
            }, null);
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
                            var pres = Application.ActivePresentation;
                            if (pres != null)
                                FormulaDocumentManifest.WriteEntry(pres.CustomXMLParts, cmd.Formula, "powerpoint");
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"[LaTeXSnipper.PowerPoint] Manifest write error: {ex.Message}");
                        }
                    }
                    _ = _pipeClient.SendAsync(new VstoInsertResult
                    {
                        RequestId = cmd.RequestId, SessionId = cmd.SessionId,
                        Success = result.Success, FormulaId = result.FormulaId,
                        RequestedStorageMode = cmd.IntegrationMode ?? "auto",
                        ActualStorageMode = result.ActualStorageMode,
                        FallbackReason = result.FallbackReason,
                        Error = result.Error
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
                            var pres = Application.ActivePresentation;
                            if (pres != null)
                                FormulaDocumentManifest.RemoveEntry(pres.CustomXMLParts, formulaId);
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"[LaTeXSnipper.PowerPoint] Manifest cleanup error: {ex.Message}");
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
            }
        }

        private void ThisAddIn_Shutdown(object sender, System.EventArgs e)
        {
            _pipeClient?.Disconnect();
        }

        /// <summary>
        /// Extract formulaId from the currently selected LSNO_ shape.
        /// </summary>
        private string? ExtractFormulaIdFromSelection()
        {
            try
            {
                var sel = Application.ActiveWindow.Selection;
                if (sel.Type == Microsoft.Office.Interop.PowerPoint.PpSelectionType.ppSelectionShapes)
                {
                    var shapeRange = sel.ShapeRange;
                    if (shapeRange != null && shapeRange.Count > 0)
                    {
                        var shape = shapeRange[1];
                        var name = shape.Name as string;
                        if (!string.IsNullOrEmpty(name) && name.StartsWith("LSNO_") && name.Length > 5)
                            return name.Substring(5);
                    }
                }
            }
            catch { }
            return null;
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

        private void InternalStartup()
        {
            this.Startup += new System.EventHandler(ThisAddIn_Startup);
            this.Shutdown += new System.EventHandler(ThisAddIn_Shutdown);
        }
    }
}
