using System;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Word
{
    /// <summary>A read-only viewer bound to the exact request, document and PNG.</summary>
    internal sealed class PngSourceDialog : Form
    {
        private readonly VstoReadPngSource _request;
        private readonly Label _status = new Label { Dock = DockStyle.Fill, AutoSize = false };
        private readonly ListBox _candidates = new ListBox { Dock = DockStyle.Fill, IntegralHeight = false };
        private readonly TextBox _source = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true,
            ScrollBars = ScrollBars.Both, WordWrap = false, Font = new Font("Consolas", 11) };
        private readonly Button _copy = new Button { AutoSize = true, Enabled = false };
        private readonly Timer _timeout = new Timer { Interval = 20000 };
        private bool _finished;

        internal PngSourceDialog(VstoReadPngSource request)
        {
            _request = request;
            Text = RibbonLocalizer.GetString("PngSourceTitle");
            Width = 760; Height = 580; MinimumSize = new Size(520, 420);
            StartPosition = FormStartPosition.CenterParent;
            AutoScaleMode = AutoScaleMode.Dpi;
            ShowInTaskbar = false;
            BackColor = Color.FromArgb(240, 246, 255);
            Font = new Font("Segoe UI", 10);
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, RowCount = 4 };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 76));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
            _status.Text = RibbonLocalizer.GetString("PngSourceLoading");
            _copy.Text = RibbonLocalizer.GetString("PngSourceCopy");
            var close = new Button { Text = RibbonLocalizer.GetString("PngSourceClose"), AutoSize = true, DialogResult = DialogResult.Cancel };
            close.Click += (_, __) => Close();
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft };
            buttons.Controls.Add(close); buttons.Controls.Add(_copy);
            layout.Controls.Add(_status, 0, 0); layout.Controls.Add(_candidates, 0, 1);
            layout.Controls.Add(_source, 0, 2); layout.Controls.Add(buttons, 0, 3);
            Controls.Add(layout); CancelButton = close;
            _candidates.SelectedIndexChanged += (_, __) => {
                var item = _candidates.SelectedItem as CandidateItem;
                _source.Text = item?.Value.Source ?? "";
                _copy.Enabled = item != null;
            };
            _copy.Click += (_, __) => {
                try { if (_source.Text.Length != 0) Clipboard.SetText(_source.Text); }
                catch (Exception) { _status.Text = RibbonLocalizer.GetString("PngSourceCopyFailed"); }
            };
            _timeout.Tick += (_, __) => Fail("PNG_SOURCE_TIMEOUT");
            _timeout.Start();
        }

        internal void Complete(DesktopPngSourceResult result)
        {
            if (_finished || IsDisposed || result.RequestId != _request.RequestId || result.SessionId != _request.SessionId ||
                result.DocumentContextId != _request.DocumentContextId || result.CarrierSha256 != _request.CarrierSha256) return;
            if (!result.Success) { Fail(result.ErrorCode ?? "PNG_SOURCE_REJECTED"); return; }
            if (result.Candidates == null || result.Candidates.Count > 272 || result.Candidates.Any(c =>
                c == null || c.Source == null || c.Source.Length > 256 * 1024 || c.Provenance == null ||
                c.Provenance.Length > 512 || (c.Format != "latex" && c.Format != "mathml" && c.Format != "omml")))
            { Fail("PNG_SOURCE_LIMIT"); return; }
            _finished = true; _timeout.Stop();
            _status.Text = RibbonLocalizer.GetString(result.Candidates.Count == 0 ? "PngSourceEmpty" : result.Conflict ? "PngSourceConflict" : "PngSourceDeclared");
            foreach (var candidate in result.Candidates) _candidates.Items.Add(new CandidateItem(candidate));
            // Conflicting candidates require an explicit choice.
            if (!result.Conflict && _candidates.Items.Count != 0) _candidates.SelectedIndex = 0;
        }

        internal void Fail(string code)
        {
            if (_finished || IsDisposed) return;
            _finished = true; _timeout.Stop();
            _status.Text = RibbonLocalizer.GetString("PngSourceFailed") + "\r\n" + code;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) _timeout.Dispose();
            base.Dispose(disposing);
        }

        private sealed class CandidateItem
        {
            internal readonly FormulaSourceCandidate Value;
            internal CandidateItem(FormulaSourceCandidate value) { Value = value; }
            public override string ToString() => Value.Format.ToUpperInvariant() + "  -  " + Value.Provenance;
        }

        internal sealed class WordWindow : IWin32Window
        {
            public IntPtr Handle { get; }
            internal WordWindow(int handle) { Handle = new IntPtr(handle); }
        }
    }
}
