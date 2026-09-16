export const WIDGET_BOOTSTRAP_VERSION = 1 as const;
export const WIDGET_BOOTSTRAP_TTL_MS = 5 * 60 * 1_000;

export type WidgetBootstrapClaims = {
  version: typeof WIDGET_BOOTSTRAP_VERSION;
  workspaceId: string;
  origin: string;
  policyVersion: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export function normalizeWidgetOrigin(value: string | null | undefined) {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.origin !== value
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isClaims(value: unknown): value is WidgetBootstrapClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Record<string, unknown>;
  return (
    claims.version === WIDGET_BOOTSTRAP_VERSION &&
    typeof claims.workspaceId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/u.test(claims.workspaceId) &&
    typeof claims.origin === "string" &&
    normalizeWidgetOrigin(claims.origin) === claims.origin &&
    typeof claims.policyVersion === "number" &&
    Number.isFinite(claims.policyVersion) &&
    typeof claims.issuedAt === "number" &&
    Number.isFinite(claims.issuedAt) &&
    typeof claims.expiresAt === "number" &&
    Number.isFinite(claims.expiresAt) &&
    claims.expiresAt > claims.issuedAt &&
    typeof claims.nonce === "string" &&
    /^[0-9a-f]{32}$/u.test(claims.nonce)
  );
}

export async function signWidgetBootstrap(
  claims: WidgetBootstrapClaims,
  secret: string,
) {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signature = base64UrlEncode(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

export async function verifyWidgetBootstrap(token: string, secret: string) {
  if (token.length > 4_096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const suppliedSignature = base64UrlDecode(signature);
  const payloadBytes = base64UrlDecode(payload);
  if (!suppliedSignature || !payloadBytes) return null;

  const expectedSignature = await hmac(secret, payload);
  if (suppliedSignature.length !== expectedSignature.length) return null;
  let mismatch = 0;
  for (let index = 0; index < expectedSignature.length; index += 1) {
    mismatch |= suppliedSignature[index] ^ expectedSignature[index];
  }
  if (mismatch !== 0) return null;

  try {
    const claims: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
    return isClaims(claims) ? claims : null;
  } catch {
    return null;
  }
}
