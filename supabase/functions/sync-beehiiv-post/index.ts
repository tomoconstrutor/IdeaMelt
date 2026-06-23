import { createServiceClient } from "../_shared/supabase.ts";
import { cleanSlug } from "../_shared/validation.ts";
import { errorResponse, getBearerToken, jsonResponse, requireMethod } from "../_shared/http.ts";

type SyncPayload = {
  issueId?: unknown;
  issueSlug?: unknown;
  dryRun?: unknown;
};

type IssueRecord = {
  id: string;
  title: string;
  slug: string;
  status: string;
  summary: string | null;
  displayed_date: string | null;
  published_at: string | null;
  beehiiv_post_id: string | null;
};

type IdeaRecord = {
  id: string;
  title: string;
  slug: string;
  thesis: string | null;
  why_now: string | null;
  target_customer: string | null;
  market: string | null;
  type: string | null;
  opportunity_score: number | null;
  problem_score: number | null;
  feasibility_score: number | null;
  why_now_score: number | null;
  revenue_potential: string | null;
  execution_difficulty: string | null;
  go_to_market_notes: string | null;
  sort_order: number;
};

type SignalRecord = {
  id: string;
  issue_id: string | null;
  idea_id: string | null;
  signal_type: string;
  source_title: string;
  source_url: string | null;
  excerpt: string | null;
  source_date: string | null;
  confidence_score: number | null;
};

Deno.serve(async (request) => {
  const methodResponse = requireMethod(request, ["POST"]);
  if (methodResponse) {
    return methodResponse;
  }

  const syncSecret = Deno.env.get("IDEA_MELT_SYNC_SECRET");
  const suppliedSecret = getBearerToken(request) ?? request.headers.get("x-sync-secret");
  if (!syncSecret || suppliedSecret !== syncSecret) {
    return errorResponse(request, 401, "unauthorized", "Missing or invalid sync secret.");
  }

  try {
    const supabase = createServiceClient();
    const payload = await readJson<SyncPayload>(request);
    if (!payload) {
      return errorResponse(request, 400, "invalid_json", "Request body must be valid JSON.");
    }

    const issue = await fetchIssue(supabase, payload);
    if (!issue) {
      return errorResponse(request, 404, "issue_not_found", "Issue not found.");
    }

    if (!["approved", "published"].includes(issue.status)) {
      return errorResponse(request, 409, "issue_not_ready", "Only approved or published issues can sync to beehiiv.");
    }

    const ideas = await fetchIdeas(supabase, issue.id);
    const ideaIds = ideas.map((idea) => idea.id);
    const [issueSignals, ideaSignals, tagsByIdea] = await Promise.all([
      fetchIssueSignals(supabase, issue.id),
      fetchIdeaSignals(supabase, ideaIds),
      fetchTagsByIdea(supabase, ideaIds),
    ]);

    const bodyContent = renderIssueHtml({ issue, ideas, issueSignals, ideaSignals, tagsByIdea });
    const contentTags = unique([
      "idea-melt",
      ...Object.values(tagsByIdea).flat().map((tag) => tag.slug),
    ]);

    const beehiivPayload = pruneUndefined({
      title: issue.title,
      subtitle: issue.summary,
      body_content: bodyContent,
      content_tags: contentTags,
      email_settings: pruneUndefined({
        email_subject_line: issue.title,
        preview_text: issue.summary?.slice(0, 180),
      }),
      ...(issue.beehiiv_post_id ? {} : { status: "draft" }),
    });

    if (payload.dryRun === true) {
      return jsonResponse(request, {
        ok: true,
        dryRun: true,
        issueId: issue.id,
        beehiivPostId: issue.beehiiv_post_id,
        beehiivPayload,
      });
    }

    let beehiivResult: { postId: string | null; postUrl: string | null; error: string | null };
    try {
      beehiivResult = await createOrUpdateBeehiivPost(issue, beehiivPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown beehiiv sync error.";
      await markIssueSyncFailed(supabase, issue.id, message);
      return errorResponse(request, 502, "beehiiv_sync_failed", "beehiiv draft sync failed.");
    }

    await markIssueSyncSucceeded(supabase, issue.id, beehiivResult);

    return jsonResponse(request, {
      ok: true,
      issueId: issue.id,
      beehiivPostId: beehiivResult.postId,
      beehiivPostUrl: beehiivResult.postUrl,
      action: issue.beehiiv_post_id ? "updated_draft" : "created_draft",
    });
  } catch (error) {
    console.error("sync-beehiiv-post unexpected error", error);
    return errorResponse(request, 500, "sync_failed", "beehiiv sync failed.");
  }
});

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return await request.json() as T;
  } catch {
    return null;
  }
}

async function fetchIssue(supabase: ReturnType<typeof createServiceClient>, payload: SyncPayload): Promise<IssueRecord | null> {
  if (typeof payload.issueId === "string" && payload.issueId.trim()) {
    const { data, error } = await supabase
      .from("issues")
      .select("id,title,slug,status,summary,displayed_date,published_at,beehiiv_post_id")
      .eq("id", payload.issueId.trim())
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as IssueRecord | null;
  }

  const issueSlug = cleanSlug(payload.issueSlug);
  if (!issueSlug) {
    return null;
  }

  const { data, error } = await supabase
    .from("issues")
    .select("id,title,slug,status,summary,displayed_date,published_at,beehiiv_post_id")
    .eq("slug", issueSlug)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as IssueRecord | null;
}

async function fetchIdeas(supabase: ReturnType<typeof createServiceClient>, issueId: string): Promise<IdeaRecord[]> {
  const { data, error } = await supabase
    .from("ideas")
    .select("*")
    .eq("issue_id", issueId)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as IdeaRecord[];
}

async function fetchIssueSignals(supabase: ReturnType<typeof createServiceClient>, issueId: string): Promise<SignalRecord[]> {
  const { data, error } = await supabase
    .from("signals")
    .select("*")
    .eq("issue_id", issueId)
    .is("idea_id", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as SignalRecord[];
}

async function fetchIdeaSignals(supabase: ReturnType<typeof createServiceClient>, ideaIds: string[]): Promise<SignalRecord[]> {
  if (!ideaIds.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("signals")
    .select("*")
    .in("idea_id", ideaIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as SignalRecord[];
}

async function fetchTagsByIdea(
  supabase: ReturnType<typeof createServiceClient>,
  ideaIds: string[],
): Promise<Record<string, Array<{ name: string; slug: string }>>> {
  if (!ideaIds.length) {
    return {};
  }

  const { data, error } = await supabase
    .from("idea_tags")
    .select("idea_id,tags(name,slug)")
    .in("idea_id", ideaIds);

  if (error) {
    throw error;
  }

  const tagsByIdea: Record<string, Array<{ name: string; slug: string }>> = {};
  for (const row of data ?? []) {
    const ideaId = row.idea_id as string;
    const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags;
    if (!tag) {
      continue;
    }

    tagsByIdea[ideaId] ??= [];
    tagsByIdea[ideaId].push({
      name: String(tag.name),
      slug: String(tag.slug),
    });
  }

  return tagsByIdea;
}

async function createOrUpdateBeehiivPost(issue: IssueRecord, payload: Record<string, unknown>) {
  const apiKey = Deno.env.get("BEEHIIV_API_KEY");
  const publicationId = Deno.env.get("BEEHIIV_PUBLICATION_ID");

  if (!apiKey || !publicationId) {
    throw new Error("Missing BEEHIIV_API_KEY or BEEHIIV_PUBLICATION_ID.");
  }

  const isUpdate = Boolean(issue.beehiiv_post_id);
  const url = isUpdate
    ? `https://api.beehiiv.com/v2/publications/${publicationId}/posts/${issue.beehiiv_post_id}`
    : `https://api.beehiiv.com/v2/publications/${publicationId}/posts`;

  if (isUpdate) {
    await assertBeehiivPostIsDraft(url, apiKey);
  }

  const response = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`beehiiv_${response.status}: ${extractBeehiivError(body)}`);
  }

  return {
    postId: typeof body?.data?.id === "string" ? body.data.id : issue.beehiiv_post_id,
    postUrl: typeof body?.data?.web_url === "string" ? body.data.web_url : null,
    error: null,
  };
}

async function assertBeehiivPostIsDraft(url: string, apiKey: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
  });

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`beehiiv_${response.status}: ${extractBeehiivError(body)}`);
  }

  if (body?.data?.status !== "draft") {
    throw new Error("Refusing to update beehiiv post because it is no longer a draft.");
  }
}

async function markIssueSyncSucceeded(
  supabase: ReturnType<typeof createServiceClient>,
  issueId: string,
  result: { postId: string | null; postUrl: string | null; error: string | null },
) {
  const { error } = await supabase
    .from("issues")
    .update({
      beehiiv_post_id: result.postId,
      beehiiv_post_url: result.postUrl,
      beehiiv_sync_status: "synced",
      beehiiv_sync_error: result.error,
    })
    .eq("id", issueId);

  if (error) {
    throw error;
  }
}

async function markIssueSyncFailed(
  supabase: ReturnType<typeof createServiceClient>,
  issueId: string,
  message: string,
) {
  const { error } = await supabase
    .from("issues")
    .update({
      beehiiv_sync_status: "failed",
      beehiiv_sync_error: message,
    })
    .eq("id", issueId);

  if (error) {
    throw error;
  }
}

function renderIssueHtml(input: {
  issue: IssueRecord;
  ideas: IdeaRecord[];
  issueSignals: SignalRecord[];
  ideaSignals: SignalRecord[];
  tagsByIdea: Record<string, Array<{ name: string; slug: string }>>;
}): string {
  const dateLabel = input.issue.displayed_date ?? input.issue.published_at?.slice(0, 10) ?? "";
  const issueSignals = input.issueSignals.length
    ? `<h2>Issue Signals</h2>${renderSignals(input.issueSignals)}`
    : "";

  const ideas = input.ideas.map((idea) => {
    const tags = input.tagsByIdea[idea.id] ?? [];
    const signals = input.ideaSignals.filter((signal) => signal.idea_id === idea.id);
    const scoreLine = [
      score("Opportunity", idea.opportunity_score),
      score("Problem", idea.problem_score),
      score("Why now", idea.why_now_score),
      score("Feasibility", idea.feasibility_score),
    ].filter(Boolean).join(" · ");

    return `
      <article style="margin:0 0 32px 0;padding:0 0 24px 0;border-bottom:1px solid #d8d2c6;">
        <h2 style="margin:0 0 8px 0;">${escapeHtml(idea.title)}</h2>
        ${tags.length ? `<p style="margin:0 0 12px 0;color:#666;">${tags.map((tag) => escapeHtml(tag.name)).join(" / ")}</p>` : ""}
        ${idea.thesis ? `<p><strong>Thesis:</strong> ${escapeHtml(idea.thesis)}</p>` : ""}
        ${idea.why_now ? `<p><strong>Why now:</strong> ${escapeHtml(idea.why_now)}</p>` : ""}
        ${idea.target_customer ? `<p><strong>Target customer:</strong> ${escapeHtml(idea.target_customer)}</p>` : ""}
        ${idea.market || idea.type ? `<p><strong>Category:</strong> ${escapeHtml([idea.market, idea.type].filter(Boolean).join(" / "))}</p>` : ""}
        ${scoreLine ? `<p><strong>Scores:</strong> ${escapeHtml(scoreLine)}</p>` : ""}
        ${idea.revenue_potential ? `<p><strong>Revenue potential:</strong> ${escapeHtml(idea.revenue_potential)}</p>` : ""}
        ${idea.execution_difficulty ? `<p><strong>Execution difficulty:</strong> ${escapeHtml(idea.execution_difficulty)}</p>` : ""}
        ${idea.go_to_market_notes ? `<p><strong>Go-to-market:</strong> ${escapeHtml(idea.go_to_market_notes)}</p>` : ""}
        ${signals.length ? `<h3>Signals</h3>${renderSignals(signals)}` : ""}
      </article>
    `;
  }).join("");

  return `
    <main style="font-family:Arial,sans-serif;line-height:1.55;color:#111;">
      <p style="margin:0 0 10px 0;color:#666;">Idea Melt${dateLabel ? ` / ${escapeHtml(dateLabel)}` : ""}</p>
      <h1 style="margin:0 0 12px 0;">${escapeHtml(input.issue.title)}</h1>
      ${input.issue.summary ? `<p style="font-size:18px;">${escapeHtml(input.issue.summary)}</p>` : ""}
      ${issueSignals}
      ${ideas || "<p>No ideas have been attached to this issue yet.</p>"}
    </main>
  `;
}

function renderSignals(signals: SignalRecord[]): string {
  return `
    <ul>
      ${signals.map((signal) => `
        <li>
          <strong>${escapeHtml(signal.signal_type)}:</strong>
          ${signal.source_url
            ? `<a href="${escapeAttribute(signal.source_url)}">${escapeHtml(signal.source_title)}</a>`
            : escapeHtml(signal.source_title)}
          ${signal.excerpt ? `<br>${escapeHtml(signal.excerpt)}` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function score(label: string, value: number | null): string | null {
  return typeof value === "number" ? `${label} ${value}/10` : null;
}

function pruneUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
