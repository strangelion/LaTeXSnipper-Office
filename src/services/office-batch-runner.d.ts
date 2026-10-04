export interface BatchPreview {
  items: Array<{ status: string; sourceText: string }>;
}
export function confirmOfficeBatch(
  plan: BatchPreview,
  root?: Document,
): Promise<boolean>;
export function startOfficeBatch(
  target: { host: string; sessionId: string; documentContext: string },
  options?: {
    api?: any;
    onProgress?: (status: string) => void;
    confirm?: (plan: BatchPreview) => Promise<boolean>;
  },
): Promise<any>;
