export type FormulaDisplayMode = "inline" | "block" | "numbered";

export type EquationNumberingScheme =
  | "global"
  | "chapter-dot"
  | "chapter-hyphen";

export interface OfficeFormulaPayload {
  schemaVersion: 1;
  formulaId: string;
  latex: string;
  displayMode: FormulaDisplayMode;
  createdAt?: string;
  updatedAt?: string;
  equationLabel?: string;
  layoutProfileId?: string;
  numbering?: {
    scheme: EquationNumberingScheme;
    separator?: "." | "-";
    restartPerChapter?: boolean;
    chapterStyle?: string;
    chapterLevel?: number;
  };
}

export interface SelectedOfficeFormula extends OfficeFormulaPayload {
  source: "metadata" | "omml" | "text";
}

export const FORMULA_SCHEMA_VERSION = 1 as const;
export const MAX_FORMULA_METADATA_BYTES = 256 * 1024;
export const FORMULA_TAG_PREFIX = "latexsnipper:formula:";
export const FORMULA_METADATA_PREFIX = "LSN1:";

const FORMULA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const EQUATION_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;

export function createFormulaId(): string {
  const random =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return random.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
}

export function formulaTag(formulaId: string): string {
  if (!FORMULA_ID_PATTERN.test(formulaId)) {
    throw new Error("Invalid formulaId");
  }
  return `${FORMULA_TAG_PREFIX}${formulaId}`;
}

export function formulaIdFromTag(tag: string): string | null {
  if (!tag.startsWith(FORMULA_TAG_PREFIX)) return null;
  const formulaId = tag.slice(FORMULA_TAG_PREFIX.length);
  return FORMULA_ID_PATTERN.test(formulaId) ? formulaId : null;
}

export function bookmarkNameForFormula(formulaId: string): string {
  const normalized = formulaId.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32);
  return `LSNEq_${normalized || "Formula"}`;
}

export function bookmarkNumericIdForFormula(formulaId: string): number {
  if (!FORMULA_ID_PATTERN.test(formulaId)) throw new Error("Invalid formulaId");
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(formulaId)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  // Keep IDs positive and away from the small values commonly authored by Word.
  return 0x40000000 | (hash & 0x3fffffff);
}

export function validateFormulaPayload(
  value: unknown,
  options: { requireLatex?: boolean } = { requireLatex: true },
): OfficeFormulaPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Formula metadata must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== FORMULA_SCHEMA_VERSION) {
    throw new Error("Unsupported formula schemaVersion");
  }
  if (
    typeof input.formulaId !== "string" ||
    !FORMULA_ID_PATTERN.test(input.formulaId)
  ) {
    throw new Error("Invalid formulaId");
  }
  if (
    typeof input.latex !== "string" ||
    (options.requireLatex !== false && input.latex.trim() === "")
  ) {
    throw new Error("Formula LaTeX is required");
  }
  if (
    new TextEncoder().encode(input.latex).length > MAX_FORMULA_METADATA_BYTES
  ) {
    throw new Error("Formula metadata exceeds the size limit");
  }
  if (
    input.displayMode !== "inline" &&
    input.displayMode !== "block" &&
    input.displayMode !== "numbered"
  ) {
    throw new Error("Invalid formula displayMode");
  }
  if (
    input.equationLabel !== undefined &&
    (typeof input.equationLabel !== "string" ||
      !EQUATION_LABEL_PATTERN.test(input.equationLabel))
  ) {
    throw new Error("Invalid equation label");
  }
  if (input.numbering !== undefined) {
    if (
      !input.numbering ||
      typeof input.numbering !== "object" ||
      Array.isArray(input.numbering)
    ) {
      throw new Error("Invalid numbering metadata");
    }
    const numbering = input.numbering as Record<string, unknown>;
    if (
      numbering.scheme !== "global" &&
      numbering.scheme !== "chapter-dot" &&
      numbering.scheme !== "chapter-hyphen"
    ) {
      throw new Error("Unsupported numbering scheme");
    }
    if (
      numbering.separator !== undefined &&
      numbering.separator !== "." &&
      numbering.separator !== "-"
    ) {
      throw new Error("Invalid numbering separator");
    }
    if (
      numbering.chapterLevel !== undefined &&
      (typeof numbering.chapterLevel !== "number" ||
        !Number.isInteger(numbering.chapterLevel) ||
        numbering.chapterLevel < 1 ||
        numbering.chapterLevel > 9)
    ) {
      throw new Error("Invalid chapter level");
    }
    if (numbering.scheme === "chapter-dot" && numbering.separator === "-") {
      throw new Error("Numbering metadata conflicts with chapter-dot scheme");
    }
    if (numbering.scheme === "chapter-hyphen" && numbering.separator === ".") {
      throw new Error(
        "Numbering metadata conflicts with chapter-hyphen scheme",
      );
    }
  }
  return input as unknown as OfficeFormulaPayload;
}

export function encodeFormulaMetadata(payload: OfficeFormulaPayload): string {
  const validated = validateFormulaPayload(payload);
  const bytes = new TextEncoder().encode(JSON.stringify(validated));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${FORMULA_METADATA_PREFIX}${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

export function decodeFormulaMetadata(encoded: string): OfficeFormulaPayload {
  if (!encoded.startsWith(FORMULA_METADATA_PREFIX))
    throw new Error("Unknown formula metadata format");
  const base64 = encoded
    .slice(FORMULA_METADATA_PREFIX.length)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return validateFormulaPayload(JSON.parse(new TextDecoder().decode(bytes)));
}
