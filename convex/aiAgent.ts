import { Agent } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { makeFunctionReference } from "convex/server";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { ANSWER_MODEL, ANSWER_REASONING_EFFORT } from "./aiModel";

const recordUsageReference = makeFunctionReference<
  "mutation",
  {
    runId: Id<"aiRuns">;
    attempt: number;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  },
  null
>("aiAutomation:recordUsage");

const sharedOptions = {
  languageModel: convexGateway(ANSWER_MODEL),
  contextOptions: { recentMessages: 100 },
  storageOptions: { saveMessages: "none" as const },
  providerOptions: {
    convexGateway: { reasoningEffort: ANSWER_REASONING_EFFORT },
  },
  callSettings: { maxRetries: 0 },
};

/** Used for app-owned thread creation and accepted AI message mirroring. */
export const supportAgent = new Agent(components.agent, {
  ...sharedOptions,
  name: "MarshalDesk AI support",
});

/** Distinguishes a human-authored assistant mirror from provider output. */
const humanMirrorAgent = new Agent(components.agent, {
  ...sharedOptions,
  name: "MarshalDesk human owner",
});

export function createRunAgent(runId: Id<"aiRuns">, attempt: number) {
  return new Agent(components.agent, {
    ...sharedOptions,
    name: "MarshalDesk AI support",
    usageHandler: async (ctx, event) => {
      const inputTokens = Math.max(0, event.usage.inputTokens ?? 0);
      const outputTokens = Math.max(0, event.usage.outputTokens ?? 0);
      const totalTokens = Math.max(
        inputTokens + outputTokens,
        event.usage.totalTokens ?? 0,
      );
      await ctx.runMutation(recordUsageReference, {
        runId,
        attempt,
        provider: event.provider,
        model: event.model,
        inputTokens,
        outputTokens,
        totalTokens,
      });
    },
  });
}

export async function ensureAgentThread(
  ctx: MutationCtx,
  state: Doc<"aiConversationStates">,
) {
  if (state.agentThreadId) {
    return state.agentThreadId;
  }
  const { threadId } = await supportAgent.createThread(ctx, {
    userId: `workspace:${state.workspaceId}`,
    title: `conversation:${state.conversationId}`,
  });
  await ctx.db.patch("aiConversationStates", state._id, {
    agentThreadId: threadId,
    updatedAt: Date.now(),
  });
  return threadId;
}

function mirrorAgentFor(message: Doc<"messages">) {
  return message.author === "owner" ? humanMirrorAgent : supportAgent;
}

function mirrorRole(message: Doc<"messages">) {
  if (message.author === "visitor") {
    return "user" as const;
  }
  if (message.author === "owner" || message.author === "assistant") {
    return "assistant" as const;
  }
  return null;
}

/**
 * Mirrors exactly one canonical message and links it in the same application
 * mutation as the Agent component write. System events advance the canonical
 * high-water mark but intentionally are not promoted to model instructions.
 */
export async function mirrorCanonicalMessage(
  ctx: MutationCtx,
  state: Doc<"aiConversationStates">,
  threadId: string,
  message: Doc<"messages">,
) {
  if (
    message.workspaceId !== state.workspaceId ||
    message.conversationId !== state.conversationId
  ) {
    throw new Error("Canonical message does not belong to the Agent thread.");
  }
  if (message.sequence !== state.syncedThroughSequence + 1) {
    throw new Error("Canonical messages must be mirrored in sequence order.");
  }

  const existing = await ctx.db
    .query("messageAgentLinks")
    .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
    .unique();
  if (existing) {
    if (
      existing.workspaceId !== state.workspaceId ||
      existing.conversationId !== state.conversationId ||
      existing.agentThreadId !== threadId ||
      existing.sequence !== message.sequence
    ) {
      throw new Error("Canonical-to-Agent message link is inconsistent.");
    }
    await ctx.db.patch("aiConversationStates", state._id, {
      syncedThroughSequence: message.sequence,
      updatedAt: Date.now(),
    });
    return existing.agentMessageId;
  }

  const role = mirrorRole(message);
  let agentMessageId: string | null = null;
  if (role) {
    const { messages } = await mirrorAgentFor(message).saveMessages(ctx, {
      threadId,
      messages: [{ role, content: message.body }],
      skipEmbeddings: true,
    });
    const mirrored = messages.at(-1);
    if (!mirrored) {
      throw new Error("Agent component did not return the mirrored message.");
    }
    agentMessageId = mirrored._id;
    await ctx.db.insert("messageAgentLinks", {
      workspaceId: state.workspaceId,
      conversationId: state.conversationId,
      messageId: message._id,
      sequence: message.sequence,
      agentThreadId: threadId,
      agentMessageId,
      createdAt: Date.now(),
    });
  }

  await ctx.db.patch("aiConversationStates", state._id, {
    syncedThroughSequence: message.sequence,
    updatedAt: Date.now(),
  });
  return agentMessageId;
}
