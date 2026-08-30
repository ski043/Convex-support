import { ConvexError } from "convex/values";

export const MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_EXTRACTED_CHARACTERS = 1_000_000;
export const MAX_KNOWLEDGE_CHUNKS = 1_000;
export const MAX_AUTOMATIC_INGESTION_ATTEMPTS = 3;
export const MAX_TOTAL_INGESTION_ATTEMPTS = 8;

export type KnowledgeFileKind = "pdf" | "markdown" | "text";

export type ExtractedSection = {
  text: string;
  pageNumber?: number;
  heading?: string;
};

export type KnowledgeChunk = {
  text: string;
  metadata: {
    pageNumber?: number;
    heading?: string;
  };
};

export class KnowledgeProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "KnowledgeProcessingError";
  }
}

export function knowledgeError(code: string, message: string) {
  return new ConvexError({ code, message });
}

export function normalizeClientRequestId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  ) {
    throw knowledgeError(
      "INVALID_REQUEST_ID",
      "clientRequestId must be a UUID.",
    );
  }
  return normalized;
}

function stripControlCharacters(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ");
}

export function sanitizeKnowledgeFilename(value: string) {
  const basename = value.split(/[\\/]/).at(-1) ?? "";
  const normalized = stripControlCharacters(basename)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized === "." || normalized === "..") {
    throw knowledgeError("INVALID_FILENAME", "Choose a valid filename.");
  }
  if (normalized.length > 180) {
    throw knowledgeError(
      "INVALID_FILENAME",
      "Filename cannot exceed 180 characters.",
    );
  }
  return normalized;
}

export function sanitizeKnowledgeTitle(
  value: string | undefined,
  filename: string,
) {
  const fallback = filename.replace(/\.[^.]+$/, "");
  const normalized = stripControlCharacters(value ?? fallback)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    throw knowledgeError("INVALID_TITLE", "Document title cannot be empty.");
  }
  if (normalized.length > 160) {
    throw knowledgeError(
      "INVALID_TITLE",
      "Document title cannot exceed 160 characters.",
    );
  }
  return normalized;
}

const supportedFiles: Record<
  string,
  { fileKind: KnowledgeFileKind; mimeTypes: readonly string[] }
> = {
  ".pdf": { fileKind: "pdf", mimeTypes: ["application/pdf"] },
  ".md": {
    fileKind: "markdown",
    mimeTypes: ["text/markdown", "text/x-markdown"],
  },
  ".markdown": {
    fileKind: "markdown",
    mimeTypes: ["text/markdown", "text/x-markdown"],
  },
  ".txt": { fileKind: "text", mimeTypes: ["text/plain"] },
};

export function validateKnowledgeFileType(
  filename: string,
  contentType: string | undefined,
) {
  const extensionMatch = /\.[^.]+$/.exec(filename.toLowerCase());
  const extension = extensionMatch?.[0] ?? "";
  const supported = supportedFiles[extension];
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!supported || !mimeType || !supported.mimeTypes.includes(mimeType)) {
    throw knowledgeError(
      "UNSUPPORTED_FILE_TYPE",
      "Only PDF, Markdown, and plain-text files with matching content types are supported.",
    );
  }
  return { fileKind: supported.fileKind, mimeType };
}

export function validateKnowledgeFileSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw knowledgeError("EMPTY_FILE", "The uploaded file is empty.");
  }
  if (size > MAX_KNOWLEDGE_FILE_BYTES) {
    throw knowledgeError(
      "FILE_TOO_LARGE",
      `Knowledge files cannot exceed ${MAX_KNOWLEDGE_FILE_BYTES / 1024 / 1024} MB.`,
    );
  }
}

export function knowledgeNamespace(workspaceId: string) {
  return `workspace:${workspaceId}`;
}

export function sanitizeFailureMessage(message: string) {
  const normalized = stripControlCharacters(message)
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "Document processing failed.").slice(0, 240);
}

export function classifyProcessingFailure(error: unknown) {
  if (error instanceof KnowledgeProcessingError) {
    return {
      code: error.code,
      message: sanitizeFailureMessage(error.message),
      retryable: error.retryable,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("fetch failed") ||
    /\b5\d\d\b/.test(normalized)
  ) {
    return {
      code: "EMBEDDING_PROVIDER_UNAVAILABLE",
      message: "The embedding provider is temporarily unavailable.",
      retryable: true,
    };
  }

  return {
    code: "INGESTION_FAILED",
    message: "The document could not be processed. You can retry it.",
    retryable: true,
  };
}

export function decodeUtf8Document(bytes: Uint8Array) {
  if (bytes.includes(0)) {
    throw new KnowledgeProcessingError(
      "UNREADABLE_TEXT",
      "The file appears to contain binary data instead of text.",
    );
  }

  const sampled = bytes.subarray(0, Math.min(bytes.length, 16_384));
  let suspiciousControls = 0;
  for (const byte of sampled) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      suspiciousControls += 1;
    }
  }
  if (sampled.length > 0 && suspiciousControls / sampled.length > 0.01) {
    throw new KnowledgeProcessingError(
      "UNREADABLE_TEXT",
      "The file appears to contain binary data instead of text.",
    );
  }

  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  } catch {
    throw new KnowledgeProcessingError(
      "UNREADABLE_TEXT",
      "Text and Markdown files must use UTF-8 encoding.",
    );
  }
}

function findByteMarker(
  bytes: Uint8Array,
  marker: string,
  start: number,
  end: number,
) {
  const markerBytes = new TextEncoder().encode(marker);
  const upperBound = Math.min(end, bytes.length) - markerBytes.length;
  for (let index = Math.max(0, start); index <= upperBound; index += 1) {
    let matches = true;
    for (let offset = 0; offset < markerBytes.length; offset += 1) {
      if (bytes[index + offset] !== markerBytes[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

export function validatePdfEnvelope(bytes: Uint8Array) {
  if (findByteMarker(bytes, "%PDF-", 0, 1_024) < 0) {
    throw new KnowledgeProcessingError(
      "INVALID_PDF",
      "The uploaded file does not contain a valid PDF header.",
    );
  }
  if (
    findByteMarker(
      bytes,
      "%%EOF",
      Math.max(0, bytes.length - 16_384),
      bytes.length,
    ) < 0
  ) {
    throw new KnowledgeProcessingError(
      "UNREADABLE_PDF",
      "The PDF appears incomplete or corrupted.",
    );
  }
  const pdfSyntax = new TextDecoder("latin1").decode(bytes);
  if (/\/Encrypt(?:\s+\d+\s+\d+\s+R|\s*<<)/.test(pdfSyntax)) {
    throw new KnowledgeProcessingError(
      "ENCRYPTED_PDF",
      "Encrypted PDFs are not supported. Upload an unencrypted copy.",
    );
  }
}
