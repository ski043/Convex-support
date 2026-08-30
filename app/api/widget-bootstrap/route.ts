import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  normalizeWidgetOrigin,
  signWidgetBootstrap,
  WIDGET_BOOTSTRAP_TTL_MS,
  WIDGET_BOOTSTRAP_VERSION,
} from "@/lib/widget-bootstrap-token";

const workspacePattern = /^[A-Za-z0-9_-]{1,128}$/u;

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

  let workspaceId: string;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return reject(requestOrigin, 400);
    const candidate = (body as Record<string, unknown>).workspaceId;
    if (typeof candidate !== "string" || !workspacePattern.test(candidate)) {
      return reject(requestOrigin, 400);
    }
    workspaceId = candidate;
  } catch {
    return reject(requestOrigin, 400);
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.WIDGET_BOOTSTRAP_SECRET;
  if (!convexUrl || !secret || secret.length < 32) {
    return reject(requestOrigin, 503);
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    const policy = await client.query(api.widgetBootstrap.getPolicy, {
      workspaceId: workspaceId as Id<"workspaces">,
      origin: requestOrigin,
    });
    if (!policy?.allowed) return reject(requestOrigin);

    const issuedAt = Date.now();
    const bootstrapToken = await signWidgetBootstrap(
      {
        version: WIDGET_BOOTSTRAP_VERSION,
        workspaceId,
        origin: requestOrigin,
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
