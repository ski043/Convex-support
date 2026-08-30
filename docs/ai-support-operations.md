# AI support operations

MarshalDesk keeps application `messages` as the customer-visible canonical
transcript. Agent threads mirror accepted history for model context; RAG entries
contain workspace-scoped knowledge. Do not render or export component records
directly to customers.

## Runtime and dependencies

- Convex Node actions run on Node 24, configured in `convex.json`.
- Answers use `openai/gpt-5.6-terra` through Convex AI Gateway with `xhigh`
  reasoning.
- Embeddings use OpenAI `text-embedding-3-small` through `@ai-sdk/openai`.
- Agent, RAG, and Rate Limiter are mounted Convex components.

Convex AI Gateway must be available for the target deployment. Knowledge
processing also requires an OpenAI account/key with access to the embedding
model. Do not substitute either model without a product decision and a new
grounding evaluation.

## Required configuration

Set these independently for every Convex deployment:

- `OPENAI_API_KEY`: embedding-provider key. Convex functions use it during
  source ingestion and answer-time retrieval; it is never exposed to browsers.
- `WIDGET_BOOTSTRAP_SECRET`: random secret of at least 32 characters used to
  validate short-lived widget bootstrap tokens.
- `AI_AUTOMATION_ENABLED`: optional emergency switch. Any value other than the
  exact string `false` allows workspace settings to take effect.

The Next.js server/hosting environment also needs the **same**
`WIDGET_BOOTSTRAP_SECRET`, plus its existing `NEXT_PUBLIC_CONVEX_URL`. Never put
the OpenAI key in a public or browser environment variable.

Use the normal secret managers for Convex and the Next.js host. Avoid shell
history and never commit values to `.env*` files.

## Safe activation sequence

1. Confirm the target deployment by name and type. Production changes require
   fresh explicit approval.
2. Configure the embedding key and the same bootstrap secret in Convex and the
   Next.js server environment.
3. Synchronize the additive schema, component mounts, and functions.
4. In **Widget**, verify the exact customer-facing HTTP(S) origins against the
   sites where you installed the widget, then save them. Browser-reported
   origin activity is supporting evidence only: it is not authenticated and a
   list of more than 20 observations is explicitly incomplete. Saving changes
   the workspace from bounded legacy compatibility to enforced origin
   allowlisting; the list can be corrected and saved again from the dashboard.
   If an installed site was missed, **Restart origin discovery** temporarily
   returns the workspace to legacy-limited mode and clears the bounded
   100-origin observation history so the owner can rebuild and re-enforce the
   list.
5. In **Knowledge**, upload a small selectable-text fixture and wait for
   `Ready`. Confirm a failed/scanned fixture remains unsearchable.
6. Leave AI paused while verifying a no-answer case and an answerable case in a
   non-production workspace.
7. Enable AI for the workspace in **Knowledge → AI support**. A workspace with
   no saved AI settings remains human-only for migration safety.
8. Verify answer, no-answer handoff, explicit takeover, owner reply, resume,
   resolve/reopen, and owner-only evidence before expanding traffic.

Existing visitor capabilities keep their 30-day resume behavior. A legacy
visitor is bound to the allowed origin on its next successful resume. Unknown
origins cannot create or resume a session after enforcement.

### What origin enforcement does—and does not do

The origin allowlist is a **browser embedding boundary**. It ensures the loader,
iframe messaging, short-lived bootstrap, and resumed browser session agree on
an exact configured HTTP(S) origin. This prevents an ordinary third-party web
page from embedding a workspace widget as though it were an approved site.

It is not caller authentication against `curl`, server scripts, browser
extensions, or other non-browser clients: those clients can choose an `Origin`
header and call public endpoints directly. Visitor capability tokens protect
established sessions, while origin/session, workspace/global session,
visitor/workspace message, and workspace/global AI quotas bound automated
abuse and provider spend. CAPTCHA, bot attestation, and edge IP/reputation
controls remain optional extensions for installations that need a stronger
anti-automation perimeter.

## Emergency stop and recovery

Set `AI_AUTOMATION_ENABLED=false` on the affected Convex deployment to stop
provider execution and reject late canonical commits. Human owner replies,
takeover, resolution, knowledge recovery, and the canonical inbox remain
available. Restore the switch only after the incident is understood; workspace
AI settings remain unchanged.

Individual workspaces can be paused in the AI support card. Explicit pause
writes one visitor-safe handoff acknowledgement for a new message and marks the
conversation for human attention. A workspace that has never saved AI settings
stays human-only without changing existing chat behavior.

Knowledge deletion changes the application record to `deleting` before RAG and
storage cleanup, so it is excluded from new retrieval immediately. Replacement
keeps the prior ready document eligible until the replacement has finished, then
retires the old RAG entry and raw file. Processing claims have token-guarded
watchdogs, and storage deletion has bounded durable retries. If deletion reaches
its retry bound, repeating Delete starts a fresh cleanup generation without
allowing a stale callback to remove a newer record.

## Operational ceilings

Current code enforces bounded limits for widget-session creation, visitor and
workspace messages, global/workspace generation requests, four active
generation runs per workspace, token reservations and actual daily/monthly
usage, upload URL issuance, daily upload count/bytes, ingestion admission, and
automatic/manual ingestion retries. Owner replies, takeover, resolve, and
knowledge recovery do not consume visitor AI quotas.

Review the constants in `convex/widgetChat.ts`, `convex/aiAutomation.ts`, and
`convex/knowledge.ts` before changing commercial limits. Retrieval thresholds
in `convex/knowledgeInternal.ts` are evaluation inputs rather than universal
confidence probabilities.

## Grounding evaluation and activation gate

`convex/groundingEvaluation.ts` contains the versioned
`grounding-v1.0.0` labelled corpus and deterministic harness. CI supplies
mocked retrieval and provider outputs, covering supported answers, missing or
low evidence, unsupported requests, fabricated claims using valid citation
IDs, visitor injection, and document injection. These tests verify the
application's exact-quote policy without invoking an embedding or answer
provider.

The current `0.55` vector threshold is not calibrated by mocked results and is
not a probability of correctness. Before production AI activation, run a
representative labelled corpus through the deployed embedding/retrieval stack,
measure answerable recall and unsafe-answer precision, and calibrate or replace
the threshold from those results. Keep AI disabled if that real-corpus gate has
not passed.

## Migration and rollback notes

The application tables and message provenance fields are additive/optional for
existing data. Legacy conversations receive automation state lazily, and their
canonical history is mirrored in sequence with durable links before generation.
No customer-visible transcript is migrated into Agent component storage.

Pausing AI is the preferred rollback. Removing component mounts or tables while
data exists is not a safe rollback. If code rollback is required, first pause AI,
allow or discard active runs, retain the additive schema, and keep the widget
bootstrap route compatible until every installed widget has moved to the chosen
release.
