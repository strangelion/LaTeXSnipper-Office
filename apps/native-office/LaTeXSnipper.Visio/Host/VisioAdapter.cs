#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.Visio.Model;
using VisioInterop = Microsoft.Office.Interop.Visio;

namespace LaTeXSnipper.Visio.Host
{
    internal sealed class VisioAdapter : ICommandHostAdapter
    {
        private const short LocalOnly = 0;
        private const short UserSection = (short)VisioInterop.VisSectionIndices.visSectionUser;
        private const short DefaultRowTag = (short)VisioInterop.VisRowTags.visTagDefault;
        private readonly VisioInterop.Application _application;
        private readonly Dictionary<int, string> _unsavedDocumentIds = new Dictionary<int, string>();

        public VisioAdapter(VisioInterop.Application application)
        {
            _application = application ?? throw new ArgumentNullException(nameof(application));
        }

        public string HostType => "visio";

        public string GetCurrentContextId()
        {
            VisioInterop.Document document = _application.ActiveDocument;
            VisioInterop.Page page = _application.ActivePage;
            if (document == null || page == null) return "visio:none:none";
            string identity = GetDocumentIdentity(document);
            return VisioContextIdentity.Compose(identity, page.ID);
        }

        public string? GetCurrentDocumentTitle() => _application.ActiveDocument?.Name;

        public InsertResult InsertFormula(FormulaPayload payload, InsertMode mode)
        {
            if (payload == null) return Failure("VISIO_INVALID_PAYLOAD", "Formula payload is required.");
            VisioInterop.Page page = _application.ActivePage;
            if (page == null) return Failure("VISIO_NO_ACTIVE_PAGE", "No active Visio page.");
            if (string.Equals(payload.StorageMode, "ole", StringComparison.OrdinalIgnoreCase))
                return Failure("VISIO_OLE_EXPERIMENTAL", "Visio OLE formula objects are not available in the initial release.");
            if (string.Equals(payload.StorageMode, "native", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(payload.StorageMode, "native-omml", StringComparison.OrdinalIgnoreCase))
                return Failure("VISIO_NATIVE_TEXT_UNAVAILABLE", "Visio does not provide a native OMML insertion mode.");

            try
            {
                EnsureCanonicalUniqueId(page, payload);
                VisioInterop.Shape shape = ImportCandidate(page, payload, out string actualStorage, out string? fallbackReason);
                try
                {
                    var placement = GetCenteredPlacement(page, payload);
                    ApplyPlacement(shape, placement);
                    WriteMetadata(shape, payload);
                    FormulaPayload verified = ReadMetadata(shape);
                    if (!string.Equals(verified.FormulaId, payload.FormulaId, StringComparison.Ordinal))
                        throw new InvalidDataException("Visio metadata readback formulaId mismatch.");
                    TrySetName(shape, payload.FormulaId);
                    return new InsertResult
                    {
                        Success = true,
                        FormulaId = payload.FormulaId,
                        ActualStorageMode = actualStorage,
                        FallbackReason = fallbackReason
                    };
                }
                catch
                {
                    try { shape.Delete(); } catch (Exception cleanupError) { OfficeOperationLog.Failure("cleanup-invalid-candidate", "visio", payload.FormulaId, cleanupError); }
                    throw;
                }
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("insert-formula", "visio", payload.FormulaId, ex);
                return Failure("VISIO_INSERT_FAILED", ex.Message);
            }
        }

        public FormulaPayload? ReadSelection()
        {
            try
            {
                VisioInterop.Shape? shape = GetSingleSelectedShape();
                if (shape == null || !HasMetadata(shape)) return null;
                FormulaPayload payload = ReadMetadata(shape);
                return RepairCopiedFormulaIdIfNeeded(shape, payload);
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("read-selection", "visio", null, ex);
                return null;
            }
        }

        public bool DeleteCurrent()
        {
            VisioInterop.Shape? shape = GetSingleSelectedShape();
            if (shape == null || !HasMetadata(shape)) return false;
            try { shape.Delete(); return true; }
            catch (Exception ex) { OfficeOperationLog.Failure("delete-selected-formula", "visio", null, ex); return false; }
        }

        public bool DeleteFormula(string formulaId)
        {
            VisioInterop.Shape? shape = GetSingleSelectedShape();
            if (shape == null || !HasMetadata(shape)) return false;
            try
            {
                FormulaPayload payload = ReadMetadata(shape);
                if (!string.Equals(payload.FormulaId, formulaId, StringComparison.Ordinal)) return false;
                shape.Delete();
                return true;
            }
            catch (Exception ex) { OfficeOperationLog.Failure("delete-formula", "visio", formulaId, ex); return false; }
        }

        public bool ReplaceFormula(string formulaId, FormulaPayload payload)
        {
            VisioInterop.Shape? original = GetSingleSelectedShape();
            VisioInterop.Page page = _application.ActivePage;
            if (original == null || page == null || !HasMetadata(original)) return false;
            try
            {
                if (original.ContainingShape != null)
                    throw new InvalidOperationException("VISIO_GROUPED_UPDATE_UNSAFE: grouped formula replacement is not supported.");
                FormulaPayload current = ReadMetadata(original);
                if (!string.Equals(current.FormulaId, formulaId, StringComparison.Ordinal)) return false;
                if (payload.Revision != current.Revision)
                    throw new InvalidOperationException("VISIO_REVISION_CONFLICT: selected formula revision changed before replacement.");
                payload.FormulaId = formulaId;
                payload.Revision = checked(current.Revision + 1);
                VisioPlacement placement = CapturePlacement(original);

                VisioReplacementTransaction.Replace(
                    () => ImportCandidate(page, payload, out _, out _),
                    candidate =>
                    {
                        ApplyPlacement(candidate, VisioPlacementMath.PreserveTransform(placement,
                            PositiveOr(payload.Render?.WidthPt, placement.Width * VisioPlacementMath.PointsPerInch),
                            PositiveOr(payload.Render?.HeightPt, placement.Height * VisioPlacementMath.PointsPerInch)));
                        WriteMetadata(candidate, payload);
                        if (ReadMetadata(candidate).Revision != payload.Revision)
                            throw new InvalidDataException("Visio metadata revision readback mismatch.");
                        TrySetName(candidate, formulaId);
                    },
                    original.Delete,
                    candidate => candidate.Delete());
                return true;
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("replace-formula", "visio", formulaId, ex);
                return false;
            }
        }

        public CommandResultMessage Execute(CommandMessage cmd)
        {
            return CommandResultMessage.Failure(cmd?.RequestId ?? "", "Use Native Office protocol v3 document commands for Visio.");
        }

        private VisioInterop.Shape ImportCandidate(VisioInterop.Page page, FormulaPayload payload, out string actualStorage, out string? fallbackReason)
        {
            VisioRenderStrategy strategy = VisioStorageModePolicy.Resolve(payload.StorageMode);
            if (strategy == VisioRenderStrategy.Image)
            {
                if (string.IsNullOrWhiteSpace(payload.Render?.Png))
                    throw new InvalidDataException("VISIO_IMAGE_PNG_REQUIRED: image mode requires a PNG render payload.");
                using (var temp = VisioOwnedTempFile.FromPng(payload.Render!.Png!))
                {
                    actualStorage = "image-png";
                    fallbackReason = null;
                    return page.Import(temp.Path);
                }
            }

            bool requiresVector = strategy == VisioRenderStrategy.Vector;
            Exception? svgError = null;
            if (!string.IsNullOrWhiteSpace(payload.Render?.Svg))
            {
                try
                {
                    string svg = payload.Render!.Svg!;
                    using (var temp = VisioOwnedTempFile.FromSvg(svg))
                    {
                        actualStorage = "image-svg";
                        fallbackReason = null;
                        return page.Import(temp.Path);
                    }
                }
                catch (Exception ex)
                {
                    svgError = ex;
                    if (requiresVector)
                        throw new InvalidDataException("VISIO_VECTOR_IMPORT_FAILED: strict vector mode requires successful SVG import.", ex);
                    OfficeOperationLog.Failure("import-svg-fallback-png", "visio", payload.FormulaId, ex);
                }
            }
            else if (requiresVector)
            {
                throw new InvalidDataException("VISIO_VECTOR_SVG_REQUIRED: strict vector mode requires an SVG render payload.");
            }
            if (!string.IsNullOrWhiteSpace(payload.Render?.Png))
            {
                string png = payload.Render!.Png!;
                using (var temp = VisioOwnedTempFile.FromPng(png))
                {
                    actualStorage = "image-png";
                    fallbackReason = svgError == null ? "VISIO_SVG_MISSING" : "VISIO_SVG_IMPORT_FAILED";
                    return page.Import(temp.Path);
                }
            }
            throw new InvalidDataException(svgError == null
                ? "Formula render payload contains neither SVG nor PNG."
                : "SVG import failed and no PNG fallback is available.", svgError);
        }

        private static VisioPlacement GetCenteredPlacement(VisioInterop.Page page, FormulaPayload payload)
        {
            double pageWidth = page.PageSheet.CellsU["PageWidth"].ResultIU;
            double pageHeight = page.PageSheet.CellsU["PageHeight"].ResultIU;
            return VisioPlacementMath.CenterOnPage(pageWidth, pageHeight,
                PositiveOr(payload.Render?.WidthPt, 120), PositiveOr(payload.Render?.HeightPt, 30));
        }

        private static VisioPlacement CapturePlacement(VisioInterop.Shape shape) => new VisioPlacement(
            shape.CellsU["PinX"].ResultIU,
            shape.CellsU["PinY"].ResultIU,
            shape.CellsU["Width"].ResultIU,
            shape.CellsU["Height"].ResultIU,
            shape.CellsU["Angle"].ResultIU,
            ReadOptionalCell(shape, "FlipX"),
            ReadOptionalCell(shape, "FlipY"));

        private static void ApplyPlacement(VisioInterop.Shape shape, VisioPlacement placement)
        {
            shape.CellsU["PinX"].ResultIU = placement.PinX;
            shape.CellsU["PinY"].ResultIU = placement.PinY;
            shape.CellsU["Width"].ResultIU = placement.Width;
            shape.CellsU["Height"].ResultIU = placement.Height;
            shape.CellsU["Angle"].ResultIU = placement.Angle;
            WriteOptionalCell(shape, "FlipX", placement.FlipX);
            WriteOptionalCell(shape, "FlipY", placement.FlipY);
        }

        private static double ReadOptionalCell(VisioInterop.Shape shape, string cellName) =>
            shape.CellExistsU[cellName, LocalOnly] != 0 ? shape.CellsU[cellName].ResultIU : 0.0;

        private static void WriteOptionalCell(VisioInterop.Shape shape, string cellName, double value)
        {
            if (shape.CellExistsU[cellName, LocalOnly] != 0)
                shape.CellsU[cellName].ResultIU = value;
        }

        private static void WriteMetadata(VisioInterop.Shape shape, FormulaPayload payload)
        {
            string json = JsonSerializer.Serialize(payload);
            EncodedVisioMetadata encoded = VisioFormulaMetadataCodec.Encode(json);
            SetUserCell(shape, "LaTeXSnipperSchemaVersion", encoded.SchemaVersion.ToString(System.Globalization.CultureInfo.InvariantCulture));
            SetUserString(shape, "LaTeXSnipperFormulaId", payload.FormulaId);
            SetUserCell(shape, "LaTeXSnipperRevision", payload.Revision.ToString(System.Globalization.CultureInfo.InvariantCulture));
            SetUserCell(shape, "LaTeXSnipperPayloadChunkCount", encoded.ChunkCount.ToString(System.Globalization.CultureInfo.InvariantCulture));
            SetUserString(shape, "LaTeXSnipperPayloadSha256", encoded.Sha256);
            for (int i = 0; i < encoded.Chunks.Count; i++)
                SetUserString(shape, "LaTeXSnipperPayload" + i.ToString("D2"), encoded.Chunks[i]);
        }

        private static FormulaPayload ReadMetadata(VisioInterop.Shape shape)
        {
            int schema = ReadUserInt(shape, "LaTeXSnipperSchemaVersion");
            int chunkCount = ReadUserInt(shape, "LaTeXSnipperPayloadChunkCount");
            string sha256 = ReadUserString(shape, "LaTeXSnipperPayloadSha256");
            var chunks = Enumerable.Range(0, chunkCount)
                .Select(i => ReadUserString(shape, "LaTeXSnipperPayload" + i.ToString("D2"))).ToArray();
            string json = VisioFormulaMetadataCodec.Decode(schema, chunkCount, sha256, chunks);
            FormulaPayload? payload = JsonSerializer.Deserialize<FormulaPayload>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (payload == null || !FormulaIdHelper.IsCanonical(payload.FormulaId))
                throw new InvalidDataException("Visio formula metadata has an invalid formulaId.");
            if (payload.Revision < 0) throw new InvalidDataException("Visio formula metadata has a negative revision.");
            return payload;
        }

        private FormulaPayload RepairCopiedFormulaIdIfNeeded(VisioInterop.Shape selected, FormulaPayload payload)
        {
            VisioInterop.Page page = _application.ActivePage;
            if (page == null) return payload;
            var matches = new List<VisioInterop.Shape>();
            foreach (VisioInterop.Shape shape in page.Shapes)
            {
                try { if (HasMetadata(shape) && ReadUserString(shape, "LaTeXSnipperFormulaId") == payload.FormulaId) matches.Add(shape); }
                catch (Exception ex) { OfficeOperationLog.Failure("scan-formula-id", "visio", payload.FormulaId, ex); }
            }
            int[] matchingIds = matches.Select(shape => shape.ID).ToArray();
            if (!VisioContextIdentity.ShouldReassignCopiedFormulaId(selected.ID, matchingIds)) return payload;
            payload.FormulaId = FormulaIdHelper.NewId();
            payload.Revision = 0;
            WriteMetadata(selected, payload);
            TrySetName(selected, payload.FormulaId);
            OfficeOperationLog.Event("reassign-copied-formula-id", "visio", payload.FormulaId);
            return payload;
        }

        private static bool HasMetadata(VisioInterop.Shape shape) =>
            shape.CellExistsU["User.LaTeXSnipperSchemaVersion", LocalOnly] != 0 &&
            shape.CellExistsU["User.LaTeXSnipperFormulaId", LocalOnly] != 0;

        private static void SetUserCell(VisioInterop.Shape shape, string rowName, string formula)
        {
            string cellName = "User." + rowName;
            if (shape.CellExistsU[cellName, LocalOnly] == 0)
                shape.AddNamedRow(UserSection, rowName, DefaultRowTag);
            shape.CellsU[cellName].FormulaU = formula;
        }

        private static void SetUserString(VisioInterop.Shape shape, string rowName, string value) =>
            SetUserCell(shape, rowName, VisioFormulaMetadataCodec.QuoteShapeSheetString(value));

        private static string ReadUserString(VisioInterop.Shape shape, string rowName) =>
            shape.CellsU["User." + rowName].ResultStrU[(short)VisioInterop.VisUnitCodes.visNoCast];

        private static int ReadUserInt(VisioInterop.Shape shape, string rowName)
        {
            double value = shape.CellsU["User." + rowName].ResultIU;
            if (value < 0 || value > int.MaxValue || Math.Abs(value - Math.Round(value)) > 0.0001)
                throw new InvalidDataException("Invalid integer ShapeSheet value: " + rowName);
            return checked((int)Math.Round(value));
        }

        private VisioInterop.Shape? GetSingleSelectedShape()
        {
            VisioInterop.Selection? selection = _application.ActiveWindow?.Selection;
            if (selection == null || selection.Count != 1) return null;
            return selection[1];
        }

        private static void EnsureCanonicalUniqueId(VisioInterop.Page page, FormulaPayload payload)
        {
            if (!FormulaIdHelper.IsCanonical(payload.FormulaId) || ContainsFormulaId(page, payload.FormulaId))
                payload.FormulaId = FormulaIdHelper.NewId();
            if (payload.Revision < 0) payload.Revision = 0;
        }

        private static bool ContainsFormulaId(VisioInterop.Page page, string formulaId)
        {
            foreach (VisioInterop.Shape shape in page.Shapes)
            {
                try { if (HasMetadata(shape) && ReadUserString(shape, "LaTeXSnipperFormulaId") == formulaId) return true; }
                catch (Exception ex) { OfficeOperationLog.Failure("check-duplicate-formula-id", "visio", formulaId, ex); }
            }
            return false;
        }

        private string GetDocumentIdentity(VisioInterop.Document document)
        {
            string fullName = document.FullName;
            if (!string.IsNullOrWhiteSpace(fullName) && Path.IsPathRooted(fullName))
            {
                return VisioContextIdentity.ForSavedDocument(fullName);
            }
            if (!_unsavedDocumentIds.TryGetValue(document.ID, out string identity))
            {
                identity = "unsaved-" + Guid.NewGuid().ToString("N");
                _unsavedDocumentIds[document.ID] = identity;
            }
            return identity;
        }

        public void ForgetDocument(VisioInterop.Document document)
        {
            if (document != null) _unsavedDocumentIds.Remove(document.ID);
        }

        private static void TrySetName(VisioInterop.Shape shape, string formulaId)
        {
            try { shape.NameU = "LSNO_" + formulaId; }
            catch (Exception ex) { OfficeOperationLog.Failure("set-shape-name", "visio", formulaId, ex); }
        }

        private static double PositiveOr(float? value, double fallback) => value.HasValue && value.Value > 0 ? value.Value : fallback;
        private static InsertResult Failure(string code, string message) => new InsertResult { Success = false, ErrorCode = code, Error = message };
    }

    internal sealed class InsertResult
    {
        public bool Success { get; set; }
        public string? FormulaId { get; set; }
        public string? ActualStorageMode { get; set; }
        public string? FallbackReason { get; set; }
        public string? ErrorCode { get; set; }
        public string? Error { get; set; }
    }
}
