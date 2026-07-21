#nullable enable
using System;
using LaTeXSnipper.NativeOffice.Shared;
using InteropWord = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.Host
{
    internal sealed class ConversationImportResult
    {
        internal bool Success { get; set; }
        internal string? ErrorCode { get; set; }
        internal string? Error { get; set; }
    }

    internal sealed class ConversationImporter
    {
        private const int MaximumOperations = 10000;
        private readonly InteropWord.Application _application;

        internal ConversationImporter(InteropWord.Application application)
        {
            _application = application ?? throw new ArgumentNullException(nameof(application));
        }

        internal ConversationImportResult Commit(WordImportPlan plan)
        {
            if (plan == null || !plan.CanCommit || plan.Operations.Count == 0 || plan.Operations.Count > MaximumOperations)
                return Failure("INVALID_IMPORT_PLAN", "The Word import plan is invalid or outside bounds.");

            InteropWord.Document? document = _application.ActiveDocument;
            InteropWord.Range? cursor = _application.Selection?.Range?.Duplicate;
            if (document == null || cursor == null)
                return Failure("NO_WORD_DESTINATION", "No active Word insertion range is available.");
            if (document.ReadOnly)
                return Failure("DESTINATION_READ_ONLY", "The destination Word document is read-only.");

            cursor.Collapse(InteropWord.WdCollapseDirection.wdCollapseStart);
            bool undoStarted = false;
            try
            {
                _application.UndoRecord.StartCustomRecord("Import LaTeXSnipper conversation");
                undoStarted = true;
                EnsureOwnedStyles(document);
                foreach (WordImportOperation operation in plan.Operations)
                    ApplyOperation(document, cursor, operation);
                _application.UndoRecord.EndCustomRecord();
                undoStarted = false;
                cursor.Select();
                return new ConversationImportResult { Success = true };
            }
            catch (Exception error)
            {
                OfficeOperationLog.Failure("commit-conversation-import", "word", plan.ImportId, error);
                if (undoStarted)
                {
                    try { _application.UndoRecord.EndCustomRecord(); }
                    catch (Exception endError) { OfficeOperationLog.Failure("end-conversation-undo-record", "word", plan.ImportId, endError); }
                }
                try { document.Undo(); }
                catch (Exception undoError)
                {
                    OfficeOperationLog.Failure("rollback-conversation-import", "word", plan.ImportId, undoError);
                    return Failure("WORD_IMPORT_ROLLBACK_FAILED", error.Message);
                }
                return Failure("WORD_IMPORT_COMMIT_FAILED", error.Message);
            }
        }

        private static void ApplyOperation(InteropWord.Document document, InteropWord.Range cursor, WordImportOperation operation)
        {
            switch (operation.Kind)
            {
                case "heading":
                    InsertHeading(cursor, operation.Text ?? "", operation.Level ?? 1);
                    return;
                case "message-header":
                case "paragraph":
                case "quote":
                case "code":
                case "horizontal-rule":
                    InsertParagraph(cursor, operation.Text ?? "", operation.Style);
                    return;
                case "list-item":
                    InsertListItem(cursor, operation.Text ?? "", operation.Ordered == true);
                    return;
                case "table":
                    InsertTable(document, cursor, operation.Rows);
                    return;
                case "formula":
                    InsertOmml(cursor, operation.Omml, operation.Display == true);
                    return;
                default:
                    throw new InvalidOperationException($"Unsupported Word import operation: {operation.Kind}");
            }
        }

        private static void InsertParagraph(InteropWord.Range cursor, string text, string? style)
        {
            cursor.Text = text + "\r";
            InteropWord.Range inserted = cursor.Duplicate;
            inserted.End = Math.Max(inserted.Start, inserted.End - 1);
            if (!string.IsNullOrWhiteSpace(style))
            {
                try { inserted.set_Style(style); }
                catch { /* style not found — fall through to normal paragraph */ }
            }
            cursor.Collapse(InteropWord.WdCollapseDirection.wdCollapseEnd);
        }

        /// <summary>
        /// Insert a heading at the specified level using Word's built-in heading styles.
        /// This is more reliable than relying on custom style names from AI.
        /// </summary>
        private static void InsertHeading(InteropWord.Range cursor, string text, uint level)
        {
            cursor.Text = text + "\r";
            InteropWord.Range inserted = cursor.Duplicate;
            inserted.End = Math.Max(inserted.Start, inserted.End - 1);
            try
            {
                // Map level 1-6 to Word's built-in Heading 1-6 styles
                var styleName = $"Heading {Math.Clamp(level, 1, 6)}";
                inserted.set_Style(styleName);
            }
            catch
            {
                // Fallback: apply bold formatting if heading style not available
                inserted.Font.Bold = 1;
                inserted.Font.Size = Math.Max(14f - (float)Math.Clamp(level, 1, 6) * 1.5f, 10f);
            }
            cursor.Collapse(InteropWord.WdCollapseDirection.wdCollapseEnd);
        }

        private static void InsertListItem(InteropWord.Range cursor, string text, bool ordered)
        {
            int start = cursor.Start;
            cursor.Text = text + "\r";
            InteropWord.Range inserted = cursor.Document.Range(start, cursor.End);
            if (ordered) inserted.ListFormat.ApplyNumberDefault();
            else inserted.ListFormat.ApplyBulletDefault();
            cursor.Collapse(InteropWord.WdCollapseDirection.wdCollapseEnd);
        }

        private static void InsertTable(InteropWord.Document document, InteropWord.Range cursor, System.Collections.Generic.List<System.Collections.Generic.List<string>>? rows)
        {
            if (rows == null || rows.Count == 0 || rows[0].Count == 0)
                throw new InvalidOperationException("Table geometry is empty.");
            int columns = rows[0].Count;
            if (rows.Exists(row => row.Count != columns))
                throw new InvalidOperationException("Table geometry is inconsistent.");
            InteropWord.Table table = document.Tables.Add(cursor, rows.Count, columns);
            for (int row = 0; row < rows.Count; row++)
                for (int column = 0; column < columns; column++)
                    table.Cell(row + 1, column + 1).Range.Text = rows[row][column];
            table.AutoFitBehavior(InteropWord.WdAutoFitBehavior.wdAutoFitContent);
            cursor.SetRange(table.Range.End, table.Range.End);
            cursor.InsertParagraphAfter();
            cursor.Collapse(InteropWord.WdCollapseDirection.wdCollapseEnd);
        }

        private static void InsertOmml(InteropWord.Range cursor, string? omml, bool display)
        {
            if (string.IsNullOrWhiteSpace(omml))
                throw new InvalidOperationException("Formula OMML is missing.");
            if (omml.IndexOf("<!DOCTYPE", StringComparison.OrdinalIgnoreCase) >= 0 ||
                omml.IndexOf("<script", StringComparison.OrdinalIgnoreCase) >= 0 ||
                omml.IndexOf("<pkg:package", StringComparison.OrdinalIgnoreCase) >= 0 ||
                omml.IndexOf("Relationship", StringComparison.OrdinalIgnoreCase) >= 0)
                throw new InvalidOperationException("Formula OMML contains forbidden active/package content.");
            int start = cursor.Start;
            cursor.InsertXML(omml);
            cursor.Collapse(InteropWord.WdCollapseDirection.wdCollapseEnd);
            if (display)
            {
                InteropWord.Range formulaRange = cursor.Document.Range(start, cursor.Start);
                formulaRange.ParagraphFormat.Alignment = InteropWord.WdParagraphAlignment.wdAlignParagraphCenter;
                cursor.InsertParagraphAfter();
                cursor.Collapse(InteropWord.WdCollapseDirection.wdCollapseEnd);
            }
        }

        private static void EnsureOwnedStyles(InteropWord.Document document)
        {
            EnsureStyle(document, "LaTeXSnipper Conversation Title", InteropWord.WdStyleType.wdStyleTypeParagraph, true, false);
            EnsureStyle(document, "LaTeXSnipper Message Header", InteropWord.WdStyleType.wdStyleTypeParagraph, true, false);
            EnsureStyle(document, "LaTeXSnipper Quote", InteropWord.WdStyleType.wdStyleTypeParagraph, false, true);
            EnsureStyle(document, "LaTeXSnipper Code Block", InteropWord.WdStyleType.wdStyleTypeParagraph, false, false, "Consolas");
        }

        private static void EnsureStyle(InteropWord.Document document, string name, InteropWord.WdStyleType type, bool bold, bool italic, string? font = null)
        {
            InteropWord.Style? style = null;
            try { style = document.Styles[name]; }
            catch (Exception) { style = document.Styles.Add(name, type); }
            style.Font.Bold = bold ? 1 : 0;
            style.Font.Italic = italic ? 1 : 0;
            if (!string.IsNullOrWhiteSpace(font)) style.Font.Name = font;
        }

        private static ConversationImportResult Failure(string code, string message) =>
            new ConversationImportResult { Success = false, ErrorCode = code, Error = message };
    }
}
