# IdeaMelt

Where ambitious ideas are found.

IdeaMelt is a sci-fi-to-startup opportunity scout. The private v0 generates one daily Sci-Fi Spotlight, saves it, and can send it to Tomas on Telegram at 10:00 London time.

## Private daily MVP

The current private loop is intentionally small:

- Generate one weird future startup scout issue.
- Randomly pull 3 seed ideas from the Google Sheets `Sci-Fi Idea Bank` when `IDEAMELT_USE_SCI_FI_SHEET=true`.
- Ignore already-used rows if a usage column exists.
- Save it locally as Markdown and JSON under `data/issues/`.
- Save it into Obsidian when `IDEAMELT_SAVE_OBSIDIAN=true`.
- Send it to Telegram when run with `--send`.
- Keep it private until Tomas manually decides it is worth publishing.

No Reddit Radar or Twitter/X Trend Watch yet.

## Setup

Copy the example env file:

```bash
cp .env.example .env
```

Fill these values for the daily generator:

```bash
OPENAI_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
IDEAMELT_TIMEZONE=Europe/London
IDEAMELT_SEND_TIME=10:00
IDEAMELT_TONE=weird future startup scout
IDEAMELT_SAVE_OBSIDIAN=true
OBSIDIAN_VAULT_PATH=/home/casapipamania/Documents/Obsidian Vault
IDEAMELT_OBSIDIAN_ISSUES_DIR=1_Projects/IdeaMelt Issues
IDEAMELT_USE_SCI_FI_SHEET=true
IDEAMELT_SCI_FI_SHEET_ID=1l-nAXUFh9ydEAOgd44FwgMA6kr5VlbimWo3xISA8mtI
IDEAMELT_SCI_FI_SHEET_NAME=Sci-Fi Idea Bank
IDEAMELT_SCI_FI_SOURCE_COUNT=3
IDEAMELT_SCI_FI_USED_COLUMN=IdeaMelt Chosen At
IDEAMELT_MARK_SCI_FI_SOURCES_USED=true
IDEAMELT_GOOGLE_TOKEN_PATH=/home/casapipamania/.hermes/google_token.json
```

Do not commit `.env`.

`IDEAMELT_MARK_SCI_FI_SOURCES_USED=true` writes the issue date/slug into the `IdeaMelt Chosen At` usage column after a successful generation. Use Tomas's owned copy of the sheet (`Cópia de Sci-Fi Idea Bank`) for this flow; the original `Sci-Fi Idea Bank` is read-only for this account.

## Commands

Run tests:

```bash
npm test
```

Generate a sample issue without OpenAI, Telegram, or other external side effects:

```bash
npm run ideamelt:dry-run
```

Generate a real issue with OpenAI and save it:

```bash
npm run ideamelt:generate
```

Send a simple Telegram test:

```bash
npm run ideamelt:send-test
```

Generate, save, and send the daily issue to Telegram:

```bash
npm run ideamelt:generate-send
```

## Scheduling at 10:00 London time

Recommended cron on a Linux machine that stays on:

```cron
TZ=Europe/London
0 10 * * * cd /home/casapipamania/projects/IdeaMelt && npm run ideamelt:generate-send >> /tmp/ideamelt-cron.log 2>&1
```

If running through another scheduler, keep the timezone as `Europe/London` and run:

```bash
cd /home/casapipamania/projects/IdeaMelt && npm run ideamelt:generate-send
```

## Current public/backend work

The repo also contains:

- static landing page: `index.html`, `styles.css`, `app.js`
- Supabase migration: `supabase/migrations/20260521120000_idea_melt_backend.sql`
- Supabase Edge Functions for subscribe, archive search, and beehiiv draft sync
- backend notes: `docs/backend.md`

That work is useful later, but the first validation target is private daily usefulness for Tomas.
