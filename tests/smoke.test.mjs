import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("signup forms are wired to frontend submit handler", () => {
  const html = read("index.html");
  const formMatches = html.match(/data-signup-form/g) || [];
  const config = read("app.config.js");
  const app = read("app.js");

  assert.equal(formMatches.length, 1);
  assert.match(html, /<script src="app\.config\.js"><\/script>/);
  assert.match(html, /<script src="app\.js" defer><\/script>/);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="favicon\.svg">/);
  assert.match(html, /name="email"/);
  assert.match(html, /placeholder="type your email here"/);
  assert.match(html, /Subscribe for crazy ideas before everyone else\./);
  assert.doesNotMatch(html, /This will bend your mind/);
  assert.match(html, /name="_gotcha"/);
  assert.match(html, /type="submit"/);
  assert.match(config, /formspreeEndpoint: "https:\/\/formspree\.io\/f\/mgojaavo"/);
  assert.match(app, /formspreeEndpoint/);
  assert.match(app, /Accept: "application\/json"/);
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

test("private daily generator supports Telegram and Obsidian settings", () => {
  const env = read(".env.example");
  const generator = read("scripts/generate-daily-melt.mjs");
  const packageJson = read("package.json");

  assert.match(env, /OPENAI_API_KEY=YOUR_OPENAI_API_KEY/);
  assert.match(env, /TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN/);
  assert.match(env, /TELEGRAM_CHAT_ID=YOUR_TELEGRAM_CHAT_ID/);
  assert.match(env, /IDEAMELT_TIMEZONE=Europe\/London/);
  assert.match(env, /IDEAMELT_SEND_TIME=10:00/);
  assert.match(env, /IDEAMELT_SAVE_OBSIDIAN=true/);
  assert.match(env, /IDEAMELT_TONE=weird future startup scout/);

  assert.match(generator, /Daily Sci-Fi Spotlight/);
  assert.match(generator, /saveObsidian/);
  assert.match(generator, /sendTelegram/);
  assert.match(generator, /chunkText/);
  assert.match(packageJson, /ideamelt:dry-run/);
  assert.match(packageJson, /ideamelt:generate-send/);
});

test("private daily generator can use the Sci-Fi Idea Bank without writing to Sheets by default", () => {
  const env = read(".env.example");
  const generator = read("scripts/generate-daily-melt.mjs");

  assert.match(env, /IDEAMELT_USE_SCI_FI_SHEET=true/);
  assert.match(env, /IDEAMELT_SCI_FI_SHEET_ID=1l-nAXUFh9ydEAOgd44FwgMA6kr5VlbimWo3xISA8mtI/);
  assert.match(env, /IDEAMELT_SCI_FI_SOURCE_COUNT=3/);
  assert.match(env, /IDEAMELT_SCI_FI_USED_COLUMN=IdeaMelt Chosen At/);
  assert.match(env, /IDEAMELT_MARK_SCI_FI_SOURCES_USED=true/);

  assert.match(generator, /loadSciFiSources/);
  assert.match(generator, /pickRandomItems/);
  assert.match(generator, /IdeaMelt Chosen At/);
  assert.match(generator, /markSciFiSourcesUsed/);
  assert.match(generator, /IDEAMELT_MARK_SCI_FI_SOURCES_USED/);
});
