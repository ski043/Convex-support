import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  decodeUtf8Document,
  type ExtractedSection,
  type KnowledgeChunk,
  type KnowledgeFileKind,
  KnowledgeProcessingError,
  MAX_EXTRACTED_CHARACTERS,
  MAX_KNOWLEDGE_CHUNKS,
  validatePdfEnvelope,
} from "./knowledgeModel";

const TARGET_CHUNK_CHARACTERS = 1_400;
const MAX_CHUNK_CHARACTERS = 2_400;

function normalizeExtractedText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongText(value: string, maximum: number) {
  const parts: string[] = [];
  let remaining = value.trim();
  while (remaining.length > maximum) {
    const minimum = Math.floor(maximum * 0.55);
    const candidate = remaining.slice(0, maximum + 1);
    const sentenceBoundary = Math.max(
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf("! "),
      candidate.lastIndexOf("? "),
      candidate.lastIndexOf("\n"),
    );
    const whitespaceBoundary = candidate.lastIndexOf(" ");
    const boundary =
      sentenceBoundary >= minimum
        ? sentenceBoundary + 1
        : whitespaceBoundary >= minimum
          ? whitespaceBoundary
          : maximum;
    parts.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts;
}

export function chunkExtractedSections(sections: ExtractedSection[]) {
  const chunks: KnowledgeChunk[] = [];
  let extractedCharacters = 0;

  for (const section of sections) {
    const normalized = normalizeExtractedText(section.text);
    if (!normalized) {
      continue;
    }
    extractedCharacters += normalized.length;
    if (extractedCharacters > MAX_EXTRACTED_CHARACTERS) {
      throw new KnowledgeProcessingError(
        "EXTRACTED_CONTENT_TOO_LARGE",
        "The extracted document text is too large to index safely.",
      );
    }

    const paragraphs = normalized
      .split(/\n{2,}/)
      .flatMap((paragraph) => splitLongText(paragraph, MAX_CHUNK_CHARACTERS));
    let current = "";
    const flush = () => {
      if (!current) return;
      chunks.push({
        text: current,
        metadata: {
          ...(section.pageNumber === undefined
            ? {}
            : { pageNumber: section.pageNumber }),
          ...(section.heading === undefined
            ? {}
            : { heading: section.heading }),
        },
      });
      current = "";
      if (chunks.length > MAX_KNOWLEDGE_CHUNKS) {
        throw new KnowledgeProcessingError(
          "TOO_MANY_CHUNKS",
          "The document contains too many sections to index safely.",
        );
      }
    };

    for (const paragraph of paragraphs) {
      const combined = current ? `${current}\n\n${paragraph}` : paragraph;
      if (
        current &&
        (combined.length > MAX_CHUNK_CHARACTERS ||
          current.length >= TARGET_CHUNK_CHARACTERS)
      ) {
        flush();
        current = paragraph;
      } else {
        current = combined;
      }
    }
    flush();
  }

  if (chunks.length === 0) {
    throw new KnowledgeProcessingError(
      "EMPTY_DOCUMENT",
      "The document does not contain readable text.",
    );
  }
  return chunks;
}

function extractMarkdownSections(text: string) {
  const sections: ExtractedSection[] = [];
  let heading: string | undefined;
  let lines: string[] = [];
  const flush = () => {
    const content = lines.join("\n").trim();
    if (content) {
      sections.push({
        text: heading ? `${heading}\n\n${content}` : content,
        ...(heading === undefined ? {} : { heading }),
      });
    }
    lines = [];
  };

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) {
      lines.push(line);
      continue;
    }
    flush();
    heading = match[1]
      .replace(/[`*_~\[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }
  flush();
  return sections;
}

async function extractPdfSections(bytes: Uint8Array) {
  validatePdfEnvelope(bytes);
  const loadingTask = getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  });
  try {
    const document = await loadingTask.promise;
    const sections: ExtractedSection[] = [];
    let totalCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const fragments = content.items.flatMap((item) => {
        if (!("str" in item) || typeof item.str !== "string") return [];
        return [item.hasEOL ? `${item.str}\n` : item.str];
      });
      const text = normalizeExtractedText(fragments.join(" "));
      totalCharacters += text.length;
      if (totalCharacters > MAX_EXTRACTED_CHARACTERS) {
        throw new KnowledgeProcessingError(
          "EXTRACTED_CONTENT_TOO_LARGE",
          "The extracted document text is too large to index safely.",
        );
      }
      if (text) {
        sections.push({ text, pageNumber });
      }
      page.cleanup();
    }
    if (totalCharacters < Math.max(40, document.numPages * 8)) {
      throw new KnowledgeProcessingError(
        "SCANNED_PDF",
        "No usable selectable text was found. Scanned PDFs require OCR and are not supported.",
      );
    }
    return sections;
  } catch (error) {
    if (error instanceof KnowledgeProcessingError) throw error;
    const description = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    console.error("PDF extraction failed", description);
    if (/password|encrypted/i.test(description)) {
      throw new KnowledgeProcessingError(
        "ENCRYPTED_PDF",
        "Encrypted PDFs are not supported. Upload an unencrypted copy.",
      );
    }
    throw new KnowledgeProcessingError(
      "UNREADABLE_PDF",
      "The PDF could not be read. It may be damaged or use unsupported features.",
    );
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

export async function extractKnowledgeChunks(
  fileKind: KnowledgeFileKind,
  bytes: Uint8Array,
) {
  if (fileKind === "pdf") {
    return chunkExtractedSections(await extractPdfSections(bytes));
  }

  const text = decodeUtf8Document(bytes);
  const sections =
    fileKind === "markdown"
      ? extractMarkdownSections(text)
      : [{ text } satisfies ExtractedSection];
  return chunkExtractedSections(sections);
}
