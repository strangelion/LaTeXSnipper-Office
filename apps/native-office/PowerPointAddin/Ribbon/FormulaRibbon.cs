using Microsoft.Office.Tools.Ribbon;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.PowerPoint.Metadata;

namespace LaTeXSnipper.NativeOffice.PowerPoint.Ribbon;

partial class FormulaRibbon
{
    private PowerPointAdapter? _adapter;
    private PipeClient? _pipeClient;
    private string? _sessionId;
    private TableConverter? _tableConverter;

    private void FormulaRibbon_Load(object sender, RibbonUIEventArgs e)
    {
        // Get references from ThisAddIn
        var addIn = Globals.ThisAddIn;
    }

    public void Initialize(PowerPointAdapter adapter, PipeClient pipeClient, string sessionId)
    {
        _adapter = adapter;
        _pipeClient = pipeClient;
        _sessionId = sessionId;
        _tableConverter = new TableConverter(Globals.ThisAddIn.Application);
    }

    // ---------------------------------------------------------------------------
    // Formula group
    // ---------------------------------------------------------------------------

    private void btnInsertFormula_Click(object sender, RibbonControlEventArgs e)
    {
        if (_pipeClient == null || _sessionId == null) return;
        _ = _pipeClient.SendAsync(new VstoOpenEditor
        {
            RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
            SessionId = _sessionId
        });
    }

    private void btnLoadFormula_Click(object sender, RibbonControlEventArgs e)
    {
        if (_adapter == null || _pipeClient == null || _sessionId == null) return;

        var formula = _adapter.ReadSelection();
        if (formula != null)
        {
            _ = _pipeClient.SendAsync(new VstoReadSelection
            {
                RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
                SessionId = _sessionId,
                RangeXml = formula.Omml
            });
        }
    }

    private void btnDeleteFormula_Click(object sender, RibbonControlEventArgs e)
    {
        if (_adapter == null || _pipeClient == null || _sessionId == null) return;

        var success = _adapter.DeleteCurrent();
        _ = _pipeClient.SendAsync(new VstoDeleteResult
        {
            RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
            SessionId = _sessionId,
            Success = success
        });
    }

    // ---------------------------------------------------------------------------
    // Table group
    // ---------------------------------------------------------------------------

    private void btnLoadTable_Click(object sender, RibbonControlEventArgs e)
    {
        if (_tableConverter == null || _pipeClient == null || _sessionId == null) return;

        var tablePayload = _tableConverter.ReadSelection();
        if (tablePayload != null)
        {
            _ = _pipeClient.SendAsync(new VstoReadTable
            {
                RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
                SessionId = _sessionId,
                TableXml = System.Text.Json.JsonSerializer.Serialize(tablePayload)
            });
        }
    }

    private void btnInsertTable_Click(object sender, RibbonControlEventArgs e)
    {
        if (_pipeClient == null || _sessionId == null) return;
        _ = _pipeClient.SendAsync(new VstoOpenEditor
        {
            RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
            SessionId = _sessionId
        });
    }

    private void btnFormatTable_Click(object sender, RibbonControlEventArgs e)
    {
        if (_tableConverter == null) return;

        try
        {
            var selection = Globals.ThisAddIn.Application.Selection;
            if (selection.Type == Microsoft.Office.Interop.PowerPoint.PpSelectionType.ppSelectionShapes)
            {
                var shape = selection.ShapeRange[1];
                if (shape.HasTable == Microsoft.Office.Core.MsoTriState.msoTrue)
                {
                    _tableConverter.FormatTable(shape.Table);
                }
            }
        }
        catch { }
    }

    // ---------------------------------------------------------------------------
    // Format group
    // ---------------------------------------------------------------------------

    private void btnFormatSelection_Click(object sender, RibbonControlEventArgs e)
    {
        if (_pipeClient == null || _sessionId == null) return;
        _ = _pipeClient.SendAsync(new VstoReadSelection
        {
            RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
            SessionId = _sessionId
        });
    }

    private void btnFormatAll_Click(object sender, RibbonControlEventArgs e)
    {
        if (_pipeClient == null || _sessionId == null) return;
        _ = _pipeClient.SendAsync(new VstoReadSelection
        {
            RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
            SessionId = _sessionId
        });
    }

    // ---------------------------------------------------------------------------
    // Tools group
    // ---------------------------------------------------------------------------

    private void btnOpenEditor_Click(object sender, RibbonControlEventArgs e)
    {
        if (_pipeClient == null || _sessionId == null) return;
        _ = _pipeClient.SendAsync(new VstoOpenEditor
        {
            RequestId = Guid.NewGuid().ToString("N").Substring(0, 12),
            SessionId = _sessionId
        });
    }
}
