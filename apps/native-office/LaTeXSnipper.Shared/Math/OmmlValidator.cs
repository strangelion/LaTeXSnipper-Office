using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace LaTeXSnipper.NativeOffice.Shared.Omml
{
    public sealed class OmmlValidationIssue
    {
        public string Code { get; set; }
        public string Message { get; set; }
        public int NaryIndex { get; set; }
    }

    public sealed class OmmlNarySnapshot
    {
        public string Character { get; set; }
        public string Subscript { get; set; }
        public string Superscript { get; set; }
        public string Operand { get; set; }
    }

    public sealed class OmmlValidationResult
    {
        public bool IsValid => Issues.Count == 0;
        public IList<OmmlValidationIssue> Issues { get; } = new List<OmmlValidationIssue>();
        public IList<OmmlNarySnapshot> Naries { get; } = new List<OmmlNarySnapshot>();

        public bool HasIssue(string code) =>
            Issues.Any(issue => string.Equals(issue.Code, code, StringComparison.Ordinal));
    }

    /// <summary>
    /// Validates n-ary OMML ownership without rewriting or guessing structure.
    /// The operand of an integral, sum, or product must be inside that
    /// operator's m:nary/m:e element.
    /// </summary>
    public static class OmmlValidator
    {
        private static readonly XNamespace Math =
            "http://schemas.openxmlformats.org/officeDocument/2006/math";

        private static readonly HashSet<string> OperandElementNames =
            new HashSet<string>(StringComparer.Ordinal)
            {
                "r", "f", "rad", "sSub", "sSup", "sSubSup", "d", "func",
                "nary", "m", "eqArr", "acc", "bar", "groupChr", "limLow",
                "limUpp", "box", "borderBox"
            };

        private static readonly HashSet<char> RelationCharacters =
            new HashSet<char>("=<>≤≥≠≈∼∝∈∉∋⊂⊃⊆⊇|,:;".ToCharArray());

        private static readonly string[] ProtectedStructureNames =
        {
            "acc", "bar", "box", "borderBox", "d", "eqArr", "f", "func",
            "groupChr", "limLow", "limUpp", "m", "mr", "rad", "sPre",
            "sSup", "sSub", "sSubSup"
        };

        public static OmmlValidationResult Validate(string xml)
        {
            return Validate(xml, false);
        }

        private static OmmlValidationResult Validate(
            string xml,
            bool allowWordImplicitIntegralCharacter)
        {
            var result = new OmmlValidationResult();
            XDocument document;
            try
            {
                document = XDocument.Parse(xml ?? string.Empty, LoadOptions.PreserveWhitespace);
            }
            catch (Exception error)
            {
                AddIssue(result, "OMML_XML_INVALID", "OMML could not be parsed: " + error.Message, -1);
                return result;
            }

            int index = 0;
            foreach (XElement nary in document.Descendants(Math + "nary"))
            {
                ValidateNary(nary, index, result, allowWordImplicitIntegralCharacter);
                index++;
            }
            ValidateAccents(document, result);
            return result;
        }

        public static OmmlValidationResult ValidateHostReadBack(
            string expectedOmml,
            string hostWordOpenXml)
        {
            OmmlValidationResult expected = Validate(expectedOmml);
            if (!expected.IsValid) return expected;

            // ISO/IEC 29500 defines the omitted m:chr default as U+222B.
            // Word drops explicit m:chr for ordinary integrals during
            // normalization, so host read-back restores only that specified
            // default for comparison. Source OMML validation remains strict.
            OmmlValidationResult actual = Validate(hostWordOpenXml, true);
            if (!actual.IsValid) return actual;
            if (expected.Naries.Count != actual.Naries.Count)
            {
                AddIssue(
                    actual,
                    "OMML_HOST_NARY_COUNT_CHANGED",
                    $"Word read-back changed n-ary count from {expected.Naries.Count} to {actual.Naries.Count}.",
                    -1);
                return actual;
            }

            for (int index = 0; index < expected.Naries.Count; index++)
            {
                OmmlNarySnapshot wanted = expected.Naries[index];
                OmmlNarySnapshot observed = actual.Naries[index];
                Compare(actual, index, "character", wanted.Character, observed.Character);
                Compare(actual, index, "subscript", wanted.Subscript, observed.Subscript);
                Compare(actual, index, "superscript", wanted.Superscript, observed.Superscript);
                Compare(actual, index, "operand", wanted.Operand, observed.Operand);
            }
            CompareProtectedStructures(expectedOmml, hostWordOpenXml, actual);
            return actual;
        }

        private static void CompareProtectedStructures(
            string expectedXml,
            string actualXml,
            OmmlValidationResult result)
        {
            XDocument expected = XDocument.Parse(expectedXml);
            XDocument actual = XDocument.Parse(actualXml);
            foreach (string localName in ProtectedStructureNames)
            {
                List<XElement> wanted = expected.Descendants(Math + localName).ToList();
                List<XElement> observed = actual.Descendants(Math + localName).ToList();
                if (wanted.Count != observed.Count)
                {
                    AddIssue(
                        result,
                        "OMML_HOST_STRUCTURE_COUNT_CHANGED",
                        $"Word read-back changed m:{localName} count from {wanted.Count} to {observed.Count}.",
                        -1);
                    continue;
                }
                for (int index = 0; index < wanted.Count; index++)
                {
                    if (!string.Equals(
                        CanonicalText(wanted[index]),
                        CanonicalText(observed[index]),
                        StringComparison.Ordinal))
                    {
                        AddIssue(
                            result,
                            "OMML_HOST_STRUCTURE_TEXT_CHANGED",
                            $"Word read-back changed m:{localName} content at index {index}.",
                            -1);
                    }
                    if (localName == "acc" || localName == "groupChr")
                    {
                        string wantedCharacter = AttributeValue(
                            wanted[index].Descendants(Math + "chr").FirstOrDefault(),
                            "val") ?? string.Empty;
                        string observedCharacter = AttributeValue(
                            observed[index].Descendants(Math + "chr").FirstOrDefault(),
                            "val") ?? string.Empty;
                        if (localName == "acc" && observedCharacter.Length == 0)
                            observedCharacter = "\u0302";
                        if (!string.Equals(
                            wantedCharacter,
                            observedCharacter,
                            StringComparison.Ordinal))
                        {
                            AddIssue(
                                result,
                                "OMML_HOST_ACCENT_CHANGED",
                                $"Word read-back changed m:{localName} character at index {index} " +
                                $"from '{wantedCharacter}' to '{observedCharacter}'.",
                                -1);
                        }
                    }
                    CompareCriticalProperties(
                        localName,
                        wanted[index],
                        observed[index],
                        index,
                        result);
                }
            }
        }

        private static void CompareCriticalProperties(
            string localName,
            XElement expected,
            XElement actual,
            int index,
            OmmlValidationResult result)
        {
            string propertyElement;
            string[] attributes;
            switch (localName)
            {
                case "bar":
                    propertyElement = "barPr";
                    attributes = new[] { "pos" };
                    break;
                case "d":
                    propertyElement = "dPr";
                    attributes = new[] { "begChr", "endChr", "sepChr", "grow", "shp" };
                    break;
                case "f":
                    propertyElement = "fPr";
                    attributes = new[] { "type" };
                    break;
                case "rad":
                    propertyElement = "radPr";
                    attributes = new[] { "degHide" };
                    break;
                default:
                    return;
            }

            foreach (string attribute in attributes)
            {
                string wantedRaw = PropertyValue(expected, propertyElement, attribute);
                if (wantedRaw == null) continue;
                string observedRaw = PropertyValue(actual, propertyElement, attribute);
                string wanted = NormalizePropertyValue(localName, attribute, wantedRaw);
                string observed = NormalizePropertyValue(localName, attribute, observedRaw);
                if (string.Equals(wanted, observed, StringComparison.Ordinal)) continue;
                AddIssue(
                    result,
                    "OMML_HOST_STRUCTURE_PROPERTY_CHANGED",
                    $"Word read-back changed m:{localName}/m:{attribute} at index {index} " +
                    $"from '{wantedRaw}' to '{observedRaw ?? "(missing)"}'.",
                    -1);
            }
        }

        private static string NormalizePropertyValue(
            string localName,
            string propertyName,
            string value)
        {
            if (value != null) return value;
            if (localName == "d")
            {
                if (propertyName == "begChr") return "(";
                if (propertyName == "endChr") return ")";
                if (propertyName == "sepChr") return "|";
                if (propertyName == "grow") return "0";
                if (propertyName == "shp") return "centered";
            }
            if (localName == "f" && propertyName == "type") return "bar";
            if (localName == "rad" && propertyName == "degHide") return "0";
            if (localName == "bar" && propertyName == "pos") return "top";
            return null;
        }

        private static string PropertyValue(
            XElement structure,
            string propertyElement,
            string propertyName)
        {
            XElement properties = structure.Element(Math + propertyElement);
            XElement property = properties?.Element(Math + propertyName);
            return AttributeValue(property, "val");
        }

        private static void ValidateNary(
            XElement nary,
            int index,
            OmmlValidationResult result,
            bool allowWordImplicitIntegralCharacter)
        {
            XElement properties = nary.Element(Math + "naryPr");
            XElement operand = nary.Element(Math + "e");
            if (properties == null)
                AddIssue(result, "OMML_NARY_PROPERTIES_MISSING", "m:nary has no m:naryPr.", index);
            if (operand == null)
                AddIssue(result, "OMML_NARY_OPERAND_MISSING", "m:nary has no m:e operand.", index);

            string character = AttributeValue(properties?.Element(Math + "chr"), "val");
            if (string.IsNullOrWhiteSpace(character))
            {
                if (allowWordImplicitIntegralCharacter && properties != null)
                    character = "∫";
                else
                    AddIssue(
                        result,
                        "OMML_NARY_CHARACTER_MISSING",
                        "m:naryPr has no m:chr value.",
                        index);
            }

            string operandText = CanonicalText(operand);
            if (string.IsNullOrEmpty(operandText))
            {
                XElement detached = NextSignificantMathSibling(nary);
                if (detached != null && IsOperand(detached))
                {
                    AddIssue(
                        result,
                        "OMML_NARY_OPERAND_DETACHED",
                        $"The following m:{detached.Name.LocalName} is outside m:nary/m:e.",
                        index);
                }
                else
                {
                    AddIssue(result, "OMML_NARY_OPERAND_EMPTY", "m:nary/m:e is empty.", index);
                }
            }

            result.Naries.Add(new OmmlNarySnapshot
            {
                Character = character ?? string.Empty,
                Subscript = CanonicalText(nary.Element(Math + "sub")),
                Superscript = CanonicalText(nary.Element(Math + "sup")),
                Operand = operandText
            });
        }

        private static void ValidateAccents(
            XDocument document,
            OmmlValidationResult result)
        {
            int index = 0;
            foreach (XElement accent in document.Descendants(Math + "acc"))
            {
                XElement operand = accent.Element(Math + "e");
                if (operand == null)
                {
                    AddIssue(
                        result,
                        "OMML_ACCENT_OPERAND_MISSING",
                        $"m:acc at index {index} has no m:e operand.",
                        -1);
                    index++;
                    continue;
                }

                if (string.IsNullOrEmpty(CanonicalText(operand)))
                {
                    XElement detached = NextSignificantMathSibling(accent);
                    if (detached != null && IsOperand(detached))
                    {
                        AddIssue(
                            result,
                            "OMML_ACCENT_OPERAND_DETACHED",
                            $"The following m:{detached.Name.LocalName} is outside " +
                            $"m:acc/m:e at accent index {index}.",
                            -1);
                    }
                    else
                    {
                        AddIssue(
                            result,
                            "OMML_ACCENT_OPERAND_EMPTY",
                            $"m:acc/m:e at accent index {index} is empty.",
                            -1);
                    }
                }
                index++;
            }
        }

        private static XElement NextSignificantMathSibling(XElement element)
        {
            return element
                .ElementsAfterSelf()
                .FirstOrDefault(candidate =>
                    candidate.Name.Namespace == Math &&
                    (!string.IsNullOrWhiteSpace(CanonicalText(candidate)) ||
                     candidate.HasElements));
        }

        private static bool IsOperand(XElement element)
        {
            if (!OperandElementNames.Contains(element.Name.LocalName)) return false;
            string text = CanonicalText(element);
            return text.Length == 0 || text.Any(character =>
                !char.IsWhiteSpace(character) && !RelationCharacters.Contains(character));
        }

        private static string AttributeValue(XElement element, string localName)
        {
            return element?
                .Attributes()
                .FirstOrDefault(attribute =>
                    string.Equals(attribute.Name.LocalName, localName, StringComparison.Ordinal))
                ?.Value;
        }

        private static string CanonicalText(XElement element)
        {
            if (element == null) return string.Empty;
            return string.Concat(
                element
                    .DescendantsAndSelf()
                    .Where(candidate => candidate.Name == Math + "t")
                    .Select(candidate => candidate.Value))
                .Replace("\r", string.Empty)
                .Replace("\n", string.Empty)
                .Trim();
        }

        private static void Compare(
            OmmlValidationResult result,
            int index,
            string field,
            string expected,
            string actual)
        {
            if (string.Equals(expected, actual, StringComparison.Ordinal)) return;
            AddIssue(
                result,
                "OMML_HOST_NARY_FIELD_CHANGED",
                $"Word read-back changed n-ary {field} from '{expected}' to '{actual}'.",
                index);
        }

        private static void AddIssue(
            OmmlValidationResult result,
            string code,
            string message,
            int index)
        {
            result.Issues.Add(new OmmlValidationIssue
            {
                Code = code,
                Message = message,
                NaryIndex = index
            });
        }
    }
}
