export type ConversionSource = "selection" | "managed" | "editor";
export type ConversionFormat =
  | "omml"
  | "ole"
  | "svg"
  | "png"
  | "latex"
  | "mathtype";
export interface ConversionContext {
  native: boolean;
  connected: boolean;
  host?: string;
  documentContext?: string;
  documentTitle?: string;
  managed: boolean;
  editor: boolean;
  engine: boolean;
  ole: boolean;
}
export interface FormatArtifact {
  content: string;
  mime: string;
  filename: string;
  base64?: boolean;
}
export const FORMAT_NAMES: Record<ConversionFormat, string>;
export function conversionChoices(
  context: ConversionContext,
  source: ConversionSource,
): {
  sources: Array<{ value: ConversionSource; label: string; reason: string }>;
  formats: Array<{ value: ConversionFormat; label: string; reason: string }>;
};
export function openFormatConversionDialog<
  T extends { latex: string },
>(options: {
  context: ConversionContext;
  prepare: (choice: {
    source: ConversionSource;
    format: ConversionFormat;
  }) => Promise<T>;
  renderPreview: (prepared: T) => Promise<Node>;
  dispose?: (prepared: T) => Promise<void>;
  root?: Document;
}): Promise<{
  source: ConversionSource;
  format: ConversionFormat;
  prepared: T;
} | null>;
export function downloadFormatArtifact(
  artifact: FormatArtifact,
  root?: Document,
): void;
