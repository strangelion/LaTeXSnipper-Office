import type { EquationNumberingScheme } from "./formula-payload";

export interface EquationLayoutProfile {
  id: string;
  numberFormat: "parenthesized" | "plain";
  numberingScheme: EquationNumberingScheme;
  chapterStyle?: string;
  chapterLevel?: number;
  separator?: "." | "-";
  restartPerChapter: boolean;
  displayAlignment: "center";
  numberAlignment: "right";
  equationSpacingBeforePt?: number;
  equationSpacingAfterPt?: number;
  numberColumnMinWidthPt?: number;
  preserveDocumentFont: boolean;
}

export const DEFAULT_EQUATION_LAYOUT_PROFILE: EquationLayoutProfile = {
  id: "document-default",
  numberFormat: "parenthesized",
  numberingScheme: "global",
  restartPerChapter: false,
  displayAlignment: "center",
  numberAlignment: "right",
  equationSpacingBeforePt: 6,
  equationSpacingAfterPt: 6,
  numberColumnMinWidthPt: 54,
  preserveDocumentFont: true,
};

export const EQUATION_LAYOUT_PROFILES: readonly EquationLayoutProfile[] = [
  DEFAULT_EQUATION_LAYOUT_PROFILE,
  {
    ...DEFAULT_EQUATION_LAYOUT_PROFILE,
    id: "chapter-dot",
    numberingScheme: "chapter-dot",
    separator: ".",
    restartPerChapter: true,
    chapterStyle: "Heading 1",
    chapterLevel: 1,
  },
  {
    ...DEFAULT_EQUATION_LAYOUT_PROFILE,
    id: "chapter-hyphen",
    numberingScheme: "chapter-hyphen",
    separator: "-",
    restartPerChapter: true,
    chapterStyle: "Heading 1",
    chapterLevel: 1,
  },
];

export function getEquationLayoutProfile(id?: string): EquationLayoutProfile {
  return (
    EQUATION_LAYOUT_PROFILES.find((profile) => profile.id === id) ??
    DEFAULT_EQUATION_LAYOUT_PROFILE
  );
}
