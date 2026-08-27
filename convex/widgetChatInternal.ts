import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { CAPABILITY_EXPIRY_SCHEDULE_STEP_MS } from "./chatModel";

const expireCapabilityReference = makeFunctionReference<
  "mutation",
  { visitorId: Id<"visitors">; expectedExpiresAt: number },
  null
>("widgetChatInternal:expireCapability");

export const expireCapability = internalMutation({
  args: {
    visitorId: v.id("visitors"),
    expectedExpiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const visitor = await ctx.db.get("visitors", args.visitorId);
    if (
      !visitor ||
      visitor.capabilityExpiresAt !== args.expectedExpiresAt ||
      visitor.capabilityExpired
    ) {
      return null;
    }

    const now = Date.now();
    if (visitor.capabilityExpiresAt > now) {
      await ctx.scheduler.runAt(
        Math.min(
          visitor.capabilityExpiresAt,
          now + CAPABILITY_EXPIRY_SCHEDULE_STEP_MS,
        ),
        expireCapabilityReference,
        {
          visitorId: visitor._id,
          expectedExpiresAt: visitor.capabilityExpiresAt,
        },
      );
      return null;
    }

    await ctx.db.patch("visitors", visitor._id, { capabilityExpired: true });
    return null;
  },
});
