# Idea Melt Backend

Supabase is the source of truth for subscribers, issues, ideas, signals, tags, and public archive search. beehiiv is used for newsletter subscribers and draft post creation.

## 1. Configure the Static Site

Edit `app.config.js`:

```js
window.IDEA_MELT_CONFIG = {
  functionsBaseUrl: "https://bxvasrqaejkcvrkzqjsp.functions.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY"
};
```

The anon key is optional for the current public Edge Functions because `verify_jwt = false`, but keeping it in config makes future Supabase client usage straightforward. Never put the service-role key or beehiiv API key in browser code.

## 2. Apply the Database Migration

From this folder, after linking the Supabase project:

```powershell
supabase link --project-ref bxvasrqaejkcvrkzqjsp
supabase db push
```

The migration creates private subscriber tables, public published-archive tables with RLS, and the `search_public_archive` RPC used by the search function.

## 3. Set Edge Function Secrets

```powershell
supabase secrets set SUPABASE_URL=https://bxvasrqaejkcvrkzqjsp.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase secrets set BEEHIIV_PUBLICATION_ID=pub_xxx
supabase secrets set BEEHIIV_API_KEY=YOUR_BEEHIIV_API_KEY
supabase secrets set BEEHIIV_DOUBLE_OPT_OVERRIDE=not_set
supabase secrets set BEEHIIV_SEND_WELCOME_EMAIL=false
supabase secrets set PUBLIC_SITE_ORIGINS=https://ideamelt.com,https://www.ideamelt.com,http://127.0.0.1:4173
supabase secrets set SUBSCRIBE_IP_HASH_SALT=YOUR_LONG_RANDOM_SALT
supabase secrets set IDEA_MELT_SYNC_SECRET=YOUR_LONG_RANDOM_SYNC_SECRET
```

## 4. Deploy Edge Functions

```powershell
supabase functions deploy subscribe
supabase functions deploy search-archive
supabase functions deploy sync-beehiiv-post
```

## 5. Function Contracts

### `subscribe`

`POST /subscribe`

```json
{
  "email": "reader@example.com",
  "sourceForm": "hero",
  "website": "",
  "utm": {
    "utm_source": "newsletter"
  },
  "referringSite": "https://example.com"
}
```

Stores the subscriber in Supabase, records a hashed-IP attempt for rate limiting, then syncs to beehiiv via `POST /v2/publications/:publicationId/subscriptions`.

### `search-archive`

`GET /search-archive?q=robotics&tag=eldercare&minOpportunityScore=7`

Returns only ideas attached to `published` issues. It includes tags, signals, scores, and issue metadata.

### `sync-beehiiv-post`

`POST /sync-beehiiv-post`

Headers:

```text
Authorization: Bearer YOUR_IDEA_MELT_SYNC_SECRET
```

Body:

```json
{
  "issueSlug": "personal-memory-layer",
  "dryRun": false
}
```

Only `approved` or `published` issues can sync. New beehiiv posts are always created with `status: "draft"` so the email is not sent automatically. If `beehiiv_post_id` already exists, the function first checks beehiiv and refuses to patch unless that post is still a draft.

## 6. Beehiiv Caveat

beehiiv subscription sync is available through the regular API. beehiiv post creation/update is currently documented as beta and Enterprise-only, so the sync function is implemented but will fail cleanly unless the publication has access to that endpoint.
