#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;
using W = Microsoft.Office.Interop.Word;
using OmmlValidator = LaTeXSnipper.NativeOffice.Shared.Omml.OmmlValidator;

namespace LaTeXSnipper.Word.Host
{
    internal sealed partial class WordAdapter
    {
        private const string FormulaTagPrefix = "latexsnipper:formula:";
        internal Action<string, string>? CopiedIdentityFingerprintMismatchForTest { get; set; }
        internal Action? CopiedIdentityAfterTagForTest { get; set; }

        private FormulaPayload? ReadManagedAdjacentSelection(W.Range selection)
        {
            if (selection.Start != selection.End) return null;
            W.Range? adjacent = null; W.InlineShapes? shapes = null; W.InlineShape? shape = null; W.Range? owned = null;
            try
            {
                adjacent = selection.Duplicate;
                adjacent.MoveStart(W.WdUnits.wdCharacter, -1); adjacent.MoveEnd(W.WdUnits.wdCharacter, 1);
                shapes = adjacent.InlineShapes;
                if (shapes.Count > 1) throw new HostIdentityReconciliationException("HOST_IDENTITY_SELECTION_AMBIGUOUS",
                    new InvalidOperationException("Cursor is adjacent to multiple objects."));
                if (shapes.Count == 0) return null;
                shape = shapes[1]; owned = shape.Range;
                return ReadManagedFormulaSelection(owned);
            }
            finally { ReleaseLocalComObject(owned); ReleaseLocalComObject(shape); ReleaseLocalComObject(shapes); ReleaseLocalComObject(adjacent); }
        }

        internal FormulaPayload? ReadManagedFormulaSelection(W.Range selection)
        {
            W.ContentControl? selected = null;
            W.ContentControls? controls = null;
            W.ContentControl? parent = null;
            W.Document? document = null;
            try
            {
                var ids = new HashSet<string>(StringComparer.Ordinal);
                parent = selection.ParentContentControl;
                if (parent != null && parent.Tag.StartsWith(FormulaTagPrefix, StringComparison.Ordinal))
                { selected = parent; parent = null; ids.Add(selected.ID); }
                controls = selection.ContentControls;
                for (int index = 1; index <= controls.Count; index++)
                {
                    var value = controls[index];
                    try
                    {
                        if (!value.Tag.StartsWith(FormulaTagPrefix, StringComparison.Ordinal) || !ids.Add(value.ID)) continue;
                        if (selected != null) throw new InvalidOperationException("HOST_IDENTITY_SELECTION_AMBIGUOUS");
                        selected = value; value = null;
                    }
                    finally { ReleaseLocalComObject(value); }
                }
                if (selected == null) return null;
                var owned = selected.Range;
                try
                {
                    if (owned.StoryType != selection.StoryType || selection.Start < owned.Start - 1 || selection.End > owned.End + 1)
                        throw new InvalidOperationException("HOST_IDENTITY_SELECTION_AMBIGUOUS");
                }
                finally { ReleaseLocalComObject(owned); }
                document = selection.Document;
                string formulaId = selected.Tag.Substring(FormulaTagPrefix.Length);
                var source = FormulaDocumentManifest.Read(document, formulaId);
                if (source == null) throw new InvalidOperationException("HOST_IDENTITY_SOURCE_UNAVAILABLE");
                return ReconcileWordControlIdentity(document, selected, source);
            }
            catch (HostIdentityReconciliationException) { throw; }
            catch (Exception error) { throw new HostIdentityReconciliationException("HOST_IDENTITY_READ_FAILED", error); }
            finally
            {
                ReleaseLocalComObject(document); ReleaseLocalComObject(parent);
                ReleaseLocalComObject(controls); ReleaseLocalComObject(selected);
            }
        }

        internal FormulaPayload ReconcileWordControlIdentity(W.Document document, W.ContentControl control, FormulaPayload source)
        {
            W.Range? range = null;
            Microsoft.Office.Core.CustomXMLParts? parts = null;
            W.InlineShapes? shapes = null;
            W.OMaths? maths = null;
            W.InlineShape? image = null;
            object? automation = null;
            try
            {
                string oldTag = FormulaTagPrefix + source.FormulaId;
                if (control.Tag != oldTag) throw new InvalidOperationException("HOST_IDENTITY_TAG_SOURCE_CONFLICT");
                range = control.Range;
                string xml = range.WordOpenXML;
                int start = range.Start, end = range.End;
                var story = range.StoryType;
                string controlId = control.ID, title = control.Title;
                bool lockContents = control.LockContents, lockControl = control.LockContentControl;
                bool legacyUnverifiedSvg = false;
                string mode;
                shapes = range.InlineShapes;
                maths = range.OMaths;
                if (shapes.Count == 0 && maths.Count > 0)
                {
                    mode = "native-omml";
                    if (string.IsNullOrEmpty(source.Omml) || MathText(source.Omml) != MathText(xml) ||
                        MathObjectCount(source.Omml) != MathObjectCount(xml) || !OmmlValidator.ValidateHostReadBack(source.Omml, xml).IsValid)
                        throw new InvalidOperationException("HOST_IDENTITY_NATIVE_SOURCE_CONFLICT");
                }
                else if (shapes.Count == 1 && maths.Count == 0)
                {
                    image = shapes[1];
                    if (image.Type == W.WdInlineShapeType.wdInlineShapeEmbeddedOLEObject)
                    {
                        mode = "ole"; automation = GetOwnedOleAutomationObject(image);
                        if (automation == null || !OleFormulaInterop.VerifyRoundTrip(automation, source))
                            throw new InvalidOperationException("HOST_IDENTITY_OLE_SOURCE_CONFLICT");
                    }
                    // Office 15 PIA omits the modern SVG inline type (17),
                    // observed by the managed SVG host regression. Require its binding.
                    else if (image.Type == W.WdInlineShapeType.wdInlineShapePicture ||
                        (int)image.Type == 17 && !string.IsNullOrEmpty(source.Render?.Svg))
                    {
                        mode = "image";
                        if (source.Source?.WordSvgBinding != null)
                        {
                            if (!WordSvgSourceBinding.Matches(source, xml)) throw new InvalidOperationException("HOST_IDENTITY_IMAGE_SOURCE_CONFLICT");
                        }
                        else if ((int)image.Type == 17 && !string.IsNullOrEmpty(source.Render?.Svg))
                        {
                            // Preserve the prior unverified source read, not permission
                            // to rewrite its identity or manufacture a source binding.
                            legacyUnverifiedSvg = true;
                        }
                        else
                        {
                            var observed = WordPngSourceReader.Read(xml);
                            if (observed == null || string.IsNullOrEmpty(source.Render?.Png) ||
                                !observed.SequenceEqual(FormulaImagePayload.DecodePng(source.Render!.Png!)))
                                throw new InvalidOperationException("HOST_IDENTITY_IMAGE_SOURCE_CONFLICT");
                        }
                    }
                    else throw new InvalidOperationException("HOST_IDENTITY_CARRIER_UNSUPPORTED: inline type=" + (int)image.Type);
                }
                else throw new InvalidOperationException("HOST_IDENTITY_CARRIER_AMBIGUOUS");
                bool inheritedNativeMode = mode == "native-omml" &&
                    (string.IsNullOrEmpty(source.StorageMode) || source.StorageMode == "auto" || source.StorageMode == "native");
                if (source.StorageMode != mode && !inheritedNativeMode) throw new InvalidOperationException("HOST_IDENTITY_MODE_CONFLICT");
                int matchingIds = CountWordControlIds(document, source.FormulaId);
                bool needsIdentity = matchingIds != 1 || !FormulaIdHelper.IsCanonical(source.FormulaId);
                if (mode == "ole" && needsIdentity)
                    throw new InvalidOperationException("HOST_IDENTITY_OLE_COPY_REPAIR_UNSUPPORTED");
                if (needsIdentity && (source.Display == "numbered" || source.Display == "displayNumbered" || source.NumberingTemplate != null))
                    throw new InvalidOperationException("HOST_IDENTITY_NUMBERED_COPY_REPAIR_UNSUPPORTED");
                if (needsIdentity && !legacyUnverifiedSvg) ValidateCopiedSiblingSources(document, controlId, source, mode);
                string? newTag = null;
                string snapshot = IdentityContentFingerprint(xml, oldTag, oldTag);
                bool LayoutAndContentMatch()
                {
                    var current = control.Range;
                    try
                    {
                        string observed = IdentityContentFingerprint(current.WordOpenXML, oldTag, newTag ?? oldTag);
                        if (observed != snapshot) CopiedIdentityFingerprintMismatchForTest?.Invoke(snapshot, observed);
                        return control.ID == controlId && control.Title == title && control.LockContents == lockContents &&
                            control.LockContentControl == lockControl && current.Start == start && current.End == end && current.StoryType == story &&
                            observed == snapshot;
                    }
                    finally { ReleaseLocalComObject(current); }
                }
                parts = document.CustomXMLParts;
                using (var store = FormulaDocumentManifest.OpenReplacementStore(parts))
                    return HostIdentityReconciliation.Reconcile(store, source, "word", mode, DocumentContextId(document),
                        document.ReadOnly || lockContents || lockControl || mode == "ole" || legacyUnverifiedSvg,
                        (entries, id) => CountWordControlIds(document, id),
                        () => control.Tag == oldTag && LayoutAndContentMatch(), metadata => {
                            newTag = FormulaTagPrefix + metadata.FormulaId; control.Tag = newTag;
                            CopiedIdentityAfterTagForTest?.Invoke();
                        }, metadata => control.Tag == FormulaTagPrefix + metadata.FormulaId && LayoutAndContentMatch(), () => {
                            if ((control.Tag != oldTag && control.Tag != newTag) || !LayoutAndContentMatch()) return false;
                            control.Tag = oldTag; return control.Tag == oldTag && LayoutAndContentMatch();
                        });
            }
            catch (HostIdentityReconciliationException) { throw; }
            catch (Exception error) { throw new HostIdentityReconciliationException("HOST_IDENTITY_RECONCILE_FAILED", error); }
            finally
            {
                ReleaseLocalComObject(automation); ReleaseLocalComObject(image); ReleaseLocalComObject(shapes);
                ReleaseLocalComObject(maths); ReleaseLocalComObject(parts); ReleaseLocalComObject(range);
            }
        }

        internal static string MathText(string xml)
        {
            XNamespace m = "http://schemas.openxmlformats.org/officeDocument/2006/math";
            var records = new List<Tuple<int, string, string, StringBuilder>>();
            int mathIndex = 0;
            foreach (var math in ParseIdentityXml(xml).Descendants(m + "oMath"))
            {
                XElement? previousOwner = null;
                string? previousStyle = null;
                foreach (var text in math.Descendants(m + "t"))
                {
                    var run = text.Parent;
                    var owner = run?.Name == m + "r" ? run.Parent : run;
                    if (owner == null) throw new InvalidOperationException("OMML text has no owner.");
                    string path = string.Join("/", owner.AncestorsAndSelf().TakeWhile(node => node != math).Reverse()
                        .Select(node => node.Name + "[" + node.ElementsBeforeSelf(node.Name).Count() + "]"));
                    var properties = run?.Element(m + "rPr");
                    string style = properties == null ? "" : JsonSerializer.Serialize(MathPropertyIdentity(properties));
                    // Word coalesces adjacent runs with equal math properties. Keep
                    // operand/cell ownership and style boundaries, not run count.
                    if (previousOwner == owner && previousStyle == style)
                        records[records.Count - 1].Item4.Append(text.Value);
                    else
                        records.Add(Tuple.Create(mathIndex, path, style, new StringBuilder(text.Value)));
                    previousOwner = owner;
                    previousStyle = style;
                }
                mathIndex++;
            }
            return JsonSerializer.Serialize(records.Select(record => new {
                math = record.Item1, owner = record.Item2, style = record.Item3, text = record.Item4.ToString()
            }).ToArray());
        }

        private static object MathPropertyIdentity(XElement property) => new {
            name = property.Name.ToString(),
            attributes = property.Attributes().Where(attribute => !attribute.IsNamespaceDeclaration)
                .OrderBy(attribute => attribute.Name.ToString(), StringComparer.Ordinal)
                .Select(attribute => new { name = attribute.Name.ToString(), value = attribute.Value }).ToArray(),
            children = property.Elements().Select(MathPropertyIdentity).ToArray(),
            text = string.Concat(property.Nodes().OfType<XText>().Select(value => value.Value))
        };

        private static int CountWordControlIds(W.Document document, string id)
        {
            var matching = document.SelectContentControlsByTag(FormulaTagPrefix + id);
            try { return matching.Count; }
            finally { ReleaseLocalComObject(matching); }
        }

        private static void ValidateCopiedSiblingSources(W.Document document, string selectedId, FormulaPayload source, string mode)
        {
            var matching = document.SelectContentControlsByTag(FormulaTagPrefix + source.FormulaId);
            try
            {
                for (int index = 1; index <= matching.Count; index++)
                {
                    var sibling = matching[index]; W.Range? range = null; W.InlineShapes? shapes = null; W.OMaths? maths = null;
                    try
                    {
                        if (sibling.ID == selectedId) continue;
                        range = sibling.Range; string xml = range.WordOpenXML; shapes = range.InlineShapes; maths = range.OMaths;
                        bool matches = mode == "native-omml" ? shapes.Count == 0 && maths.Count > 0 &&
                            MathText(source.Omml) == MathText(xml) && MathObjectCount(source.Omml) == MathObjectCount(xml) &&
                            OmmlValidator.ValidateHostReadBack(source.Omml, xml).IsValid : shapes.Count == 1 && maths.Count == 0 &&
                            (source.Source?.WordSvgBinding != null ? WordSvgSourceBinding.Matches(source, xml) :
                                !string.IsNullOrEmpty(source.Render?.Png) && (WordPngSourceReader.Read(xml)?.SequenceEqual(
                                    FormulaImagePayload.DecodePng(source.Render!.Png!)) ?? false));
                        if (!matches) throw new InvalidOperationException("HOST_IDENTITY_COPIED_SIBLING_SOURCE_CONFLICT");
                    }
                    finally { ReleaseLocalComObject(maths); ReleaseLocalComObject(shapes); ReleaseLocalComObject(range); ReleaseLocalComObject(sibling); }
                }
            }
            finally { ReleaseLocalComObject(matching); }
        }

        private static int MathObjectCount(string xml)
        {
            XNamespace m = "http://schemas.openxmlformats.org/officeDocument/2006/math";
            return ParseIdentityXml(xml).Descendants(m + "oMath").Count();
        }

        private static string IdentityContentFingerprint(string xml, string oldTag, string newTag)
        {
            // Only the captured control's allowed identity field is ignored.
            var root = ParseIdentityXml(xml);
            XNamespace w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
            foreach (var tag in root.Descendants(w + "tag"))
            {
                var value = tag.Attribute(w + "val");
                if (value != null && (value.Value == oldTag || value.Value == newTag)) value.Value = "LSNO_CAPTURED_IDENTITY";
            }
            return DeleteSourceFingerprint(root.ToString(SaveOptions.DisableFormatting));
        }

        private static XDocument ParseIdentityXml(string xml)
        {
            if (xml.Length > 64 * 1024 * 1024) throw new InvalidOperationException("HOST_IDENTITY_SOURCE_BUDGET_EXCEEDED");
            var settings = new System.Xml.XmlReaderSettings { DtdProcessing = System.Xml.DtdProcessing.Prohibit,
                XmlResolver = null, MaxCharactersInDocument = 64 * 1024 * 1024 };
            using (var input = new System.IO.StringReader(xml))
            using (var reader = System.Xml.XmlReader.Create(input, settings)) return XDocument.Load(reader);
        }
    }
}
