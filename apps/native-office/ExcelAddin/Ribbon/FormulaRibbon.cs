using Microsoft.Office.Tools.Ribbon;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Excel.Metadata;

namespace LaTeXSnipper.NativeOffice.Excel.Ribbon;

public partial class FormulaRibbon
{
    private ExcelAdapter? _adapter;
    private PipeClient? _pipeClient;
    private string? _sessionId;
    private TableConverter? _tableConverter;

    private void FormulaRibbon_Load(object sender, RibbonUIEventArgs e)
    {
        // Get references from ThisAddIn
        var addIn = Globals.ThisAddIn;
        // These would be set during ThisAddIn initialization
    }

    public void Initialize(ExcelAdapter adapter, PipeClient pipeClient, string sessionId)
    {
        _adapter = adapter;
        _pipeClient = pipeClient;
        _sessionId = sessionId;
        _tableConverter = new TableConverter(Globals.ThisAddIn.Application);
    }

    // ---------------------------------------------------------------------------
    // Formula group
    // ---------------------------------------------------------------------------

    public void OnInsertFormula(RibbonControl control)
    {
        if (_adapter == null || _pipeClient == null || _sessionId == null) return;

        // Ask Desktop to insert formula
        _ = _pipeClient.SendAsync(new VstoOpenEditor
        {
            RequestId = Guid.NewGuid().ToString("N")[..12],
            SessionId = _sessionId
        });
    }

    public void OnLoadFormula(RibbonControl control)
    {
        if (_adapter == null || _pipeClient == null || _sessionId == null) return;

        var formula = _adapter.ReadSelection();
        if (formula != null)
        {
            _ = _pipeClient.SendAsync(new VstoReadSelection
            {
                RequestId = Guid.NewGuid().ToString("N")[..12],
                SessionId = _sessionId,
                RangeXml = formula.Omml
            });
        }
        else
        {
            System.Windows.Forms.MessageBox.Show(
                "No formula found at selection.",
                "LaTeXSnipper",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Information
            );
        }
    }

    public void OnDeleteFormula(RibbonControl control)
    {
        if (_adapter == null || _pipeClient == null || _sessionId == null) return;

        var success = _adapter.DeleteCurrent();
        _ = _pipeClient.SendAsync(new VstoDeleteResult
        {
            RequestId = Guid.NewGuid().ToString("N")[..12],
            SessionId = _sessionId,
            Success = success
        });

        if (!success)
        {
            System.Windows.Forms.MessageBox.Show(
                "No formula shape found at selection.",
                "LaTeXSnipper",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Information
            );
        }
    }

    // ---------------------------------------------------------------------------
    // Table group
    // ---------------------------------------------------------------------------

    public void OnLoadTable(RibbonControl control)
    {
        if (_tableConverter == null || _pipeClient == null || _sessionId == null) return;

        if (!_tableConverter.IsInTable())
        {
            System.Windows.Forms.MessageBox.Show(
                "Selection is not inside a table or multi-cell range.",
                "LaTeXSnipper",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Information
            );
            return;
        }

        var tablePayload = _tableConverter.ReadSelection();
        if (tablePayload != null)
        {
            _ = _pipeClient.SendAsync(new VstoReadTable
            {
                RequestId = Guid.NewGuid().ToString("N")[..12],
                SessionId = _sessionId,
                TableXml = System.Text.Json.JsonSerializer.Serialize(tablePayload)
            });
        }
    }

    public void OnInsertTable(RibbonControl control)
    {
        if (_pipeClient == null || _sessionId == null) return;

        // Ask Desktop to insert table
        _ = _pipeClient.SendAsync(new VstoOpenEditor
        {
            RequestId = Guid.NewGuid().ToString("N")[..12],
            SessionId = _sessionId
        });
    }

    public void OnFormatTable(RibbonControl control)
    {
        if (_tableConverter == null) return;

        var range = Globals.ThisAddIn.Application.Selection as Microsoft.Office.Interop.Excel.Range;
        if (range != null)
        {
            _tableConverter.FormatTable(range);
        }
    }

    // ---------------------------------------------------------------------------
    // Format group
    // ---------------------------------------------------------------------------

    public void OnFormatSelection(RibbonControl control)
    {
        if (_pipeClient == null || _sessionId == null) return;

        _ = _pipeClient.SendAsync(new VstoReadSelection
        {
            RequestId = Guid.NewGuid().ToString("N")[..12],
            SessionId = _sessionId
        });
    }

    public void OnFormatAll(RibbonControl control)
    {
        if (_pipeClient == null || _sessionId == null) return;

        _ = _pipeClient.SendAsync(new VstoReadSelection
        {
            RequestId = Guid.NewGuid().ToString("N")[..12],
            SessionId = _sessionId
        });
    }

    // ---------------------------------------------------------------------------
    // Tools group
    // ---------------------------------------------------------------------------

    public void OnOpenEditor(RibbonControl control)
    {
        if (_pipeClient == null || _sessionId == null) return;

        _ = _pipeClient.SendAsync(new VstoOpenEditor
        {
            RequestId = Guid.NewGuid().ToString("N")[..12],
            SessionId = _sessionId
        });
    }
}
