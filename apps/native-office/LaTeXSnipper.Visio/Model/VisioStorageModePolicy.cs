#nullable enable
using System;
using System.IO;

namespace LaTeXSnipper.Visio.Model
{
    internal enum VisioRenderStrategy
    {
        Auto,
        Vector,
        Image
    }

    internal static class VisioStorageModePolicy
    {
        public static VisioRenderStrategy Resolve(string? storageMode)
        {
            string mode = (storageMode ?? "auto").Trim().ToLowerInvariant();
            switch (mode)
            {
                case "":
                case "auto":
                    return VisioRenderStrategy.Auto;
                case "vector":
                case "image-svg":
                    return VisioRenderStrategy.Vector;
                case "image":
                case "image-png":
                    return VisioRenderStrategy.Image;
                case "ole":
                    throw new InvalidDataException("VISIO_OLE_UNSUPPORTED: OLE storage is unavailable in Visio.");
                case "native":
                case "native-omml":
                    throw new InvalidDataException("VISIO_NATIVE_UNSUPPORTED: native OMML storage is unavailable in Visio.");
                default:
                    throw new InvalidDataException("VISIO_STORAGE_MODE_UNSUPPORTED: unsupported Visio storage mode: " + mode);
            }
        }
    }
}
