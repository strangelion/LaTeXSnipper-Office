#nullable enable
using System;
using System.Runtime.InteropServices;
using System.Text.Json;
using Office = Microsoft.Office.Core;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata
{
    /// <summary>Required identity/layout state, read without guessed fallback values.</summary>
    public sealed class HostPictureSnapshot
    {
        public int Id { get; private set; }
        private string Name = "", AlternativeText = "", ExpectedMetadata = "", ExpectedName = "";
        private float Left, Top, Width, Height, Rotation, CandidateWidth, CandidateHeight;
        private int ZOrder, Type, HorizontalFlip, VerticalFlip, Aspect, Visible;
        private int? Placement;
        public string OriginalName => Name;
        public string OriginalAlternativeText => AlternativeText;

        public static bool IsPicture(object value)
        {
            dynamic shape = value;
            int type = (int)shape.Type;
            // Office 15 PIA does not name the newer SVG graphic type (28).
            return type == (int)Office.MsoShapeType.msoPicture ||
                type == (int)Office.MsoShapeType.msoLinkedPicture || type == 28;
        }

        public static HostPictureSnapshot Capture(object value, bool excel, string? expectedFormulaId = null)
        {
            dynamic shape = value;
            if (expectedFormulaId != null)
            {
                string name = shape.Name, text = shape.AlternativeText ?? "";
                string? namedId = name.StartsWith("LSNO_", StringComparison.Ordinal) ? name.Substring(5) : null;
                if (FormulaIdHelper.IsCanonical(namedId ?? "") && namedId != expectedFormulaId)
                    throw new InvalidOperationException("HOST_IMAGE_REPLACE_IDENTITY_CONFLICT");
                if (text.StartsWith("{", StringComparison.Ordinal))
                {
                    var metadata = JsonSerializer.Deserialize<FormulaPayload>(text,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (!string.IsNullOrEmpty(metadata?.FormulaId) && metadata!.FormulaId != expectedFormulaId)
                        throw new InvalidOperationException("HOST_IMAGE_REPLACE_IDENTITY_CONFLICT");
                }
            }
            return new HostPictureSnapshot { Id = shape.Id, Name = shape.Name,
                AlternativeText = shape.AlternativeText ?? "", Left = shape.Left, Top = shape.Top,
                Width = shape.Width, Height = shape.Height, Rotation = shape.Rotation,
                ZOrder = shape.ZOrderPosition, Type = (int)shape.Type, HorizontalFlip = (int)shape.HorizontalFlip,
                VerticalFlip = (int)shape.VerticalFlip, Aspect = (int)shape.LockAspectRatio, Visible = (int)shape.Visible,
                Placement = excel ? (int?)shape.Placement : null };
        }

        public static int GetId(object value) => (int)((dynamic)value).Id;

        public static int CountTargets(object values, Func<object, bool> matches, int? excludedId = null)
        {
            dynamic shapes = values;
            int found = 0, count = shapes.Count;
            for (int index = 1; index <= count; index++)
            {
                object shape = shapes.Item(index);
                try { if (GetId(shape) != excludedId && matches(shape)) found++; }
                finally { if (Marshal.IsComObject(shape)) Marshal.ReleaseComObject(shape); }
            }
            return found;
        }

        public static void DeleteAndVerify(object value, object values)
        {
            int id = GetId(value);
            ((dynamic)value).Delete();
            if (CountTargets(values, shape => GetId(shape) == id) != 0)
                throw new InvalidOperationException("HOST_IMAGE_REPLACE_DELETE_UNVERIFIED");
        }

        public bool Matches(object value)
        {
            dynamic shape = value;
            return shape.Name == Name && (shape.AlternativeText ?? "") == AlternativeText && MatchesLayout(value);
        }

        public bool MatchesLayout(object value)
        {
            dynamic shape = value;
            return shape.Id == Id && (int)shape.Type == Type && Near(shape.Left, Left) && Near(shape.Top, Top) &&
                Near(shape.Width, Width) && Near(shape.Height, Height) && Near(shape.Rotation, Rotation) &&
                shape.ZOrderPosition == ZOrder && (int)shape.HorizontalFlip == HorizontalFlip &&
                (int)shape.VerticalFlip == VerticalFlip && (int)shape.LockAspectRatio == Aspect &&
                (int)shape.Visible == Visible && (!Placement.HasValue || (int)shape.Placement == Placement.Value);
        }

        public void Prepare(object value, FormulaPayload metadata)
        {
            dynamic shape = value;
            CandidateWidth = metadata.Render?.WidthPt > 0 ? metadata.Render.WidthPt : Width;
            CandidateHeight = metadata.Render?.HeightPt > 0 ? metadata.Render.HeightPt : Height;
            if (!Finite(CandidateWidth) || !Finite(CandidateHeight) || CandidateWidth <= 0 || CandidateHeight <= 0)
                throw new InvalidOperationException("HOST_IMAGE_REPLACE_DIMENSIONS_INVALID");
            ExpectedName = "LSNO_pending_" + Guid.NewGuid().ToString("N");
            shape.Name = ExpectedName;
            shape.LockAspectRatio = Office.MsoTriState.msoFalse;
            shape.Width = CandidateWidth; shape.Height = CandidateHeight;
            shape.Left = Left; shape.Top = Top; shape.Rotation = Rotation;
            if ((int)shape.HorizontalFlip != HorizontalFlip) shape.Flip(Office.MsoFlipCmd.msoFlipHorizontal);
            if ((int)shape.VerticalFlip != VerticalFlip) shape.Flip(Office.MsoFlipCmd.msoFlipVertical);
            shape.LockAspectRatio = (Office.MsoTriState)Aspect;
            shape.Visible = (Office.MsoTriState)Visible;
            if (Placement.HasValue) shape.Placement = (Microsoft.Office.Interop.Excel.XlPlacement)Placement.Value;
            ExpectedMetadata = OleFormulaInterop.CreateHostMetadataJson(metadata, "image");
            shape.AlternativeText = ExpectedMetadata;
        }

        public void Verify(object value)
        {
            dynamic shape = value;
            if (shape.Id == Id || shape.Name != ExpectedName || shape.AlternativeText != ExpectedMetadata ||
                !Near(shape.Left, Left) || !Near(shape.Top, Top) || !Near(shape.Width, CandidateWidth) ||
                !Near(shape.Height, CandidateHeight) || !Near(shape.Rotation, Rotation) ||
                (int)shape.HorizontalFlip != HorizontalFlip || (int)shape.VerticalFlip != VerticalFlip ||
                (int)shape.LockAspectRatio != Aspect || (int)shape.Visible != Visible ||
                (Placement.HasValue && (int)shape.Placement != Placement.Value))
                throw new InvalidOperationException("HOST_IMAGE_REPLACE_CANDIDATE_UNVERIFIED");
        }

        public void Promote(object value, string formulaId)
        {
            dynamic shape = value;
            ExpectedName = "LSNO_" + formulaId; shape.Name = ExpectedName;
            int moves = 0;
            while (shape.ZOrderPosition > ZOrder)
            {
                if (++moves > 10000) throw new InvalidOperationException("HOST_IMAGE_REPLACE_ZORDER_BUDGET");
                int before = shape.ZOrderPosition;
                shape.ZOrder(Office.MsoZOrderCmd.msoSendBackward);
                if (shape.ZOrderPosition >= before) throw new InvalidOperationException("HOST_IMAGE_REPLACE_ZORDER_UNVERIFIED");
            }
            if (shape.ZOrderPosition != ZOrder) throw new InvalidOperationException("HOST_IMAGE_REPLACE_ZORDER_UNVERIFIED");
        }

        private static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        private static bool Near(float value, float expected) => Finite(value) && Math.Abs(value - expected) <= 0.02f;
    }
}
