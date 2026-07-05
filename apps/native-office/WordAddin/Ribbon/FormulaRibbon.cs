using Microsoft.Office.Tools.Ribbon;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Word.Metadata;

namespace LaTeXSnipper.NativeOffice.Word.Ribbon;

public partial class FormulaRibbon
{
    private WordAdapter? _adapter;
    private PipeClient? _pipeClient;
    private string? _sessionId;
    private NumberingManager? _numbering;
    private ReferenceManager? _reference;
    private TableConverter? _tableConverter;

    private void FormulaRibbon_Load(object sender, RibbonUIEventArgs e)
    {
        // Get references from ThisAddIn
        var addIn = Globals.ThisAddIn;
        // These would be set during ThisAddIn initialization
    }

    public void Initialize(WordAdapter adapter, PipeClient pipeClient, string sessionId)
    {
        _adapter = adapter;
        _pipeClient = pipeClient;
        _sessionId = sessionId;
        _numbering = new NumberingManager(Globals.ThisAddIn.Application);
        _reference = new ReferenceManager(Globals.ThisAddIn.Application, _numbering);
        _tableConverter = new TableConverter(Globals.ThisAddIn.Application);
    }

    // ---------------------------------------------------------------------------
    // Formula group
    // ---------------------------------------------------------------------------

    public void OnInsertInline(RibbonControl control)
    {
        SendInsertCommand(InsertMode.Inline);
    }

    public void OnInsertDisplay(RibbonControl control)
    {
        SendInsertCommand(InsertMode.Display);
    }

    public void OnInsertNumbered(RibbonControl control)
    {
        SendInsertCommand(InsertMode.DisplayNumbered);
    }

    private void SendInsertCommand(InsertMode mode)
    {
        if (_adapter == null || _pipeClient == null || _sessionId == null) return;

        // Read current selection to get formula data
        var selection = _adapter.ReadSelection();
        if (selection == null)
        {
            // No formula in selection — ask Desktop to insert from editor
            _ = _pipeClient.SendAsync(new VstoOpenEditor
            {
                RequestId = Guid.NewGuid().ToString("N")[..12],
                SessionId = _sessionId
            });
            return;
        }

        // Send READ_SELECTION to Desktop so it can populate the editor
        _ = _pipeClient.SendAsync(new VstoReadSelection
        {
            RequestId = Guid.NewGuid().ToString("N")[..12],
            SessionId = _sessionId,
            RangeXml = selection.Omml
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
    }

    // ---------------------------------------------------------------------------
    // Numbering group
    // ---------------------------------------------------------------------------

    public void OnInsertChapter(RibbonControl control)
    {
        if (_numbering == null) return;

        var success = _numbering.InsertChapterSeparator();
        if (!success)
        {
            System.Windows.Forms.MessageBox.Show(
                "Failed to insert chapter separator.",
                "LaTeXSnipper",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Warning
            );
        }
    }

    public void OnInsertSection(RibbonControl control)
    {
        if (_numbering == null) return;

        var success = _numbering.InsertSectionSeparator();
        if (!success)
        {
            System.Windows.Forms.MessageBox.Show(
                "Failed to insert section separator.",
                "LaTeXSnipper",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Warning
            );
        }
    }

    public void OnRenumber(RibbonControl control)
    {
        if (_numbering == null || _reference == null) return;

        var result = _numbering.RenumberAll();
        if (result.Success)
        {
            // Update all cross-reference fields
            _reference.UpdateAllReferences();

            System.Windows.Forms.MessageBox.Show(
                $"Renumbered {result.Count} formulas.",
                "LaTeXSnipper",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Information
            );
        }
        else
        {
            System.Windows.Forms.MessageBox.Show(
                $"Renumber failed: {result.Error}",
                "LaTeXSnipper",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Error
            );
        }
    }

    public void OnInsertReference(RibbonControl control)
    {
        if (_reference == null || _adapter == null) return;

        // Get list of referenceable formulas
        var formulas = _reference.GetReferenceableFormulas();
        if (formulas.Count == 0)
        {
            System.Windows.Forms.MessageBox.Show(
                "No numbered formulas found in the document.",
                "LaTeXSnipper",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Information
            );
            return;
        }

        // Show selection dialog
        var dialog = new ReferenceSelectionDialog(formulas);
        var result = dialog.ShowDialog();
        if (result == System.Windows.Forms.DialogResult.OK && dialog.SelectedFormula != null)
        {
            var success = _reference.InsertReference(
                dialog.SelectedFormula.FormulaId,
                dialog.ReferenceType
            );

            if (!success)
            {
                System.Windows.Forms.MessageBox.Show(
                    "Failed to insert reference.",
                    "LaTeXSnipper",
                    System.Windows.Forms.MessageBoxButtons.OK,
                    System.Windows.Forms.MessageBoxIcon.Warning
                );
            }
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
                "Selection is not inside a table.",
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
        // Table insertion is triggered from Desktop
        if (_pipeClient == null || _sessionId == null) return;
        _ = _pipeClient.SendAsync(new VstoOpenEditor
        {
            RequestId = Guid.NewGuid().ToString("N")[..12],
            SessionId = _sessionId
        });
    }

    // ---------------------------------------------------------------------------
    // Format group
    // ---------------------------------------------------------------------------

    public void OnFormatSelection(RibbonControl control)
    {
        if (_adapter == null || _pipeClient == null || _sessionId == null) return;

        var selection = _adapter.ReadSelection();
        if (selection != null)
        {
            _ = _pipeClient.SendAsync(new VstoReadSelection
            {
                RequestId = Guid.NewGuid().ToString("N")[..12],
                SessionId = _sessionId,
                RangeXml = selection.Omml
            });
        }
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

// ---------------------------------------------------------------------------
// Reference selection dialog
// ---------------------------------------------------------------------------

/// <summary>
/// Simple dialog for selecting a formula to reference.
/// </summary>
internal class ReferenceSelectionDialog : System.Windows.Forms.Form
{
    private readonly System.Windows.Forms.ListBox _listBox;
    private readonly System.Windows.Forms.ComboBox _typeCombo;
    private readonly System.Windows.Forms.Button _okButton;
    private readonly System.Windows.Forms.Button _cancelButton;
    private readonly List<ReferenceableFormula> _formulas;

    public ReferenceableFormula? SelectedFormula { get; private set; }
    public string ReferenceType => _typeCombo.SelectedItem?.ToString() ?? "ref";

    public ReferenceSelectionDialog(List<ReferenceableFormula> formulas)
    {
        _formulas = formulas;

        Text = "Insert Cross-Reference";
        Size = new System.Drawing.Size(400, 350);
        StartPosition = System.Windows.Forms.FormStartPosition.CenterParent;
        FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        var label = new System.Windows.Forms.Label
        {
            Text = "Select formula to reference:",
            Dock = System.Windows.Forms.DockStyle.Top,
            Height = 25
        };

        _listBox = new System.Windows.Forms.ListBox
        {
            Dock = System.Windows.Forms.DockStyle.Top,
            Height = 200
        };

        foreach (var formula in formulas)
        {
            _listBox.Items.Add($"Eq. ({formula.Number}) - {formula.FormulaId[..8]}...");
        }

        var typeLabel = new System.Windows.Forms.Label
        {
            Text = "Reference type:",
            Dock = System.Windows.Forms.DockStyle.Top,
            Height = 25
        };

        _typeCombo = new System.Windows.Forms.ComboBox
        {
            Dock = System.Windows.Forms.DockStyle.Top,
            DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList
        };
        _typeCombo.Items.AddRange(new object[] { "ref", "page", "number" });
        _typeCombo.SelectedIndex = 0;

        _okButton = new System.Windows.Forms.Button
        {
            Text = "OK",
            DialogResult = System.Windows.Forms.DialogResult.OK,
            Dock = System.Windows.Forms.DockStyle.Right,
            Width = 80
        };
        _okButton.Click += (s, e) =>
        {
            if (_listBox.SelectedIndex >= 0)
            {
                SelectedFormula = _formulas[_listBox.SelectedIndex];
            }
        };

        _cancelButton = new System.Windows.Forms.Button
        {
            Text = "Cancel",
            DialogResult = System.Windows.Forms.DialogResult.Cancel,
            Dock = System.Windows.Forms.DockStyle.Right,
            Width = 80
        };

        Controls.Add(_typeCombo);
        Controls.Add(typeLabel);
        Controls.Add(_listBox);
        Controls.Add(label);
        Controls.Add(_okButton);
        Controls.Add(_cancelButton);

        AcceptButton = _okButton;
        CancelButton = _cancelButton;
    }
}
