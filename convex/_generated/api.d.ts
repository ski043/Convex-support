/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiAgent from "../aiAgent.js";
import type * as aiAutomation from "../aiAutomation.js";
import type * as aiModel from "../aiModel.js";
import type * as aiResponder from "../aiResponder.js";
import type * as aiResponderOrchestration from "../aiResponderOrchestration.js";
import type * as auth from "../auth.js";
import type * as chatModel from "../chatModel.js";
import type * as chatOwner from "../chatOwner.js";
import type * as chatValidators from "../chatValidators.js";
import type * as groundingEvaluation from "../groundingEvaluation.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as knowledge from "../knowledge.js";
import type * as knowledgeCleanup from "../knowledgeCleanup.js";
import type * as knowledgeExtract from "../knowledgeExtract.js";
import type * as knowledgeInternal from "../knowledgeInternal.js";
import type * as knowledgeModel from "../knowledgeModel.js";
import type * as knowledgeNode from "../knowledgeNode.js";
import type * as knowledgeOrphans from "../knowledgeOrphans.js";
import type * as knowledgeRag from "../knowledgeRag.js";
import type * as typingPresence from "../typingPresence.js";
import type * as widgetBootstrap from "../widgetBootstrap.js";
import type * as widgetChat from "../widgetChat.js";
import type * as widgetChatInternal from "../widgetChatInternal.js";
import type * as widgetSettings from "../widgetSettings.js";
import type * as workspaceModel from "../workspaceModel.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiAgent: typeof aiAgent;
  aiAutomation: typeof aiAutomation;
  aiModel: typeof aiModel;
  aiResponder: typeof aiResponder;
  aiResponderOrchestration: typeof aiResponderOrchestration;
  auth: typeof auth;
  chatModel: typeof chatModel;
  chatOwner: typeof chatOwner;
  chatValidators: typeof chatValidators;
  groundingEvaluation: typeof groundingEvaluation;
  health: typeof health;
  http: typeof http;
  inbox: typeof inbox;
  knowledge: typeof knowledge;
  knowledgeCleanup: typeof knowledgeCleanup;
  knowledgeExtract: typeof knowledgeExtract;
  knowledgeInternal: typeof knowledgeInternal;
  knowledgeModel: typeof knowledgeModel;
  knowledgeNode: typeof knowledgeNode;
  knowledgeOrphans: typeof knowledgeOrphans;
  knowledgeRag: typeof knowledgeRag;
  typingPresence: typeof typingPresence;
  widgetBootstrap: typeof widgetBootstrap;
  widgetChat: typeof widgetChat;
  widgetChatInternal: typeof widgetChatInternal;
  widgetSettings: typeof widgetSettings;
  workspaceModel: typeof workspaceModel;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  rag: import("@convex-dev/rag/_generated/component.js").ComponentApi<"rag">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
