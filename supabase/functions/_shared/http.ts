export type JsonBody = Record<string, unknown> | unknown[] | string | number | boolean | null;

const defaultAllowedMethods = "GET,POST,OPTIONS";
const defaultAllowedHeaders = "authorization, x-client-info, apikey, content-type, x-sync-secret";
const defaultAllowedOrigins = "https://ideamelt.com,https://www.ideamelt.com,http://127.0.0.1:4173";

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  const configuredOrigins = (Deno.env.get("PUBLIC_SITE_ORIGINS") ?? defaultAllowedOrigins)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const allowAny = configuredOrigins.length === 0 || configuredOrigins.includes("*");
  const allowOrigin = allowAny || configuredOrigins.includes(origin) ? origin || "*" : configuredOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": defaultAllowedMethods,
    "Access-Control-Allow-Headers": defaultAllowedHeaders,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function optionsResponse(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export function jsonResponse(request: Request, body: JsonBody, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function errorResponse(request: Request, status: number, code: string, message: string): Response {
  return jsonResponse(request, { ok: false, code, message }, status);
}

export function requireMethod(request: Request, allowed: string[]): Response | null {
  if (request.method === "OPTIONS") {
    return optionsResponse(request);
  }

  if (!allowed.includes(request.method)) {
    return errorResponse(request, 405, "method_not_allowed", "Method not allowed.");
  }

  return null;
}

export function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
