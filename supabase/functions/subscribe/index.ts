import { cleanNullableText, cleanText, cleanUtm, normalizeEmail } from "../_shared/validation.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { errorResponse, jsonResponse, requireMethod } from "../_shared/http.ts";

type SubscribePayload = {
  email?: unknown;
  sourceForm?: unknown;
  utm?: unknown;
  referringSite?: unknown;
  website?: unknown;
  company?: unknown;
};

type BeehiivSyncResult = {
  status: "synced" | "failed" | "skipped";
  subscriptionId: string | null;
  error: string | null;
};

const maxAttemptsPerHour = Number(Deno.env.get("SUBSCRIBE_MAX_ATTEMPTS_PER_HOUR") ?? "20");

Deno.serve(async (request) => {
  const methodResponse = requireMethod(request, ["POST"]);
  if (methodResponse) {
    return methodResponse;
  }

  try {
    const supabase = createServiceClient();
    const payload = await readJson<SubscribePayload>(request);
    if (!payload) {
      return errorResponse(request, 400, "invalid_json", "Request body must be valid JSON.");
    }

    const email = normalizeEmail(payload.email);
    const sourceForm = cleanText(payload.sourceForm, "unknown", 80);
    const utm = cleanUtm(payload.utm);
    const referringSite = cleanNullableText(payload.referringSite, 500);
    const ipHash = await hashIp(getClientIp(request));

    if (isHoneypotFilled(payload)) {
      await recordAttempt(supabase, {
        ipHash,
        email,
        sourceForm,
        success: false,
        reason: "honeypot",
      });

      return jsonResponse(request, {
        ok: true,
        status: "accepted",
        message: "Thanks, you are on the list.",
      });
    }

    if (!email) {
      await recordAttempt(supabase, {
        ipHash,
        email: null,
        sourceForm,
        success: false,
        reason: "invalid_email",
      });

      return errorResponse(request, 400, "invalid_email", "Enter a valid email address.");
    }

    if (await isRateLimited(supabase, ipHash)) {
      await recordAttempt(supabase, {
        ipHash,
        email,
        sourceForm,
        success: false,
        reason: "rate_limited",
      });

      return errorResponse(request, 429, "rate_limited", "Too many signup attempts. Try again later.");
    }

    const now = new Date().toISOString();
    const existing = await findSubscriber(supabase, email);
    const subscriber = existing
      ? await updateSubscriber(supabase, existing, { sourceForm, utm, referringSite, consentAt: now })
      : await createSubscriber(supabase, { email, sourceForm, utm, referringSite, consentAt: now });

    if (subscriber.beehiiv_sync_status === "synced" && subscriber.beehiiv_subscription_id) {
      await recordAttempt(supabase, {
        ipHash,
        email,
        sourceForm,
        success: true,
        reason: "already_synced",
      });

      return jsonResponse(request, {
        ok: true,
        status: "already_subscribed",
        message: "You are already on the list.",
      });
    }

    const beehiivResult = await syncToBeehiiv({ email, sourceForm, utm, referringSite });
    await updateBeehiivStatus(supabase, subscriber.id, beehiivResult);
    await recordAttempt(supabase, {
      ipHash,
      email,
      sourceForm,
      success: beehiivResult.status !== "failed",
      reason: beehiivResult.status,
    });

    return jsonResponse(request, {
      ok: true,
      status: beehiivResult.status === "failed" ? "saved_not_synced" : "subscribed",
      beehiivSyncStatus: beehiivResult.status,
      message: "Thanks, you are on the list.",
    }, beehiivResult.status === "failed" ? 202 : 200);
  } catch (error) {
    console.error("subscribe unexpected error", error);
    return errorResponse(request, 500, "server_error", "Signup failed. Try again in a moment.");
  }
});

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return await request.json() as T;
  } catch {
    return null;
  }
}

function isHoneypotFilled(payload: SubscribePayload): boolean {
  return Boolean(
    typeof payload.website === "string" && payload.website.trim()
      || typeof payload.company === "string" && payload.company.trim()
  );
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
}

async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("SUBSCRIBE_IP_HASH_SALT") ?? "idea-melt-dev-salt";
  const encoded = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function isRateLimited(supabase: ReturnType<typeof createServiceClient>, ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("subscribe_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if (error) {
    console.error("subscribe_attempts rate-limit check failed", error);
    return false;
  }

  return (count ?? 0) >= maxAttemptsPerHour;
}

async function recordAttempt(
  supabase: ReturnType<typeof createServiceClient>,
  attempt: {
    ipHash: string;
    email: string | null;
    sourceForm: string;
    success: boolean;
    reason: string;
  },
) {
  const { error } = await supabase.from("subscribe_attempts").insert({
    ip_hash: attempt.ipHash,
    email: attempt.email,
    source_form: attempt.sourceForm,
    success: attempt.success,
    reason: attempt.reason,
  });

  if (error) {
    console.error("subscribe_attempts insert failed", error);
  }
}

async function findSubscriber(supabase: ReturnType<typeof createServiceClient>, email: string) {
  const { data, error } = await supabase
    .from("subscribers")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function createSubscriber(
  supabase: ReturnType<typeof createServiceClient>,
  input: {
    email: string;
    sourceForm: string;
    utm: Record<string, string>;
    referringSite: string | null;
    consentAt: string;
  },
) {
  const { data, error } = await supabase
    .from("subscribers")
    .insert({
      email: input.email,
      source_form: input.sourceForm,
      utm: input.utm,
      referring_site: input.referringSite,
      consent_at: input.consentAt,
      beehiiv_sync_status: "pending",
      beehiiv_sync_error: null,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function updateSubscriber(
  supabase: ReturnType<typeof createServiceClient>,
  existing: Record<string, unknown>,
  input: {
    sourceForm: string;
    utm: Record<string, string>;
    referringSite: string | null;
    consentAt: string;
  },
) {
  const shouldRetryBeehiiv = existing.beehiiv_sync_status !== "synced";
  const { data, error } = await supabase
    .from("subscribers")
    .update({
      source_form: input.sourceForm,
      utm: input.utm,
      referring_site: input.referringSite,
      consent_at: input.consentAt,
      ...(shouldRetryBeehiiv ? {
        beehiiv_sync_status: "pending",
        beehiiv_sync_error: null,
      } : {}),
    })
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function syncToBeehiiv(input: {
  email: string;
  sourceForm: string;
  utm: Record<string, string>;
  referringSite: string | null;
}): Promise<BeehiivSyncResult> {
  const apiKey = Deno.env.get("BEEHIIV_API_KEY");
  const publicationId = Deno.env.get("BEEHIIV_PUBLICATION_ID");

  if (!apiKey || !publicationId) {
    return {
      status: "skipped",
      subscriptionId: null,
      error: "Missing BEEHIIV_API_KEY or BEEHIIV_PUBLICATION_ID.",
    };
  }

  const body = pruneUndefined({
    email: input.email,
    reactivate_existing: false,
    send_welcome_email: Deno.env.get("BEEHIIV_SEND_WELCOME_EMAIL") === "true",
    double_opt_override: Deno.env.get("BEEHIIV_DOUBLE_OPT_OVERRIDE") ?? "not_set",
    utm_source: input.utm.utm_source,
    utm_medium: input.utm.utm_medium,
    utm_campaign: input.utm.utm_campaign,
    utm_term: input.utm.utm_term,
    utm_content: input.utm.utm_content,
    referring_site: input.referringSite,
    custom_fields: [
      { name: "Source Form", value: input.sourceForm },
    ],
  });

  try {
    const response = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const responseBody = await safeJson(response);
    if (!response.ok) {
      return {
        status: "failed",
        subscriptionId: null,
        error: `beehiiv_${response.status}: ${extractBeehiivError(responseBody)}`,
      };
    }

    return {
      status: "synced",
      subscriptionId: typeof responseBody?.data?.id === "string" ? responseBody.data.id : null,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      subscriptionId: null,
      error: error instanceof Error ? error.message : "Unknown beehiiv sync error.",
    };
  }
}

async function updateBeehiivStatus(
  supabase: ReturnType<typeof createServiceClient>,
  subscriberId: string,
  result: BeehiivSyncResult,
) {
  const { error } = await supabase
    .from("subscribers")
    .update({
      beehiiv_subscription_id: result.subscriptionId,
      beehiiv_sync_status: result.status,
      beehiiv_sync_error: result.error,
    })
    .eq("id", subscriberId);

  if (error) {
    throw error;
  }
}

function pruneUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  );
}

async function safeJson(response: Response): Promise<Record<string, any> | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractBeehiivError(body: Record<string, any> | null): string {
  if (!body) {
    return "Unknown beehiiv error.";
  }

  if (typeof body.message === "string") {
    return body.message;
  }

  if (typeof body.error === "string") {
    return body.error;
  }

  return JSON.stringify(body).slice(0, 500);
}
