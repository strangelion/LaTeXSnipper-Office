#nullable enable
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using W = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.Host
{
    internal sealed partial class WordAdapter
    {
        // Instance-local fault injection, reachable only by the friend test assembly.
        internal Action? SvgUpdateAfterSwapForTest { get; set; }

        private InsertResult ReplaceManagedInlineSvg(W.Document document, FormulaPayload original, FormulaPayload requested)
        {
            if (original.Display != "inline" || requested.Display != "inline" || requested.Render?.Svg == null ||
                requested.Render.Png != null)
                return new InsertResult { Success = false, ErrorCode = "SVG_UPDATE_BOUNDARY_UNSUPPORTED",
                    Error = "Managed SVG updates currently require inline SVG input without a PNG fallback." };
            if (document.ReadOnly || string.IsNullOrWhiteSpace(requested.Render.Svg) ||
                Encoding.UTF8.GetByteCount(requested.Render.Svg) > WordSvgSourceBinding.MaxSvgBytes ||
                !ValidSvgUpdateSize(requested.Render.WidthPt) || !ValidSvgUpdateSize(requested.Render.HeightPt))
                return new InsertResult { Success = false, ErrorCode = "SVG_UPDATE_RENDER_INVALID",
                    Error = "SVG update input or target document is unavailable." };

            W.ContentControls? controls = null;
            W.ContentControl? control = null;
            W.Range? owned = null, target = null, candidateRange = null, backupRange = null;
            W.InlineShapes? shapes = null, scratchShapes = null;
            W.OMaths? equations = null;
            W.InlineShape? oldImage = null, candidate = null, backup = null, updated = null;
            W.Document? scratch = null;
            W.Documents? documents = null;
            W.Font? oldFont = null;
            string temp = "";
            bool changed = false;
            bool committed = false;
            float oldWidth = 0, oldHeight = 0;
            Microsoft.Office.Core.MsoTriState oldAspect = Microsoft.Office.Core.MsoTriState.msoTrue;
            try
            {
                controls = document.SelectContentControlsByTag("latexsnipper:formula:" + original.FormulaId);
                if (controls.Count != 1) throw new InvalidOperationException("SVG_UPDATE_TARGET_AMBIGUOUS");
                control = controls[1]; owned = control.Range; shapes = owned.InlineShapes;
                equations = owned.OMaths;
                if (control.Type != W.WdContentControlType.wdContentControlRichText || control.LockContents ||
                    control.LockContentControl || shapes.Count != 1 || equations.Count != 0 ||
                    !WordSvgSourceBinding.Matches(original, owned.WordOpenXML))
                    throw new InvalidOperationException("SVG_UPDATE_TARGET_CHANGED");
                oldImage = shapes[1]; target = oldImage.Range;
                oldWidth = oldImage.Width; oldHeight = oldImage.Height;
                oldAspect = oldImage.LockAspectRatio;
                var font = target.Font;
                try { oldFont = font.Duplicate; }
                finally { ReleaseLocalComObject(font); }

                // A separate hidden document avoids inserting another SDT at the
                // original control's end boundary. No Selection or clipboard use.
                documents = _application.Documents;
                scratch = documents.Add(Visible: false);
                scratchShapes = scratch.InlineShapes;
                temp = Path.Combine(Path.GetTempPath(), "lsno_svg_update_" + Guid.NewGuid().ToString("N") + ".svg");
                File.WriteAllText(temp, requested.Render.Svg, new UTF8Encoding(false));
                var insertion = scratch.Range(0, 0);
                try { candidate = scratchShapes.AddPicture(temp, LinkToFile: false, SaveWithDocument: true, Range: insertion); }
                finally { ReleaseLocalComObject(insertion); }
                candidateRange = candidate.Range;
                var prepared = CloneSvgPayload(requested);
                prepared.FormulaId = original.FormulaId;
                prepared.StorageMode = "image";
                prepared.Revision = checked(original.Revision + 1);
                prepared.CreatedUtcTicks = original.CreatedUtcTicks;
                prepared.SchemaVersion = original.SchemaVersion;
                prepared.Host ??= original.Host; prepared.DocumentContext ??= original.DocumentContext;
                prepared.ObjectContext ??= original.ObjectContext; prepared.ProtocolVersion ??= original.ProtocolVersion;
                prepared.RequestedRoute ??= original.RequestedRoute; prepared.ActualRoute ??= original.ActualRoute;
                var source = prepared.Source ?? original.Source;
                prepared.Source = new SourceInfo { CoreVersion = source?.CoreVersion ?? "",
                    ConverterVersion = source?.ConverterVersion ?? "", OmmlSha256 = SourceHash.Sha256Hex(prepared.Omml) };
                var candidateBinding = WordSvgSourceBinding.Create(prepared, candidateRange.WordOpenXML);
                if (candidateBinding == null) throw new InvalidOperationException("SVG_UPDATE_CANDIDATE_REJECTED");

                var end = scratch.Content;
                try { backupRange = scratch.Range(end.End - 1, end.End - 1); }
                finally { ReleaseLocalComObject(end); }
                var oldText = target.FormattedText;
                try { backupRange.FormattedText = oldText; }
                finally { ReleaseLocalComObject(oldText); }
                var scratchControls = scratch.ContentControls;
                try
                {
                    if (scratchShapes.Count != 2 || scratchControls.Count != 0)
                        throw new InvalidOperationException("SVG_UPDATE_BACKUP_KIND_INVALID");
                }
                finally { ReleaseLocalComObject(scratchControls); }
                backup = scratchShapes[2];
                ReleaseLocalComObject(backupRange); backupRange = backup.Range;
                if (!WordSvgSourceBinding.Matches(original, backupRange.WordOpenXML))
                    throw new InvalidOperationException("SVG_UPDATE_BACKUP_REJECTED");
                var latest = FormulaDocumentManifest.Read(document, original.FormulaId);
                if (latest == null || JsonSerializer.Serialize(latest) != JsonSerializer.Serialize(original) ||
                    !WordSvgSourceBinding.Matches(original, owned.WordOpenXML))
                    throw new InvalidOperationException("SVG_UPDATE_TARGET_CHANGED");

                // The live candidate range can expand when the backup is appended
                // at its end. Reacquire the single picture, not the combined span.
                ReleaseLocalComObject(candidateRange); candidateRange = candidate.Range;

                changed = true; // A failed COM setter has an unknown mutation outcome.
                var candidateText = candidateRange.FormattedText;
                try { target.FormattedText = candidateText; }
                finally { ReleaseLocalComObject(candidateText); }
                ReleaseLocalComObject(owned); owned = control.Range;
                ReleaseLocalComObject(shapes); shapes = owned.InlineShapes;
                if (shapes.Count != 1) throw new InvalidOperationException("SVG_UPDATE_TARGET_KIND_INVALID:" + shapes.Count);
                updated = shapes[1];
                updated.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoFalse;
                float maximum = InlineSvgMaximumWidth(owned);
                float scale = Math.Min(1, maximum / prepared.Render!.WidthPt);
                updated.Width = prepared.Render.WidthPt * scale;
                updated.Height = prepared.Render.HeightPt * scale;
                updated.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoTrue;
                ApplyWordMediaPresentation(updated, prepared, InsertMode.Inline, true);
                SvgUpdateAfterSwapForTest?.Invoke();
                var current = updated.Range;
                WordSvgBinding? binding;
                try { binding = WordSvgSourceBinding.Create(prepared, current.WordOpenXML); }
                finally { ReleaseLocalComObject(current); }
                if (binding == null || binding.WordSvgSha256 != candidateBinding.WordSvgSha256)
                    throw new InvalidOperationException("SVG_UPDATE_CARRIER_READBACK_FAILED");
                prepared.Source.WordSvgBinding = binding;
                FormulaDocumentManifest.Write(document, prepared);
                var stored = FormulaDocumentManifest.Read(document, original.FormulaId);
                if (stored == null || JsonSerializer.Serialize(stored) != JsonSerializer.Serialize(prepared) ||
                    !WordSvgSourceBinding.Matches(stored, owned.WordOpenXML))
                    throw new InvalidOperationException("SVG_UPDATE_MANIFEST_READBACK_FAILED");
                committed = true;
                return new InsertResult { Success = true, FormulaId = original.FormulaId, StorageMode = "image",
                    Revision = prepared.Revision, RangeStart = (uint)owned.Start, RangeEnd = (uint)owned.End };
            }
            catch (Exception error)
            {
                string code = "SVG_UPDATE_FAILED";
                if (changed && !committed)
                {
                    try
                    {
                        if (control == null || backupRange == null) throw new InvalidOperationException("SVG_UPDATE_BACKUP_UNAVAILABLE");
                        var current = control.Range;
                        try
                        {
                            var currentShapes = current.InlineShapes;
                            try
                            {
                                if (currentShapes.Count != 1) throw new InvalidOperationException("SVG_UPDATE_ROLLBACK_KIND_INVALID");
                                var picture = currentShapes[1];
                                var pictureRange = picture.Range;
                                try
                                {
                                    var backupText = backupRange.FormattedText;
                                    try { pictureRange.FormattedText = backupText; }
                                    finally { ReleaseLocalComObject(backupText); }
                                }
                                finally { ReleaseLocalComObject(pictureRange); ReleaseLocalComObject(picture); }
                            }
                            finally { ReleaseLocalComObject(currentShapes); }
                            ReleaseLocalComObject(current); current = control.Range;
                            currentShapes = current.InlineShapes;
                            try
                            {
                                var restored = currentShapes[1];
                                var restoredRange = restored.Range;
                                try
                                {
                                    restored.LockAspectRatio = Microsoft.Office.Core.MsoTriState.msoFalse;
                                    restored.Width = oldWidth; restored.Height = oldHeight;
                                    restored.LockAspectRatio = oldAspect;
                                    if (oldFont != null) restoredRange.Font = oldFont;
                                }
                                finally { ReleaseLocalComObject(restoredRange); ReleaseLocalComObject(restored); }
                            }
                            finally { ReleaseLocalComObject(currentShapes); }
                            FormulaDocumentManifest.Write(document, original);
                            var restoredPayload = FormulaDocumentManifest.Read(document, original.FormulaId);
                            if (restoredPayload == null || JsonSerializer.Serialize(restoredPayload) != JsonSerializer.Serialize(original) ||
                                !WordSvgSourceBinding.Matches(original, current.WordOpenXML))
                                throw new InvalidOperationException("SVG_UPDATE_ROLLBACK_VERIFY_FAILED");
                        }
                        finally { ReleaseLocalComObject(current); }
                    }
                    catch (Exception rollback)
                    {
                        code = "SVG_UPDATE_ROLLBACK_FAILED";
                        OfficeOperationLog.Failure("rollback-managed-svg", "word", original.FormulaId, rollback);
                    }
                }
                OfficeOperationLog.Failure("update-managed-svg", "word", original.FormulaId, error);
                return new InsertResult { Success = false, ErrorCode = code, Error = error.Message };
            }
            finally
            {
                ReleaseLocalComObject(updated); ReleaseLocalComObject(backup); ReleaseLocalComObject(candidate);
                ReleaseLocalComObject(backupRange); ReleaseLocalComObject(candidateRange); ReleaseLocalComObject(target);
                ReleaseLocalComObject(oldFont); ReleaseLocalComObject(oldImage); ReleaseLocalComObject(shapes);
                ReleaseLocalComObject(equations);
                ReleaseLocalComObject(owned); ReleaseLocalComObject(control); ReleaseLocalComObject(controls);
                ReleaseLocalComObject(scratchShapes);
                try { scratch?.Close(W.WdSaveOptions.wdDoNotSaveChanges); }
                catch (Exception error) { OfficeOperationLog.Failure("close-svg-update-scratch", "word", original.FormulaId, error); }
                ReleaseLocalComObject(scratch); ReleaseLocalComObject(documents);
                // Closing the sole active hidden window can leave Word with no
                // ActiveDocument even though the original document is still open.
                // Do not override another document the user has activated.
                W.Document? active = null;
                try { active = _application.ActiveDocument; }
                catch (COMException error) when (error.HResult == unchecked((int)0x800A1098))
                {
                    try { document.Activate(); }
                    catch (Exception activation) { OfficeOperationLog.Failure("reactivate-svg-update-target", "word", original.FormulaId, activation); }
                }
                catch (Exception error) { OfficeOperationLog.Failure("read-svg-update-active-document", "word", original.FormulaId, error); }
                finally { ReleaseLocalComObject(active); }
                try { if (temp.Length != 0 && File.Exists(temp)) File.Delete(temp); }
                catch (Exception error) { OfficeOperationLog.Failure("delete-svg-update-temp", "word", original.FormulaId, error); }
            }
        }

        private static bool ValidSvgUpdateSize(float value) => !float.IsNaN(value) && !float.IsInfinity(value) && value > 0 && value <= 4096;
        private static float InlineSvgMaximumWidth(W.Range range)
        {
            float available;
            if (Convert.ToBoolean(range.get_Information(W.WdInformation.wdWithInTable)))
            {
                var cells = range.Cells;
                W.Cell? cell = null;
                try { cell = cells[1]; available = cell.Width - cell.LeftPadding - cell.RightPadding; }
                finally { ReleaseLocalComObject(cell); ReleaseLocalComObject(cells); }
            }
            else
            {
                var sections = range.Sections;
                W.Section? section = null;
                W.PageSetup? page = null;
                W.TextColumns? columns = null;
                W.TextColumn? column = null;
                try
                {
                    section = sections[1]; page = section.PageSetup;
                    available = page.PageWidth - page.LeftMargin - page.RightMargin;
                    columns = page.TextColumns;
                    if (columns.Count > 1) { column = columns[1]; available = column.Width; }
                }
                finally
                {
                    ReleaseLocalComObject(column); ReleaseLocalComObject(columns); ReleaseLocalComObject(page);
                    ReleaseLocalComObject(section); ReleaseLocalComObject(sections);
                }
            }
            var paragraph = range.ParagraphFormat;
            try { available -= Math.Max(0, paragraph.LeftIndent) + Math.Max(0, paragraph.RightIndent) + 4; }
            finally { ReleaseLocalComObject(paragraph); }
            if (float.IsNaN(available) || float.IsInfinity(available) || available < 1)
                throw new InvalidOperationException("SVG_UPDATE_CONTAINER_UNAVAILABLE");
            return available;
        }
        private static FormulaPayload CloneSvgPayload(FormulaPayload payload) =>
            JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(payload)) ?? throw new InvalidOperationException("SVG_UPDATE_PAYLOAD_INVALID");
    }
}
