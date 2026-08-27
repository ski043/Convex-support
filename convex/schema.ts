import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  setupChecks: defineTable({
    name: v.literal("database"),
    completedAt: v.number(),
  }).index("by_name", ["name"]),
});
