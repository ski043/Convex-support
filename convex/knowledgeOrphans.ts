import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const ORPHAN_GRACE_MS = 24 * 60 * 60_000;
const SWEEP_BATCH_SIZE = 50;

/**
 * Storage is currently owned exclusively by the knowledge feature. If another
 * feature starts storing files, it must register ownership before this sweep is
 * enabled for that feature's objects.
 */
export const sweep = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    const page = await ctx.db.system
      .query("_storage")
      .order("asc")
      .paginate({ cursor: args.cursor, numItems: SWEEP_BATCH_SIZE });

    let reachedGraceWindow = false;
    for (const storedFile of page.page) {
      if (storedFile._creationTime >= cutoff) {
        reachedGraceWindow = true;
        break;
      }
      const registered = await ctx.db
        .query("knowledgeDocuments")
        .withIndex("by_storageId", (q) => q.eq("storageId", storedFile._id))
        .first();
      if (!registered) {
        await ctx.storage.delete(storedFile._id);
      }
    }

    if (!reachedGraceWindow && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.knowledgeOrphans.sweep, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});
