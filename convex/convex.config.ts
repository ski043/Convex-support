import agent from "@convex-dev/agent/convex.config";
import betterAuth from "@convex-dev/better-auth/convex.config";
import presence from "@convex-dev/presence/convex.config.js";
import rag from "@convex-dev/rag/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    BETTER_AUTH_SECRET: v.string(),
    SITE_URL: v.string(),
    AI_AUTOMATION_ENABLED: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    WIDGET_BOOTSTRAP_SECRET: v.optional(v.string()),
  },
});

app.use(agent);
app.use(betterAuth);
app.use(presence);
app.use(rag);
app.use(rateLimiter);

export default app;
