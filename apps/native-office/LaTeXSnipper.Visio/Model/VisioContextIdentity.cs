#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace LaTeXSnipper.Visio.Model
{
    internal static class VisioContextIdentity
    {
        public static string ForSavedDocument(string fullName)
        {
            if (string.IsNullOrWhiteSpace(fullName) || !Path.IsPathRooted(fullName))
                throw new ArgumentException("A rooted document path is required.", nameof(fullName));

            string canonical = Path.GetFullPath(fullName).Trim().ToUpperInvariant();
            using (var sha = SHA256.Create())
            {
                return string.Concat(sha.ComputeHash(Encoding.UTF8.GetBytes(canonical))
                    .Take(16)
                    .Select(value => value.ToString("x2")));
            }
        }

        public static string Compose(string documentIdentity, int pageId)
        {
            if (string.IsNullOrWhiteSpace(documentIdentity))
                throw new ArgumentException("Document identity is required.", nameof(documentIdentity));
            if (pageId < 0) throw new ArgumentOutOfRangeException(nameof(pageId));
            return "visio:" + documentIdentity + ":" + pageId;
        }

        public static bool ShouldReassignCopiedFormulaId(int selectedShapeId, IReadOnlyList<int> matchingShapeIds)
        {
            if (matchingShapeIds == null) throw new ArgumentNullException(nameof(matchingShapeIds));
            return matchingShapeIds.Count > 1 && matchingShapeIds[0] != selectedShapeId;
        }
    }
}
