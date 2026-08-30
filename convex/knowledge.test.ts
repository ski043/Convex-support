/// <reference types="vite/client" />

import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { components } from "./_generated/api";
import {
  MAX_AUTOMATIC_CLEANUP_ATTEMPTS,
  runCleanupAttempt,
} from "./knowledgeCleanup";
import { consumeRegistrationQuota } from "./knowledge";
import {
  decodeUtf8Document,
  KnowledgeProcessingError,
  sanitizeKnowledgeFilename,
  validateKnowledgeFileType,
  validatePdfEnvelope,
} from "./knowledgeModel";
import { knowledgeRagKey, matchesStoredSha256 } from "./knowledgeNode";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type StorageId = GenericId<"_storage">;
type KnowledgeDocumentId = GenericId<"knowledgeDocuments">;

const register = makeFunctionReference<
  "mutation",
  {
    storageId: StorageId;
    filename: string;
    mimeType: string;
    clientRequestId: string;
  },
  { documentId: KnowledgeDocumentId }
>("knowledge:register");

const list = makeFunctionReference<
  "query",
  Record<string, never>,
  Array<{
    _id: KnowledgeDocumentId;
    filename: string;
    status: string;
    size: number;
    canReplace: boolean;
  }>
>("knowledge:list");

const generateUploadUrl = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { uploadUrl: string; reservationToken: string }
>("knowledge:generateUploadUrl");

const claimUpload = makeFunctionReference<
  "mutation",
  { reservationToken: string; storageId: StorageId },
  null
>("knowledge:claimUpload");

const remove = makeFunctionReference<
  "mutation",
  { documentId: KnowledgeDocumentId },
  null
>("knowledge:remove");

const replace = makeFunctionReference<
  "mutation",
  {
    documentId: KnowledgeDocumentId;
    storageId: StorageId;
    filename: string;
    mimeType: string;
    clientRequestId: string;
  },
  { documentId: KnowledgeDocumentId }
>("knowledge:replace");

const retry = makeFunctionReference<
  "mutation",
  { documentId: KnowledgeDocumentId },
  null
>("knowledge:retry");

const beginProcessing = makeFunctionReference<
  "mutation",
  { documentId: KnowledgeDocumentId },
  {
    documentId: KnowledgeDocumentId;
    processingToken: string;
  } | null
>("knowledge:beginProcessing");

const recoverProcessingLease = makeFunctionReference<
  "mutation",
  {
    documentId: KnowledgeDocumentId;
    processingToken: string;
    attempt: number;
  },
  null
>("knowledge:recoverProcessingLease");

const cleanupStorage = makeFunctionReference<
  "mutation",
  {
    documentId: KnowledgeDocumentId;
    storageId: StorageId;
    cleanupToken: string;
    attempt: number;
  },
  null
>("knowledge:cleanupStorage");

const sweepOrphanedStorage = makeFunctionReference<
  "mutation",
  { cursor: string | null },
  null
>("knowledgeOrphans:sweep");

const completeExistingEntry = makeFunctionReference<
  "mutation",
  {
    documentId: KnowledgeDocumentId;
    processingToken: string;
    ragEntryId: string;
    replacedRagEntryId: string | null;
  },
  null
>("knowledge:completeExistingEntry");

const getReadyDocuments = makeFunctionReference<
  "query",
  { workspaceId: GenericId<"workspaces">; ragEntryIds: string[] },
  Array<{
    knowledgeDocumentId: KnowledgeDocumentId;
    ragEntryId: string;
    documentTitle: string;
  }>
>("knowledgeInternal:getReadyDocumentsByRagIds");

const ownerA = {
  subject: "owner-a",
  issuer: "https://auth.example.test",
  tokenIdentifier: "https://auth.example.test|knowledge-owner-a",
};
const ownerB = {
  subject: "owner-b",
  issuer: "https://auth.example.test",
  tokenIdentifier: "https://auth.example.test|knowledge-owner-b",
};

function backend() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}

async function createWorkspace(
  t: ReturnType<typeof backend>,
  identity: typeof ownerA,
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("workspaces", {
      name: identity.subject,
      ownerAuthUserId: `legacy-${identity.subject}`,
      ownerTokenIdentifier: identity.tokenIdentifier,
    }),
  );
}

function buildSinglePagePdf(contentStream: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("knowledge metadata validation", () => {
  test("uses a distinct RAG key until a replacement is ready", () => {
    expect(
      knowledgeRagKey({
        stableKey: "document:guide",
        version: 1,
        replacesDocumentId: undefined,
      }),
    ).toBe("document:guide");
    expect(
      knowledgeRagKey({
        stableKey: "document:guide",
        version: 2,
        replacesDocumentId: "replacement" as KnowledgeDocumentId,
      }),
    ).toBe("document:guide:version:2");
  });

  test("accepts Convex storage hashes in hosted Base64 and documented hex", async () => {
    const bytes = new TextEncoder().encode("MarshalDesk hash fixture");

    await expect(
      matchesStoredSha256(
        bytes,
        "9691806c74b3317351d056f58b2a4ccdcad1b43a5e8f320198088d108c6b05c8",
      ),
    ).resolves.toBe(true);
    await expect(
      matchesStoredSha256(
        bytes,
        "lpGAbHSzMXNR0Fb1iypMzcrRtDpejzIBmAiNEIxrBcg=",
      ),
    ).resolves.toBe(true);
    await expect(
      matchesStoredSha256(bytes, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
    ).resolves.toBe(false);
  });

  test("sanitizes path-like filenames and requires matching extension and MIME", () => {
    expect(sanitizeKnowledgeFilename("../guides/  Setup\u0000 Guide.md  ")).toBe(
      "Setup Guide.md",
    );
    expect(validateKnowledgeFileType("guide.md", "text/markdown; charset=utf-8"))
      .toEqual({ fileKind: "markdown", mimeType: "text/markdown" });
    expect(() => validateKnowledgeFileType("guide.pdf", "text/plain")).toThrow(
      "Only PDF, Markdown, and plain-text files",
    );
  });

  test("rejects binary text and distinguishes malformed and encrypted PDFs", () => {
    expect(() => decodeUtf8Document(Uint8Array.from([65, 0, 66]))).toThrow(
      "binary data",
    );
    expect(() => validatePdfEnvelope(new TextEncoder().encode("not a pdf"))).toThrow(
      "valid PDF header",
    );
    try {
      validatePdfEnvelope(
        new TextEncoder().encode("%PDF-1.7\ntrailer << /Encrypt 2 0 R >>\n%%EOF"),
      );
      throw new Error("expected encrypted PDF rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeProcessingError);
      expect((error as KnowledgeProcessingError).code).toBe("ENCRYPTED_PDF");
    }
  });

  test("extracts Markdown headings and plain text into bounded evidence chunks", async () => {
    const { extractKnowledgeChunks } = await import("./knowledgeExtract");
    const markdown = await extractKnowledgeChunks(
      "markdown",
      new TextEncoder().encode(
        "# Installation\n\nRun the installer.\n\n## Troubleshooting\n\nRestart safely.",
      ),
    );
    expect(markdown).toMatchObject([
      { metadata: { heading: "Installation" } },
      { metadata: { heading: "Troubleshooting" } },
    ]);
    const text = await extractKnowledgeChunks(
      "text",
      new TextEncoder().encode("A plain-text support answer."),
    );
    expect(text).toEqual([
      { text: "A plain-text support answer.", metadata: {} },
    ]);
    expect(markdown.every((chunk) => chunk.text.length <= 2_400)).toBe(true);
  });

  test("extracts selectable PDF text with page metadata and safely rejects a no-text PDF", async () => {
    const { extractKnowledgeChunks } = await import("./knowledgeExtract");
    const selectable = buildSinglePagePdf(
      "BT /F1 12 Tf 72 720 Td (Selectable support text appears on PDF page one.) Tj ET",
    );

    await expect(extractKnowledgeChunks("pdf", selectable)).resolves.toEqual([
      {
        text: "Selectable support text appears on PDF page one.",
        metadata: { pageNumber: 1 },
      },
    ]);

    const graphicsOnly = buildSinglePagePdf("0 0 100 100 re S");
    try {
      await extractKnowledgeChunks("pdf", graphicsOnly);
      throw new Error("expected a no-text PDF rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeProcessingError);
      expect((error as KnowledgeProcessingError).code).toBe("SCANNED_PDF");
      expect((error as Error).message).toMatch(/No usable selectable text/);
    }
  });
});

describe("knowledge registration", () => {
  test("keeps registration retries idempotent and tenant-scoped", async () => {
    const t = backend();
    const workspaceId = await createWorkspace(t, ownerA);
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["Trusted setup instructions"], { type: "text/plain" })),
    );
    const request = {
      storageId,
      filename: "setup.txt",
      mimeType: "text/plain",
      clientRequestId: "d89568a7-4e3a-4a7e-8a50-5a83a1bbaeb4",
    };
    const now = Date.now();
    const documentId = await t.run(async (ctx) => {
      const inserted = await ctx.db.insert("knowledgeDocuments", {
        workspaceId,
        storageId,
        clientRequestId: request.clientRequestId,
        stableKey: `document:${request.clientRequestId}`,
        version: 1,
        filename: request.filename,
        title: "setup",
        mimeType: request.mimeType,
        fileKind: "text",
        size: 26,
        sha256: "test-storage-hash",
        status: "queued",
        attempt: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("knowledgeUploadReservations", {
        workspaceId,
        token: "idempotent-upload",
        storageId,
        createdAt: now,
      });
      return inserted;
    });

    const asOwner = t.withIdentity(ownerA);
    const first = await asOwner.mutation(register, request);
    const second = await asOwner.mutation(register, request);
    expect(first.documentId).toBe(documentId);
    expect(second).toEqual(first);
    expect(
      await t.run(async (ctx) =>
        ctx.db.query("knowledgeUploadReservations").collect(),
      ),
    ).toEqual([]);
    await createWorkspace(t, ownerB);
    await expect(t.withIdentity(ownerB).mutation(remove, first)).rejects.toThrow(
      "Knowledge document not found",
    );
    const documents = await asOwner.query(list, {});
    expect(documents).toMatchObject([
      {
        _id: first.documentId,
        filename: "setup.txt",
        size: 26,
      },
    ]);
    expect(Object.keys(documents[0] ?? {}).sort()).toEqual([
      "_id",
      "canReplace",
      "canRetry",
      "createdAt",
      "fileKind",
      "filename",
      "mimeType",
      "size",
      "status",
      "title",
      "updatedAt",
      "version",
    ]);
    expect(documents[0]).not.toHaveProperty("storageId");
    expect(documents[0]).not.toHaveProperty("storageUrl");
    expect(documents[0]).not.toHaveProperty("workspaceId");
    expect(documents[0]).not.toHaveProperty("sha256");
    expect(documents[0]).not.toHaveProperty("ragEntryId");
  });

  test("reserves worst-case bytes before issuing an upload URL", async () => {
    const t = backend();
    await createWorkspace(t, ownerA);
    const asOwner = t.withIdentity(ownerA);

    for (let issued = 0; issued < 5; issued += 1) {
      await expect(asOwner.mutation(generateUploadUrl, {})).resolves.toEqual({
        uploadUrl: expect.stringMatching(/^https?:\/\//),
        reservationToken: expect.any(String),
      });
    }
    await expect(asOwner.mutation(generateUploadUrl, {})).rejects.toThrow(
      "daily knowledge upload byte limit",
    );
  });

  test("only the reserving workspace can claim a newly uploaded storage object", async () => {
    const t = backend();
    await createWorkspace(t, ownerA);
    await createWorkspace(t, ownerB);
    const { reservationToken } = await t
      .withIdentity(ownerA)
      .mutation(generateUploadUrl, {});
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["claimed"], { type: "text/plain" })),
    );

    await expect(
      t.withIdentity(ownerB).mutation(claimUpload, {
        reservationToken,
        storageId,
      }),
    ).rejects.toThrow("reservation is no longer available");
    await expect(
      t.withIdentity(ownerA).mutation(claimUpload, {
        reservationToken,
        storageId,
      }),
    ).resolves.toBeNull();
    await expect(
      t.withIdentity(ownerA).mutation(claimUpload, {
        reservationToken,
        storageId,
      }),
    ).resolves.toBeNull();
    expect(
      await t.run(async (ctx) =>
        ctx.db.query("knowledgeUploadReservations").collect(),
      ),
    ).toEqual([
      expect.objectContaining({
        workspaceId: expect.any(String),
        token: reservationToken,
        storageId,
      }),
    ]);
  });

  test("rejects a spoofed client MIME when storage metadata disagrees", async () => {
    const t = backend();
    await createWorkspace(t, ownerA);
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["plain text"], { type: "text/plain" })),
    );
    await expect(
      t.withIdentity(ownerA).mutation(register, {
        storageId,
        filename: "spoofed.pdf",
        mimeType: "application/pdf",
        clientRequestId: "9f52b6c5-2cb9-4b10-88b9-87fd4c543db6",
      }),
    ).rejects.toThrow("Only PDF, Markdown, and plain-text files");
  });

  test("rejects a second active document that aliases the same storage object", async () => {
    const t = backend();
    const workspaceId = await createWorkspace(t, ownerA);
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["one upload"], { type: "text/plain" })),
    );
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("knowledgeDocuments", {
        workspaceId,
        storageId,
        clientRequestId: "c30e7e4e-70d7-43ce-928e-dad7b569c848",
        stableKey: "document:first",
        version: 1,
        filename: "first.txt",
        title: "First",
        mimeType: "text/plain",
        fileKind: "text",
        size: 10,
        sha256: "existing-storage-hash",
        status: "queued",
        attempt: 0,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.withIdentity(ownerA).mutation(register, {
        storageId,
        filename: "second.txt",
        mimeType: "text/plain",
        clientRequestId: "90874442-04f5-46fe-9162-df4fc3e1cfac",
      }),
    ).rejects.toThrow("already registered");
  });

  test("keeps the prior ready version until the replacement commit swaps app state", async () => {
    const t = backend();
    const workspaceId = await createWorkspace(t, ownerA);
    const [oldStorageId, newStorageId] = await t.run(async (ctx) => [
      await ctx.storage.store(new Blob(["old"])),
      await ctx.storage.store(new Blob(["new"])),
    ]);
    const now = Date.now();
    const { oldDocumentId, newDocumentId } = await t.run(async (ctx) => {
      const oldDocumentId = await ctx.db.insert("knowledgeDocuments", {
        workspaceId,
        storageId: oldStorageId,
        clientRequestId: "f9a27a4d-74e9-4e59-a749-f7cfb53f03b0",
        stableKey: "document:stable",
        version: 1,
        filename: "guide.txt",
        title: "Old guide",
        mimeType: "text/plain",
        fileKind: "text",
        size: 3,
        sha256: "old-hash",
        status: "ready",
        ragEntryId: "rag:stable",
        attempt: 1,
        createdAt: now - 1,
        updatedAt: now - 1,
        readyAt: now - 1,
      });
      const newDocumentId = await ctx.db.insert("knowledgeDocuments", {
        workspaceId,
        storageId: newStorageId,
        clientRequestId: "2cf6c1dd-4944-4e72-8990-61ec2776641d",
        stableKey: "document:stable",
        version: 2,
        replacesDocumentId: oldDocumentId,
        filename: "guide.txt",
        title: "New guide",
        mimeType: "text/plain",
        fileKind: "text",
        size: 3,
        sha256: "new-hash",
        status: "processing",
        attempt: 1,
        processingToken: "processing-token",
        createdAt: now,
        updatedAt: now,
      });
      return { oldDocumentId, newDocumentId };
    });

    expect(
      await t.query(getReadyDocuments, {
        workspaceId,
        ragEntryIds: ["rag:stable"],
      }),
    ).toMatchObject([{ knowledgeDocumentId: oldDocumentId }]);
    await t.mutation(completeExistingEntry, {
      documentId: newDocumentId,
      processingToken: "processing-token",
      ragEntryId: "rag:stable",
      replacedRagEntryId: null,
    });
    expect(
      await t.query(getReadyDocuments, {
        workspaceId,
        ragEntryIds: ["rag:stable"],
      }),
    ).toMatchObject([{ knowledgeDocumentId: newDocumentId }]);
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.get("knowledgeDocuments", oldDocumentId))?.status,
      ),
    ).toBe("deleting");
  });

  test("keeps one replacement lineage until a failed version is retried or deleted", async () => {
    const t = backend();
    const workspaceId = await createWorkspace(t, ownerA);
    const readyStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["ready"], { type: "text/plain" })),
    );
    const failedStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["failed"], { type: "text/plain" })),
    );
    const nextStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["next"], { type: "text/plain" })),
    );
    const now = Date.now();
    const { readyId, failedId } = await t.run(async (ctx) => {
      const readyId = await ctx.db.insert("knowledgeDocuments", {
        workspaceId,
        storageId: readyStorageId,
        clientRequestId: "fe45c955-d7a1-4fe0-af83-b8eb362fe112",
        stableKey: "document:lineage",
        version: 1,
        filename: "guide.txt",
        title: "Guide",
        mimeType: "text/plain",
        fileKind: "text",
        size: 5,
        sha256: "ready",
        status: "ready",
        ragEntryId: "rag:ready",
        attempt: 1,
        createdAt: now - 1,
        updatedAt: now - 1,
        readyAt: now - 1,
      });
      const failedId = await ctx.db.insert("knowledgeDocuments", {
        workspaceId,
        storageId: failedStorageId,
        clientRequestId: "18421dd1-dc2e-4426-88a7-786bb8c87e7d",
        stableKey: "document:lineage",
        version: 2,
        replacesDocumentId: readyId,
        filename: "guide.txt",
        title: "Guide",
        mimeType: "text/plain",
        fileKind: "text",
        size: 6,
        sha256: "failed",
        status: "failed",
        attempt: 1,
        errorCode: "EMBEDDING_FAILED",
        errorMessage: "Retry this version.",
        createdAt: now,
        updatedAt: now,
      });
      return { readyId, failedId };
    });

    expect(await t.withIdentity(ownerA).query(list, {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: readyId, canReplace: false }),
        expect.objectContaining({ _id: failedId, canReplace: false }),
      ]),
    );

    await expect(
      t.withIdentity(ownerA).mutation(replace, {
        documentId: readyId,
        storageId: nextStorageId,
        filename: "guide.txt",
        mimeType: "text/plain",
        clientRequestId: "94797f93-f503-4164-b5ee-013408b1b050",
      }),
    ).rejects.toThrow("newer replacement already exists");

    await expect(
      t.withIdentity(ownerA).mutation(retry, { documentId: failedId }),
    ).resolves.toBeNull();
    expect(
      await t.run(async (ctx) => ctx.db.get("knowledgeDocuments", failedId)),
    ).toMatchObject({ status: "replacing" });
  });

  test("charges registration bytes in a new UTC quota window", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-01T23:59:00Z"));
      const t = backend();
      const workspaceId = await createWorkspace(t, ownerA);
      await t.withIdentity(ownerA).mutation(generateUploadUrl, {});
      const contents = "registered after midnight";

      vi.setSystemTime(new Date("2026-08-02T00:01:00Z"));
      await t.run(async (ctx) =>
        consumeRegistrationQuota(
          ctx,
          workspaceId,
          contents.length,
          new Date("2026-08-01T23:59:00Z").getTime(),
        ),
      );
      const byteQuota = await t.run(async (ctx) =>
        ctx.runQuery(components.rateLimiter.lib.getValue, {
          name: "knowledgeUploadBytes",
          key: String(workspaceId),
          config: {
            kind: "fixed window",
            rate: 100 * 1024 * 1024,
            period: 24 * 60 * 60_000,
            capacity: 100 * 1024 * 1024,
            start: 0,
          },
        }),
      );
      expect(byteQuota.value).toBe(100 * 1024 * 1024 - contents.length);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("knowledge recovery", () => {
  test("deletes unclaimed post-activation uploads without touching older storage", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
      const t = backend();
      const workspaceId = await createWorkspace(t, ownerA);
      const preexistingStorageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(["preexisting"])),
      );
      vi.advanceTimersByTime(1);
      const now = Date.now();
      await t.run(async (ctx) =>
        ctx.db.insert("knowledgeStorageSweepState", {
          name: "knowledgeUploads",
          activatedAt: now,
        }),
      );
      const registeredStorageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(["registered"])),
      );
      const claimedOrphanStorageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(["claimed abandoned"])),
      );
      const unclaimedOrphanStorageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(["unclaimed abandoned"])),
      );
      await t.run(async (ctx) => {
        await ctx.db.insert("knowledgeDocuments", {
          workspaceId,
          storageId: registeredStorageId,
          clientRequestId: "1f8627d2-dbbe-4171-b893-bdb83a473b03",
          stableKey: "document:registered-storage",
          version: 1,
          filename: "registered.txt",
          title: "Registered",
          mimeType: "text/plain",
          fileKind: "text",
          size: 10,
          sha256: "registered",
          status: "queued",
          attempt: 0,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("knowledgeUploadReservations", {
          workspaceId,
          token: "registered-upload",
          storageId: registeredStorageId,
          createdAt: now,
        });
        await ctx.db.insert("knowledgeUploadReservations", {
          workspaceId,
          token: "abandoned-upload",
          storageId: claimedOrphanStorageId,
          createdAt: now,
        });
        await ctx.db.insert("knowledgeUploadReservations", {
          workspaceId,
          token: "unclaimed-upload",
          createdAt: now,
        });
      });

      vi.advanceTimersByTime(24 * 60 * 60_000 + 1);
      await t.mutation(sweepOrphanedStorage, { cursor: null });

      expect(
        await t.run(async (ctx) =>
          ctx.db.system.get("_storage", registeredStorageId),
        ),
      ).not.toBeNull();
      expect(
        await t.run(async (ctx) =>
          ctx.db.system.get("_storage", claimedOrphanStorageId),
        ),
      ).toBeNull();
      expect(
        await t.run(async (ctx) =>
          ctx.db.system.get("_storage", unclaimedOrphanStorageId),
        ),
      ).toBeNull();
      expect(
        await t.run(async (ctx) =>
          ctx.db.system.get("_storage", preexistingStorageId),
        ),
      ).not.toBeNull();
      expect(
        await t.run(async (ctx) =>
          ctx.db.query("knowledgeUploadReservations").collect(),
        ),
      ).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a token-guarded processing watchdog retries, then fails at the bound", async () => {
    vi.useFakeTimers();
    try {
      const t = backend();
      const workspaceId = await createWorkspace(t, ownerA);
      const [oldStorageId, replacementStorageId, exhaustedStorageId] =
        await t.run(async (ctx) => [
          await ctx.storage.store(new Blob(["old"])),
          await ctx.storage.store(new Blob(["replacement"])),
          await ctx.storage.store(new Blob(["exhausted"])),
        ]);
      const now = Date.now();
      const fixture = await t.run(async (ctx) => {
        const oldDocumentId = await ctx.db.insert("knowledgeDocuments", {
          workspaceId,
          storageId: oldStorageId,
          clientRequestId: "824c8f03-2826-467a-a369-85556639ec14",
          stableKey: "document:watchdog",
          version: 1,
          filename: "guide.txt",
          title: "Ready guide",
          mimeType: "text/plain",
          fileKind: "text",
          size: 3,
          sha256: "old",
          status: "ready",
          ragEntryId: "rag:watchdog",
          attempt: 1,
          createdAt: now - 2,
          updatedAt: now - 2,
          readyAt: now - 2,
        });
        const replacementId = await ctx.db.insert("knowledgeDocuments", {
          workspaceId,
          storageId: replacementStorageId,
          clientRequestId: "c25587de-f0ae-4ff0-9394-983943b310af",
          stableKey: "document:watchdog",
          version: 2,
          replacesDocumentId: oldDocumentId,
          filename: "guide.txt",
          title: "Replacement guide",
          mimeType: "text/plain",
          fileKind: "text",
          size: 11,
          sha256: "replacement",
          status: "replacing",
          attempt: 0,
          createdAt: now - 1,
          updatedAt: now - 1,
        });
        const exhaustedId = await ctx.db.insert("knowledgeDocuments", {
          workspaceId,
          storageId: exhaustedStorageId,
          clientRequestId: "4614e2a1-2d1d-4859-b9ef-78bac623fbb0",
          stableKey: "document:exhausted",
          version: 1,
          filename: "exhausted.txt",
          title: "Exhausted",
          mimeType: "text/plain",
          fileKind: "text",
          size: 9,
          sha256: "exhausted",
          status: "queued",
          attempt: 2,
          createdAt: now,
          updatedAt: now,
        });
        return { oldDocumentId, replacementId, exhaustedId };
      });

      const replacement = await t.mutation(beginProcessing, {
        documentId: fixture.replacementId,
      });
      if (!replacement) throw new Error("Expected replacement processing lease");
      await t.mutation(recoverProcessingLease, {
        documentId: fixture.replacementId,
        processingToken: replacement.processingToken,
        attempt: 1,
      });
      const exhausted = await t.mutation(beginProcessing, {
        documentId: fixture.exhaustedId,
      });
      if (!exhausted) throw new Error("Expected exhausted processing lease");
      await t.mutation(recoverProcessingLease, {
        documentId: fixture.exhaustedId,
        processingToken: exhausted.processingToken,
        attempt: 3,
      });

      const snapshot = await t.run(async (ctx) => ({
        replacement: await ctx.db.get(
          "knowledgeDocuments",
          fixture.replacementId,
        ),
        exhausted: await ctx.db.get("knowledgeDocuments", fixture.exhaustedId),
      }));
      expect(snapshot.replacement).toMatchObject({
        status: "replacing",
        attempt: 1,
        errorCode: "PROCESSING_LEASE_EXPIRED",
      });
      expect(snapshot.replacement?.processingToken).toBeUndefined();
      expect(snapshot.exhausted).toMatchObject({
        status: "failed",
        attempt: 3,
        errorCode: "PROCESSING_LEASE_EXPIRED",
      });
      expect(
        await t.query(getReadyDocuments, {
          workspaceId,
          ragEntryIds: ["rag:watchdog"],
        }),
      ).toMatchObject([
        { knowledgeDocumentId: fixture.oldDocumentId },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("cleanup failures retry to a bound without leaking the raw error", async () => {
    const recordFailure = vi.fn(async () => undefined);
    const scheduleRetry = vi.fn(async () => undefined);
    const deleteDocument = vi.fn(async () => undefined);

    expect(
      await runCleanupAttempt(0, {
        deleteStorage: async () => {
          throw new Error("sensitive storage provider detail");
        },
        deleteDocument,
        recordFailure,
        scheduleRetry,
      }),
    ).toBe("retry_scheduled");
    expect(recordFailure).toHaveBeenLastCalledWith({
      nextAttempt: 1,
      exhausted: false,
    });
    expect(scheduleRetry).toHaveBeenCalledWith({
      nextAttempt: 1,
      delayMs: 1_000,
    });
    expect(deleteDocument).not.toHaveBeenCalled();

    expect(
      await runCleanupAttempt(MAX_AUTOMATIC_CLEANUP_ATTEMPTS - 1, {
        deleteStorage: async () => {
          throw new Error("another sensitive detail");
        },
        deleteDocument,
        recordFailure,
        scheduleRetry,
      }),
    ).toBe("exhausted");
    expect(recordFailure).toHaveBeenLastCalledWith({
      nextAttempt: MAX_AUTOMATIC_CLEANUP_ATTEMPTS,
      exhausted: true,
    });
    expect(scheduleRetry).toHaveBeenCalledTimes(1);
  });

  test("repeating delete resets cleanup generation and stale callbacks are ignored", async () => {
    vi.useFakeTimers();
    try {
      const t = backend();
      const workspaceId = await createWorkspace(t, ownerA);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(["cleanup"])),
      );
      const now = Date.now();
      const documentId = await t.run(async (ctx) =>
        ctx.db.insert("knowledgeDocuments", {
          workspaceId,
          storageId,
          clientRequestId: "2d44085c-5a63-428d-95ff-8f9c49c633b8",
          stableKey: "document:cleanup",
          version: 1,
          filename: "cleanup.txt",
          title: "Cleanup",
          mimeType: "text/plain",
          fileKind: "text",
          size: 7,
          sha256: "cleanup",
          status: "deleting",
          attempt: 1,
          cleanupToken: "old-cleanup-token",
          cleanupAttempt: MAX_AUTOMATIC_CLEANUP_ATTEMPTS,
          errorCode: "STORAGE_CLEANUP_RETRY_EXHAUSTED",
          errorMessage: "Storage cleanup needs another manual delete attempt.",
          createdAt: now,
          updatedAt: now,
        }),
      );

      await t.withIdentity(ownerA).mutation(remove, { documentId });
      const redriven = await t.run(async (ctx) =>
        ctx.db.get("knowledgeDocuments", documentId),
      );
      expect(redriven).toMatchObject({ status: "deleting", cleanupAttempt: 0 });
      expect(redriven?.cleanupToken).not.toBe("old-cleanup-token");
      expect(redriven?.errorCode).toBeUndefined();

      await t.mutation(cleanupStorage, {
        documentId,
        storageId,
        cleanupToken: "old-cleanup-token",
        attempt: MAX_AUTOMATIC_CLEANUP_ATTEMPTS,
      });
      expect(
        await t.run(async (ctx) => ctx.db.get("knowledgeDocuments", documentId)),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
