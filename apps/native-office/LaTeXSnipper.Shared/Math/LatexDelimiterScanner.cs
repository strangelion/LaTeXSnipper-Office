using System;
using System.Collections.Generic;

namespace LaTeXSnipper.NativeOffice.Shared.Latex
{
    public sealed class LatexDelimiterMatch
    {
        internal LatexDelimiterMatch(
            int offset,
            int length,
            string originalText,
            string latex,
            bool isDisplay)
        {
            Offset = offset;
            Length = length;
            OriginalText = originalText;
            Latex = latex;
            IsDisplay = isDisplay;
        }

        public int Offset { get; }
        public int Length { get; }
        public string OriginalText { get; }
        public string Latex { get; }
        public bool IsDisplay { get; }
    }

    /// <summary>
    /// Scans LaTeX math delimiters without allowing escaped delimiters,
    /// comments, nested top-level openings, or Word story boundaries to be
    /// mistaken for a complete formula.
    /// </summary>
    public static class LatexDelimiterScanner
    {
        private const char UnsafeBoundary = '\0';
        private const char TableCellBoundary = '\a';

        public static IReadOnlyList<LatexDelimiterMatch> Scan(string text)
        {
            var matches = new List<LatexDelimiterMatch>();
            if (string.IsNullOrEmpty(text)) return matches;

            int index = 0;
            while (index < text.Length)
            {
                if (!TryReadOpeningDelimiter(text, index, out Delimiter delimiter))
                {
                    index++;
                    continue;
                }

                int contentStart = index + delimiter.Open.Length;
                int close = FindClosingDelimiter(text, contentStart, delimiter);
                if (close < 0 ||
                    ContainsTopLevelOpeningDelimiter(text, contentStart, close))
                {
                    index += delimiter.Open.Length;
                    continue;
                }

                string latex = text.Substring(contentStart, close - contentStart).Trim();
                int end = close + delimiter.Close.Length;
                if (latex.Length > 0)
                {
                    matches.Add(new LatexDelimiterMatch(
                        index,
                        end - index,
                        text.Substring(index, end - index),
                        latex,
                        delimiter.IsDisplay));
                }
                index = end;
            }
            return matches;
        }

        private static bool TryReadOpeningDelimiter(
            string text,
            int index,
            out Delimiter delimiter)
        {
            delimiter = default;
            if (index < 0 || index >= text.Length || IsHardBoundary(text[index]))
                return false;

            if (Matches(text, index, "$$") && !IsEscaped(text, index))
            {
                delimiter = new Delimiter("$$", "$$", true);
                return true;
            }
            if (text[index] == '$' && !IsEscaped(text, index))
            {
                delimiter = new Delimiter("$", "$", false);
                return true;
            }
            if (Matches(text, index, "\\(") && !IsEscaped(text, index))
            {
                delimiter = new Delimiter("\\(", "\\)", false);
                return true;
            }
            if (Matches(text, index, "\\[") && !IsEscaped(text, index))
            {
                delimiter = new Delimiter("\\[", "\\]", true);
                return true;
            }
            return false;
        }

        private static int FindClosingDelimiter(
            string text,
            int start,
            Delimiter delimiter)
        {
            int braceDepth = 0;
            bool inComment = false;
            for (int index = start;
                 index <= text.Length - delimiter.Close.Length;
                 index++)
            {
                char current = text[index];
                if (IsHardBoundary(current)) return -1;
                if (!delimiter.IsDisplay && (current == '\r' || current == '\n'))
                    return -1;

                if (inComment)
                {
                    if (current == '\r' || current == '\n') inComment = false;
                    continue;
                }
                if (current == '%' && !IsEscaped(text, index))
                {
                    inComment = true;
                    continue;
                }
                if (current == '{' && !IsEscaped(text, index))
                {
                    braceDepth++;
                    continue;
                }
                if (current == '}' && !IsEscaped(text, index))
                {
                    braceDepth = Math.Max(0, braceDepth - 1);
                    continue;
                }
                if (braceDepth == 0 &&
                    Matches(text, index, delimiter.Close) &&
                    !IsEscaped(text, index))
                {
                    return index;
                }
            }
            return -1;
        }

        private static bool ContainsTopLevelOpeningDelimiter(
            string text,
            int start,
            int end)
        {
            int braceDepth = 0;
            bool inComment = false;
            for (int index = start; index < end; index++)
            {
                char current = text[index];
                if (inComment)
                {
                    if (current == '\r' || current == '\n') inComment = false;
                    continue;
                }
                if (current == '%' && !IsEscaped(text, index))
                {
                    inComment = true;
                    continue;
                }
                if (current == '{' && !IsEscaped(text, index))
                {
                    braceDepth++;
                    continue;
                }
                if (current == '}' && !IsEscaped(text, index))
                {
                    braceDepth = Math.Max(0, braceDepth - 1);
                    continue;
                }
                if (braceDepth == 0 &&
                    TryReadOpeningDelimiter(text, index, out _))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool Matches(string text, int index, string value) =>
            index >= 0 &&
            index + value.Length <= text.Length &&
            string.CompareOrdinal(text, index, value, 0, value.Length) == 0;

        private static bool IsEscaped(string text, int index)
        {
            int backslashes = 0;
            for (int cursor = index - 1;
                 cursor >= 0 && text[cursor] == '\\';
                 cursor--)
            {
                backslashes++;
            }
            return backslashes % 2 != 0;
        }

        private static bool IsHardBoundary(char value) =>
            value == UnsafeBoundary || value == TableCellBoundary;

        private readonly struct Delimiter
        {
            public Delimiter(string open, string close, bool isDisplay)
            {
                Open = open;
                Close = close;
                IsDisplay = isDisplay;
            }

            public string Open { get; }
            public string Close { get; }
            public bool IsDisplay { get; }
        }
    }
}
