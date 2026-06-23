import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("signup forms are wired to frontend submit handler", () => {
  const html = read("index.html");
  const formMatches = html.match(/data-signup-form/g) || [];

  assert.equal(formMatches.length, 2);
  assert.match(html, /<script src="app\.config\.js"><\/script>/);
  assert.match(html, /<script src="app\.js" defer><\/script>/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="website"/);
  assert.match(html, /type="submit"/);
  assert.doesNotMatch(html, /Placeholder signup|Placeholder form/);
  assert.doesNotMatch(html, /Reddit|X Trend|Backlog: Reddit|twitter/i);
});

test("migration contains backend tables, RLS, and public search RPC", () => {
  const sql = read("supabase/migrations/20260521120000_idea_melt_backend.sql");

  for (const table of ["subscribers", "issues", "ideas", "signals", "tags", "idea_tags"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }

  assert.match(sql, /enable row level security/);
  assert.match(sql, /create or replace function public\.search_public_archive/);
  assert.match(sql, /grant execute on function public\.search_public_archive/);
});

test("subscribe function stores locally and syncs subscribers to beehiiv", () => {
  const source = read("supabase/functions/subscribe/index.ts");

  assert.match(source, /subscribe_attempts/);
  assert.match(source, /isHoneypotFilled/);
  assert.match(source, /rate_limited/);
  assert.match(source, /\/subscriptions/);
  assert.match(source, /BEEHIIV_API_KEY/);
});

test("beehiiv issue sync creates drafts and refuses non-draft updates", () => {
  const source = read("supabase/functions/sync-beehiiv-post/index.ts");

  assert.match(source, /status: "draft"/);
  assert.match(source, /assertBeehiivPostIsDraft/);
  assert.match(source, /Refusing to update beehiiv post/);
  assert.match(source, /IDEA_MELT_SYNC_SECRET/);
});
