import { createServiceClient } from "../_shared/supabase.ts";
import { clampInteger, errorResponse, jsonResponse, requireMethod } from "../_shared/http.ts";
import { cleanNullableText, parseTagSlugs } from "../_shared/validation.ts";

type SearchInput = {
  q?: unknown;
  query?: unknown;
  tags?: unknown;
  tag?: unknown;
  minOpportunityScore?: unknown;
  min_opportunity_score?: unknown;
  limit?: unknown;
};

Deno.serve(async (request) => {
  const methodResponse = requireMethod(request, ["GET", "POST"]);
  if (methodResponse) {
    return methodResponse;
  }

  try {
    const supabase = createServiceClient();
    const input = request.method === "GET"
      ? inputFromSearchParams(new URL(request.url).searchParams)
      : await readJson<SearchInput>(request);

    if (!input) {
      return errorResponse(request, 400, "invalid_json", "Request body must be valid JSON.");
    }

    const query = cleanNullableText(input.q ?? input.query, 200);
    const tags = parseTagSlugs(input.tags ?? input.tag);
    const minOpportunityScore = normalizeOptionalInteger(
      input.minOpportunityScore ?? input.min_opportunity_score,
      0,
      10,
    );
    const limit = clampInteger(input.limit, 25, 1, 100);

    const { data, error } = await supabase.rpc("search_public_archive", {
      search_query: query,
      tag_slugs: tags.length ? tags : null,
      min_opportunity_score: minOpportunityScore,
      result_limit: limit,
    });

    if (error) {
      console.error("search_public_archive failed", error);
      return errorResponse(request, 500, "search_failed", "Archive search failed.");
    }

    return jsonResponse(request, {
      ok: true,
      query,
      tags,
      minOpportunityScore,
      limit,
      results: data ?? [],
    });
  } catch (error) {
    console.error("search-archive unexpected error", error);
    return errorResponse(request, 500, "server_error", "Archive search failed.");
  }
});

function inputFromSearchParams(params: URLSearchParams): SearchInput {
  const tagValues = [
    ...params.getAll("tag"),
    ...params.getAll("tags"),
  ];

  return {
    q: params.get("q") ?? params.get("query"),
    tags: tagValues.length ? tagValues : null,
    minOpportunityScore: params.get("minOpportunityScore") ?? params.get("min_opportunity_score"),
    limit: params.get("limit"),
  };
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return await request.json() as T;
  } catch {
    return null;
  }
}

function normalizeOptionalInteger(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
