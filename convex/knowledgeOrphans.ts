import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";

const ORPHAN_GRACE_MS = 24 * 60 * 60_000;
const SWEEP_BATCH_SIZE = 50;

async function deleteExpiredReservationBatch(
  ctx: MutationCtx,
  cutoff: number,
) {
  const reservations = await ctx.db
    .query("knowledgeUploadReservations")
    .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
    .order("asc")
    .take(SWEEP_BATCH_SIZE);
  for (const reservation of reservations) {
    await ctx.db.delete("knowledgeUploadReservations", reservation._id);
  }
  return reservations.length === SWEEP_BATCH_SIZE;
}

export const sweep = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    cutoff: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cutoff = args.cutoff ?? Date.now() - ORPHAN_GRACE_MS;
    // A continuation produced by an older deployment has no stable cutoff.
    // Restarting it is safe and prevents reusing its cursor with new bounds.
    const cursor = args.cutoff === undefined ? null : (args.cursor ?? null);
    const sweepState = await ctx.db
      .query("knowledgeStorageSweepState")
      .withIndex("by_name", (q) => q.eq("name", "knowledgeUploads"))
      .unique();
    if (!sweepState) return null;

    const page = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) =>
        q
          .gte("_creationTime", sweepState.activatedAt)
          .lt("_creationTime", cutoff),
      )
      .order("asc")
      .paginate({ cursor, numItems: SWEEP_BATCH_SIZE });

    for (const storedFile of page.page) {
      const registered = await ctx.db
        .query("knowledgeDocuments")
        .withIndex("by_storageId", (q) => q.eq("storageId", storedFile._id))
        .first();
      if (!registered) {
        await ctx.storage.delete(storedFile._id);
      }
    }

    if (cursor == null) {
      const moreReservations = await deleteExpiredReservationBatch(ctx, cutoff);
      if (moreReservations) {
        await ctx.scheduler.runAfter(
          0,
          internal.knowledgeOrphans.sweepReservations,
          {},
        );
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.knowledgeOrphans.sweep, {
        cursor: page.continueCursor,
        cutoff,
      });
    }
    return null;
  },
});

export const sweepReservations = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const moreReservations = await deleteExpiredReservationBatch(
      ctx,
      Date.now() - ORPHAN_GRACE_MS,
    );
    if (moreReservations) {
      await ctx.scheduler.runAfter(
        0,
        internal.knowledgeOrphans.sweepReservations,
        {},
      );
    }
    return null;
  },
});
