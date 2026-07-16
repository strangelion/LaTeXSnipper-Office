#nullable enable
using System;

namespace LaTeXSnipper.Visio.Model
{
    internal readonly struct VisioPlacement
    {
        public VisioPlacement(double pinX, double pinY, double width, double height, double angle,
            double flipX = 0.0, double flipY = 0.0)
        {
            PinX = pinX;
            PinY = pinY;
            Width = width;
            Height = height;
            Angle = angle;
            FlipX = flipX;
            FlipY = flipY;
        }

        public double PinX { get; }
        public double PinY { get; }
        public double Width { get; }
        public double Height { get; }
        public double Angle { get; }
        public double FlipX { get; }
        public double FlipY { get; }
    }

    internal static class VisioPlacementMath
    {
        public const double PointsPerInch = 72.0;
        public const double MinimumSizeInches = 1.0 / PointsPerInch;
        public const double MaximumSizeInches = 200.0;

        public static double PointsToInternal(double points)
        {
            if (double.IsNaN(points) || double.IsInfinity(points) || points <= 0)
                throw new ArgumentOutOfRangeException(nameof(points));
            return Clamp(points / PointsPerInch, MinimumSizeInches, MaximumSizeInches);
        }

        public static VisioPlacement CenterOnPage(double pageWidth, double pageHeight, double widthPt, double heightPt)
        {
            if (!IsFinitePositive(pageWidth) || !IsFinitePositive(pageHeight))
                throw new ArgumentOutOfRangeException(nameof(pageWidth));
            return new VisioPlacement(pageWidth / 2.0, pageHeight / 2.0, PointsToInternal(widthPt), PointsToInternal(heightPt), 0.0);
        }

        public static VisioPlacement PreserveTransform(VisioPlacement original, double widthPt, double heightPt)
        {
            if (!IsFinite(original.PinX) || !IsFinite(original.PinY) || !IsFinite(original.Angle) ||
                !IsFinite(original.FlipX) || !IsFinite(original.FlipY))
                throw new ArgumentOutOfRangeException(nameof(original));
            return new VisioPlacement(original.PinX, original.PinY, PointsToInternal(widthPt),
                PointsToInternal(heightPt), original.Angle, original.FlipX, original.FlipY);
        }

        private static bool IsFinitePositive(double value) => IsFinite(value) && value > 0;
        private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
        private static double Clamp(double value, double minimum, double maximum) => Math.Max(minimum, Math.Min(maximum, value));
    }
}
