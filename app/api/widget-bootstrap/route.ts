import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  normalizeWidgetOrigin,
  signWidgetBootstrap,
  WIDGET_BOOTSTRAP_TTL_MS,
  WIDGET_BOOTSTRAP_VERSION,
} from "@/lib/widget-bootstrap-token";
import { parseWidgetBootstrapRequest } from "@/lib/widget-bootstrap-request";

function corsHeaders(origin: string | null) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "300");
  }
  return headers;
}

function reject(origin: string | null, status = 403) {
  return Response.json(
    { error: "Widget bootstrap unavailable." },
    { status, headers: corsHeaders(origin) },
  );
}

export async function OPTIONS(request: Request) {
  const origin = normalizeWidgetOrigin(request.headers.get("origin"));
  return origin
    ? new Response(null, { status: 204, headers: corsHeaders(origin) })
    : reject(null, 400);
}

export async function POST(request: Request) {
  const requestOrigin = normalizeWidgetOrigin(request.headers.get("origin"));
  if (!requestOrigin) return reject(null, 400);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reject(requestOrigin, 415);
  }

  let parsed: ReturnType<typeof parseWidgetBootstrapRequest>;
  try {
    parsed = parseWidgetBootstrapRequest(await request.json());
  } catch {
    return reject(requestOrigin, 400);
  }
  if (!parsed) return reject(requestOrigin, 400);
  const { workspaceId, renewal } = parsed;

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.WIDGET_BOOTSTRAP_SECRET;
  if (!convexUrl || !secret || secret.length < 32) {
    return reject(requestOrigin, 503);
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    const policy = renewal
      ? await client.mutation(api.widgetBootstrap.getRenewalPolicy, {
          workspaceId: workspaceId as Id<"workspaces">,
          capabilityToken: renewal.capabilityToken,
          origin: renewal.origin,
        })
      : await client.query(api.widgetBootstrap.getPolicy, {
          workspaceId: workspaceId as Id<"workspaces">,
          origin: requestOrigin,
        });
    if (!policy?.allowed) return reject(requestOrigin);

    const policyOrigin = renewal?.origin ?? requestOrigin;

    const issuedAt = Date.now();
    const bootstrapToken = await signWidgetBootstrap(
      {
        version: WIDGET_BOOTSTRAP_VERSION,
        workspaceId,
        origin: policyOrigin,
        policyVersion: policy.policyVersion,
        issuedAt,
        expiresAt: issuedAt + WIDGET_BOOTSTRAP_TTL_MS,
        nonce: crypto.randomUUID().replaceAll("-", ""),
      },
      secret,
    );
    return Response.json(
      { bootstrapToken, expiresAt: issuedAt + WIDGET_BOOTSTRAP_TTL_MS },
      { headers: corsHeaders(requestOrigin) },
    );
  } catch {
    return reject(requestOrigin);
  }
}
