import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const ORPHAN_GRACE_MS = 24 * 60 * 60_000;
const SWEEP_BATCH_SIZE = 50;

export const sweep = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    const reservations = await ctx.db
      .query("knowledgeUploadReservations")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .order("asc")
      .take(SWEEP_BATCH_SIZE);

    for (const reservation of reservations) {
      const storageId = reservation.storageId;
      if (storageId !== undefined) {
        const registered = await ctx.db
          .query("knowledgeDocuments")
          .withIndex("by_storageId", (q) =>
            q.eq("storageId", storageId),
          )
          .first();
        if (!registered) {
          await ctx.storage.delete(storageId);
        }
      }
      await ctx.db.delete("knowledgeUploadReservations", reservation._id);
    }

    if (reservations.length === SWEEP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.knowledgeOrphans.sweep, {});
    }
    return null;
  },
});
