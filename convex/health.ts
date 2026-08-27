import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import schema from "./schema";

export const check = query({
  args: {},
  returns: v.object({
    status: v.literal("ok"),
    message: v.string(),
  }),
  handler: () => ({
    status: "ok" as const,
    message: "The Next.js app is connected to Convex.",
  }),
});

export const getDatabaseCheck = query({
  args: {},
  returns: v.union(v.null(), schema.doc("setupChecks")),
  handler: async (ctx) => {
    return await ctx.db
      .query("setupChecks")
      .withIndex("by_name", (q) => q.eq("name", "database"))
      .unique();
  },
});

export const runDatabaseCheck = mutation({
  args: {},
  returns: v.id("setupChecks"),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("setupChecks")
      .withIndex("by_name", (q) => q.eq("name", "database"))
      .unique();
    const completedAt = Date.now();

    if (existing) {
      await ctx.db.patch("setupChecks", existing._id, { completedAt });
      return existing._id;
    }

    return await ctx.db.insert("setupChecks", {
      name: "database",
      completedAt,
    });
  },
});
