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

        /// <summary>Explicit opt-in: the entire selected text is ONE formula,
        /// never a heuristic scan of ordinary document prose.</summary>
        public static IReadOnlyList<LatexDelimiterMatch> ScanSelection(string text)
        {
            if (string.IsNullOrWhiteSpace(text))
                throw new FormatException("Select a LaTeX formula first.");
            if (text.Length > 16384 || text.IndexOf(UnsafeBoundary) >= 0 ||
                text.IndexOf(TableCellBoundary) >= 0)
                throw new FormatException("Selection is too large or crosses a table/story boundary.");
            int start = 0, end = text.Length;
            while (start < end && char.IsWhiteSpace(text[start])) start++;
            while (end > start && char.IsWhiteSpace(text[end - 1])) end--;
            string source = text.Substring(start, end - start);
            if (source.Contains("```") || source.Contains("://") ||
                System.Text.RegularExpressions.Regex.IsMatch(source, @"[A-Za-z]:\\"))
                throw new FormatException("Code blocks and paths are not selection formulas.");

            var wrapped = Scan(source);
            bool completeWrapper = wrapped.Count == 1 && wrapped[0].Offset == 0 &&
                wrapped[0].Length == source.Length;
            string latex = completeWrapper ? wrapped[0].Latex : source;
            if (!completeWrapper && (wrapped.Count != 0 || ContainsTopLevelOpeningDelimiter(source, 0, source.Length)))
                throw new FormatException("Select one complete formula, not mixed prose or incomplete delimiters.");

            int depth = 0;
            bool inComment = false;
            for (int index = 0; index < latex.Length; index++)
            {
                char current = latex[index];
                if (inComment)
                {
                    if (current == '\r' || current == '\n') inComment = false;
                    continue;
                }
                if (current == '%' && !IsEscaped(latex, index)) { inComment = true; continue; }
                if (IsEscaped(latex, index)) continue;
                if (current == '{') depth++;
                if (current == '}' && --depth < 0)
                    throw new FormatException("Selection has unbalanced LaTeX braces.");
            }
            if (depth != 0 || latex.EndsWith("\\", StringComparison.Ordinal))
                throw new FormatException("Selection has incomplete LaTeX syntax.");
            // Conservative candidate gate, not a LaTeX parser. Core still converts
            // the candidate and the user confirms its preview before any write.
            if (!System.Text.RegularExpressions.Regex.IsMatch(latex, @"\\[A-Za-z]+|[_^=+]|[0-9]"))
                throw new FormatException("Selection has no recognizable LaTeX math syntax; use the formula editor instead.");
            return new[] { new LatexDelimiterMatch(start, source.Length, source, latex,
                completeWrapper && wrapped[0].IsDisplay) };
        }

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
