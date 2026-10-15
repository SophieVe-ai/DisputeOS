// Turns uploaded files into plain text. Text formats are decoded directly; PDFs go
// through unpdf (pure JS, no native deps). Everything else is rejected up front.
export const MAX_FILES = 15;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT_CHARS = 20_000;

const TEXT_EXTENSIONS = new Set(["txt", "md", "eml", "csv", "text"]);
export const ACCEPTED_EXTENSIONS = [...TEXT_EXTENSIONS, "pdf"];

export class IntakeError extends Error {}

export interface ExtractedFile {
  filename: string;
  text: string;
  truncated: boolean;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/** Keeps the headers that matter for evidence (From/To/Date/Subject) plus the body. */
export function normaliseEmail(raw: string): string {
  const [head, ...rest] = raw.split(/\n\s*\n/);
  const keep = head
    .split("\n")
    .filter((line) => /^(from|to|date|subject)\s*:/i.test(line))
    .map((line) => {
      const m = line.match(/^date\s*:\s*(.+)$/i);
      if (!m) return line;
      const parsed = new Date(m[1]);
      return Number.isNaN(parsed.getTime()) ? line : `Date: ${parsed.toISOString().slice(0, 10)}`;
    });
  return [...keep, "", rest.join("\n\n").trim()].join("\n").trim();
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function extractFile(filename: string, bytes: Uint8Array): Promise<ExtractedFile> {
  const ext = extensionOf(filename);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new IntakeError(`${filename}: unsupported file type. Upload ${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(", ")}.`);
  }
  if (bytes.byteLength === 0) throw new IntakeError(`${filename}: file is empty.`);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new IntakeError(`${filename}: larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);

  let text: string;
  try {
    text = ext === "pdf" ? await pdfText(bytes) : new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch (err) {
    throw new IntakeError(`${filename}: could not read the file (${err instanceof Error ? err.message : String(err)}).`);
  }
  text = text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (ext === "eml") text = normaliseEmail(text);
  if (!text) throw new IntakeError(`${filename}: no readable text found${ext === "pdf" ? " (scanned PDFs are not supported)" : ""}.`);
  const truncated = text.length > MAX_TEXT_CHARS;
  return { filename, text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated };
}
