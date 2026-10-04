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
  sessionId?: string;
  documents?: ConversionDocument[];
  managed: boolean;
  editor: boolean;
  engine: boolean;
  ole: boolean;
  readOnly?: boolean;
}
export interface ConversionDocument {
  host?: string;
  sessionId?: string;
  documentContext?: string;
  documentTitle?: string;
  managed: boolean;
  ole: boolean;
  readOnly?: boolean;
}
export function collectConversionDocuments(
  sessions: Array<{
    session_id: string;
    host_type: string;
    document_id?: string;
    document_title?: string;
    capabilities?: string[];
  }>,
  loaded:
    | {
        sessionId?: string;
        documentContextId?: string;
        formula?: { formulaId?: string; latex?: string };
      }
    | undefined,
  ole: boolean,
  list: (sessionId: string) => Promise<{
    documents: Array<{
      documentContextId: string;
      documentTitle?: string;
      readOnly?: boolean;
    }>;
  }>,
): Promise<ConversionDocument[]>;
export function conversionDocuments(
  context: ConversionContext,
): Array<ConversionDocument & { value: string }>;
export interface FormatArtifact {
  content: string;
  mime: string;
  filename: string;
  base64?: boolean;
}
export function prepareSelectionFormatExport(
  controller: {
    prepare(): Promise<{ latex: string; svg: string }>;
    cancel(): Promise<void>;
  },
  format: ConversionFormat,
  convert: (
    from: "latex",
    to: "png",
    content: string,
    display: "inline",
  ) => Promise<{ content: string }>,
): Promise<{ kind: "export"; latex: string; artifact: FormatArtifact }>;
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
    document?: ConversionDocument;
  }) => Promise<T>;
  renderPreview: (prepared: T) => Promise<Node>;
  dispose?: (prepared: T) => Promise<void>;
  root?: Document;
  refreshDocuments?: () => Promise<ConversionDocument[]>;
}): Promise<{
  source: ConversionSource;
  format: ConversionFormat;
  prepared: T;
} | null>;
export function downloadFormatArtifact(
  artifact: FormatArtifact,
  root?: Document,
): void;
