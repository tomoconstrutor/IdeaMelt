#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const send = args.has("--send");
const noSave = args.has("--no-save");
const verbose = args.has("--verbose");

if (dryRun && send) {
  throw new Error("Refusing --dry-run --send. Dry-run never performs external side effects.");
}

loadDotEnv();

const timezone = process.env.IDEAMELT_TIMEZONE || "Europe/London";
const tone = process.env.IDEAMELT_TONE || "weird future startup scout";
const date = formatDate(new Date(), timezone);
const sciFiSources = dryRun ? [] : await loadSciFiSources();
const concept = getConcept(sciFiSources);

const issue = dryRun
  ? sampleIssue({ date, concept, sources: sciFiSources })
  : await generateIssue({ date, concept, tone, sources: sciFiSources });

validateIssue(issue);

const markdown = formatMarkdown(issue);
const telegramText = formatTelegram(issue);
const json = JSON.stringify(issue, null, 2);

let localPaths = null;
let obsidianPath = null;
if (!noSave) {
  localPaths = await saveLocal(issue.slug, markdown, json);
  if (shouldSaveObsidian()) {
    obsidianPath = await saveObsidian(issue.slug, markdown);
  }
}

if (send) {
  await sendTelegram(telegramText);
}

if (!dryRun) {
  await markSciFiSourcesUsed(sciFiSources, issue.slug, date);
}

if (dryRun || verbose) {
  console.log(markdown);
} else {
  console.log(`IdeaMelt issue generated: ${issue.slug}`);
  if (localPaths) console.log(`Saved local Markdown: ${localPaths.markdownPath}`);
  if (localPaths) console.log(`Saved local JSON: ${localPaths.jsonPath}`);
  if (obsidianPath) console.log(`Saved Obsidian note: ${obsidianPath}`);
  if (send) console.log("Telegram delivery: sent");
}

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function getConcept(sources = []) {
  const provided = process.env.IDEAMELT_CONCEPT;
  if (provided && provided.trim()) return provided.trim();

  if (sources.length) {
    return sources.map((source) => source.deviceName).filter(Boolean).join(" + ");
  }

  const concepts = [
    "personal AI twin",
    "robot caregiver",
    "memory marketplace",
    "haptic dream recorder",
    "autonomous city concierge",
    "exoskeleton work assistant",
    "AI courtroom advocate",
    "synthetic pet companion",
    "climate-controlled personal bubble",
    "medical diagnosis pod",
    "bureaucracy autopilot",
    "emotion-aware home",
    "personal drone librarian",
    "AI ghostwriter for physical spaces",
    "augmented reality repair vision",
  ];

  const dayIndex = Math.floor(Date.now() / 86_400_000) % concepts.length;
  return concepts[dayIndex];
}

async function generateIssue({ date, concept, tone, sources = [] }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required unless running --dry-run.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const prompt = buildPrompt({ date, concept, tone, sources });

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.85,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const body = await response.json();
  const text = extractOutputText(body);
  const issue = parseJsonFromText(text);
  return normalizeIssue(issue, { date, concept, sources });
}

function buildPrompt({ date, concept, tone, sources = [] }) {
  const sourceBlock = formatSourceIdeasForPrompt(sources);
  return `You are writing IdeaMelt, a private daily sci-fi-to-startup scouting note for Tomas Ferreira.

Tone: ${tone}. Make it strange, sharp, fun, practical, and slightly provocative. Think Sam Parr / Neville Medhora style: direct hook, simple words, curiosity, useful business angle. No generic startup jargon.

Generate one daily Sci-Fi Spotlight for ${date} about: ${concept}

${sourceBlock}

Return ONLY valid JSON with this exact shape:
{
  "date": "${date}",
  "slug": "kebab-case-slug",
  "hook": "one punchy line",
  "concept": "${concept}",
  "whyNow": "short but specific why-now argument",
  "nowAtoms": ["physical-world thing already possible", "physical-world thing already possible"],
  "notYetAtoms": ["blocked physical-world thing", "blocked physical-world thing"],
  "notYetBits": ["software/AI product buildable sooner", "software/AI product buildable sooner"],
  "startupOpportunity": "one crisp business idea",
  "whoWouldPay": "ICP + why they care",
  "sevenDayMvp": "tiny practical 7-day build/test",
  "scores": { "difficulty": 1, "marketPull": 1, "weirdness": 1, "founderFit": 1 },
  "whyThisMightFail": "ruthless objection",
  "verdict": "kill | watch | test | build",
  "publishableShortVersion": "short social/newsletter blurb"
}

Quality rules:
- Do not sound generic.
- Do not describe a fantasy megacorp product as the MVP.
- Use the source idea bank seeds if provided, but synthesize them into one useful startup angle instead of merely summarizing the novels.
- Include a plausible buyer/user.
- Scores must be integers 1-10.
- The 7-day MVP must be doable by one builder.
- Make the reader think: “weird, but maybe real.”`;
}

function formatSourceIdeasForPrompt(sources) {
  if (!sources.length) return "Sci-fi source seeds: none provided today. Use the fallback concept list.";
  return `Sci-fi source seeds randomly chosen from the Sci-Fi Idea Bank today:\n${sources.map((source, index) => `${index + 1}. ${source.deviceName} (${source.date || "unknown year"}) — ${source.novel || "unknown work"} by ${source.author || "unknown author"}. Description: ${source.description || "n/a"}. Built: ${source.built || "n/a"}. Product/company clues: ${[source.product, source.byWhom, source.companiesWorkingOnThis].filter(Boolean).join("; ") || "n/a"}. Bits/Atoms: ${source.bitsOrAtoms || "n/a"}.`).join("\n")}`;
}

function extractOutputText(body) {
  if (typeof body.output_text === "string") return body.output_text;
  const chunks = [];
  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function parseJsonFromText(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function normalizeIssue(issue, fallback) {
  const slug = slugify(issue.slug || issue.concept || fallback.concept);
  return {
    date: issue.date || fallback.date,
    slug,
    hook: String(issue.hook || "A weird future signal with teeth."),
    concept: String(issue.concept || fallback.concept),
    whyNow: String(issue.whyNow || ""),
    nowAtoms: toStringArray(issue.nowAtoms),
    notYetAtoms: toStringArray(issue.notYetAtoms),
    notYetBits: toStringArray(issue.notYetBits),
    startupOpportunity: String(issue.startupOpportunity || ""),
    whoWouldPay: String(issue.whoWouldPay || ""),
    sevenDayMvp: String(issue.sevenDayMvp || ""),
    scores: {
      difficulty: parseScore(issue.scores?.difficulty),
      marketPull: parseScore(issue.scores?.marketPull),
      weirdness: parseScore(issue.scores?.weirdness),
      founderFit: parseScore(issue.scores?.founderFit),
    },
    whyThisMightFail: String(issue.whyThisMightFail || ""),
    verdict: String(issue.verdict || "test"),
    publishableShortVersion: String(issue.publishableShortVersion || ""),
    sciFiSources: fallback.sources || [],
  };
}

function validateIssue(issue) {
  const required = ["date", "slug", "hook", "concept", "whyNow", "startupOpportunity", "whoWouldPay", "sevenDayMvp", "whyThisMightFail", "verdict"];
  for (const key of required) {
    if (!issue[key]) throw new Error(`Issue missing required field: ${key}`);
  }
  for (const key of ["nowAtoms", "notYetAtoms", "notYetBits"]) {
    if (!Array.isArray(issue[key]) || issue[key].length < 1) throw new Error(`Issue needs at least one ${key} item.`);
  }
  for (const [key, value] of Object.entries(issue.scores)) {
    if (!Number.isInteger(value) || value < 1 || value > 10) throw new Error(`Score ${key} must be an integer from 1-10.`);
  }
  if (!["kill", "watch", "test", "build"].includes(issue.verdict.toLowerCase())) {
    throw new Error("Verdict must be one of: kill, watch, test, build.");
  }
  if (!issue.publishableShortVersion) {
    throw new Error("Issue missing required field: publishableShortVersion");
  }
}

function formatMarkdown(issue) {
  return `---\ntype: ideamelt-issue\nproject: IdeaMelt\ndate: ${issue.date}\nstatus: private\nconcept: ${quoteYaml(issue.concept)}\nverdict: ${quoteYaml(issue.verdict)}\n---\n\n# IdeaMelt — Daily Sci-Fi Spotlight — ${issue.date}\n\n## Hook\n${issue.hook}\n\n## Sci-fi concept\n${issue.concept}\n\n## Source seeds\n${formatSourceIdeasForMarkdown(issue.sciFiSources)}\n\n## Why this matters now\n${issue.whyNow}\n\n## Now Atoms\n${list(issue.nowAtoms)}\n\n## Not-Yet Atoms\n${list(issue.notYetAtoms)}\n\n## Not-Yet Bits\n${list(issue.notYetBits)}\n\n## Startup opportunity\n${issue.startupOpportunity}\n\n## Who would pay\n${issue.whoWouldPay}\n\n## 7-day MVP\n${issue.sevenDayMvp}\n\n## Scores\n- Difficulty: ${issue.scores.difficulty}/10\n- Market pull: ${issue.scores.marketPull}/10\n- Weirdness: ${issue.scores.weirdness}/10\n- Founder fit for Tomas: ${issue.scores.founderFit}/10\n\n## Why this might fail\n${issue.whyThisMightFail}\n\n## Robin's verdict\n${issue.verdict}\n\n## Publishable short version\n${issue.publishableShortVersion}\n`;
}

function formatTelegram(issue) {
  return `IDEAMELT — DAILY SCI-FI SPOTLIGHT\n${issue.date}\n\n${issue.hook}\n\nConcept: ${issue.concept}\n\nSource seeds:\n${formatSourceIdeasForTelegram(issue.sciFiSources)}\n\nWhy now:\n${issue.whyNow}\n\nNow Atoms:\n${list(issue.nowAtoms)}\n\nNot-Yet Atoms:\n${list(issue.notYetAtoms)}\n\nNot-Yet Bits:\n${list(issue.notYetBits)}\n\nStartup opportunity:\n${issue.startupOpportunity}\n\nWho would pay:\n${issue.whoWouldPay}\n\n7-day MVP:\n${issue.sevenDayMvp}\n\nScores:\n- Difficulty: ${issue.scores.difficulty}/10\n- Market pull: ${issue.scores.marketPull}/10\n- Weirdness: ${issue.scores.weirdness}/10\n- Founder fit: ${issue.scores.founderFit}/10\n\nWhy this might fail:\n${issue.whyThisMightFail}\n\nRobin's verdict: ${issue.verdict}\n\nPublishable short version:\n${issue.publishableShortVersion}`;
}

function formatSourceIdeasForMarkdown(sources = []) {
  if (!sources.length) return "- Fallback concept list used; no sheet seeds loaded.";
  return sources.map((source) => `- **${source.deviceName}** (${source.date || "unknown year"}) — ${source.novel || "unknown work"} by ${source.author || "unknown author"}. ${source.description || ""}`.trim()).join("\n");
}

function formatSourceIdeasForTelegram(sources = []) {
  if (!sources.length) return "- Fallback concept list used; no sheet seeds loaded.";
  return sources.map((source) => `- ${source.deviceName} (${source.date || "unknown year"})`).join("\n");
}

async function saveLocal(slug, markdown, json) {
  const dir = path.resolve(process.cwd(), "data/issues");
  await mkdir(dir, { recursive: true });
  const markdownPath = path.join(dir, `${slug}.md`);
  const jsonPath = path.join(dir, `${slug}.json`);
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(jsonPath, json, "utf8");
  return { markdownPath, jsonPath };
}

function shouldSaveObsidian() {
  return String(process.env.IDEAMELT_SAVE_OBSIDIAN || "false").toLowerCase() === "true";
}

async function saveObsidian(slug, markdown) {
  const vault = process.env.OBSIDIAN_VAULT_PATH;
  if (!vault) throw new Error("OBSIDIAN_VAULT_PATH is required when IDEAMELT_SAVE_OBSIDIAN=true.");
  const relativeDir = process.env.IDEAMELT_OBSIDIAN_ISSUES_DIR || "1_Projects/IdeaMelt Issues";
  if (path.isAbsolute(relativeDir)) {
    throw new Error("IDEAMELT_OBSIDIAN_ISSUES_DIR must be relative to the Obsidian vault.");
  }
  const vaultRoot = path.resolve(vault);
  const dir = path.resolve(vaultRoot, relativeDir);
  const relativeToVault = path.relative(vaultRoot, dir);
  if (relativeToVault.startsWith("..") || path.isAbsolute(relativeToVault)) {
    throw new Error("IDEAMELT_OBSIDIAN_ISSUES_DIR must stay inside OBSIDIAN_VAULT_PATH.");
  }
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${slug}.md`);
  await writeFile(filePath, markdown, "utf8");
  return filePath;
}

async function loadSciFiSources() {
  if (!isEnabled(process.env.IDEAMELT_USE_SCI_FI_SHEET)) return [];

  const spreadsheetId = process.env.IDEAMELT_SCI_FI_SHEET_ID;
  if (!spreadsheetId) throw new Error("IDEAMELT_SCI_FI_SHEET_ID is required when IDEAMELT_USE_SCI_FI_SHEET=true.");

  const sheetName = process.env.IDEAMELT_SCI_FI_SHEET_NAME || "Sci-Fi Idea Bank";
  const sourceCount = Number(process.env.IDEAMELT_SCI_FI_SOURCE_COUNT || 3);
  if (!Number.isInteger(sourceCount) || sourceCount < 1 || sourceCount > 10) {
    throw new Error("IDEAMELT_SCI_FI_SOURCE_COUNT must be an integer from 1-10.");
  }

  const values = await readSheetValues(spreadsheetId, `${quoteSheetName(sheetName)}!A1:Z5000`);
  const parsed = parseSciFiSheet(values);
  const unused = parsed.rows.filter((row) => !row.usedAt);
  const pool = unused.length >= sourceCount ? unused : parsed.rows;
  if (pool.length < sourceCount) {
    throw new Error(`Sci-Fi Idea Bank has only ${pool.length} usable rows; need ${sourceCount}.`);
  }

  return pickRandomItems(pool, sourceCount);
}

function parseSciFiSheet(values) {
  const headerRowIndex = values.findIndex((row) => row.includes("Device Name") && row.includes("Description"));
  if (headerRowIndex === -1) throw new Error("Could not find Sci-Fi Idea Bank header row with Device Name and Description.");

  const headers = values[headerRowIndex].map((header) => String(header || "").trim());
  const usedColumn = process.env.IDEAMELT_SCI_FI_USED_COLUMN || "IdeaMelt Chosen At";
  const index = (name) => headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
  const usedIndex = index(usedColumn);

  const rows = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const source = {
      rowNumber: rowIndex + 1,
      usedColumn,
      usedColumnIndex: usedIndex,
      date: cell(row, index("Date")),
      deviceName: cell(row, index("Device Name")),
      novel: cell(row, index("Novel")),
      author: cell(row, index("Author")),
      description: cell(row, index("Description")),
      built: cell(row, index("Built?")),
      byWhom: cell(row, index("By Whom?")),
      product: cell(row, index("Product")),
      firstYearMade: cell(row, index("First Year Made")),
      additionalDetails: cell(row, index("Additional Details")),
      bitsOrAtoms: cell(row, index("Bits or Atoms?")),
      companiesWorkingOnThis: cell(row, index("Companies Working on This")),
      usedAt: usedIndex === -1 ? "" : cell(row, usedIndex),
    };
    if (source.deviceName && source.description) rows.push(source);
  }
  return { headers, rows, usedColumnIndex: usedIndex };
}

async function markSciFiSourcesUsed(sources, issueSlug, date) {
  if (!sources.length || !isEnabled(process.env.IDEAMELT_MARK_SCI_FI_SOURCES_USED)) return;

  const missingColumn = sources.find((source) => source.usedColumnIndex === -1);
  if (missingColumn) {
    throw new Error(`Cannot mark Sci-Fi sources used because column "${missingColumn.usedColumn}" does not exist. Create it first, then rerun.`);
  }

  const spreadsheetId = process.env.IDEAMELT_SCI_FI_SHEET_ID;
  const sheetName = process.env.IDEAMELT_SCI_FI_SHEET_NAME || "Sci-Fi Idea Bank";
  const value = `${date} ${issueSlug}`;
  const data = sources.map((source) => ({
    range: `${quoteSheetName(sheetName)}!${columnName(source.usedColumnIndex + 1)}${source.rowNumber}`,
    values: [[value]],
  }));
  await writeSheetValues(spreadsheetId, data);
}

async function readSheetValues(spreadsheetId, range) {
  const params = new URLSearchParams({ majorDimension: "ROWS" });
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (apiKey) params.set("key", apiKey);

  const response = await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?${params.toString()}`, {
    method: "GET",
    headers: googleSheetsHeaders(Boolean(apiKey)),
  }, 30_000);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets read failed (${response.status}): ${text.slice(0, 500)}`);
  }
  const body = await response.json();
  return body.values || [];
}

async function writeSheetValues(spreadsheetId, data) {
  const response = await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    headers: { ...googleSheetsHeaders(false), "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  }, 30_000);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets write failed (${response.status}): ${text.slice(0, 500)}`);
  }
}

function googleSheetsHeaders(usingApiKey) {
  if (usingApiKey) return {};
  const token = process.env.GOOGLE_ACCESS_TOKEN || readGoogleAccessToken();
  if (!token) {
    throw new Error("Set GOOGLE_SHEETS_API_KEY, GOOGLE_ACCESS_TOKEN, or IDEAMELT_GOOGLE_TOKEN_PATH for Sci-Fi Idea Bank access.");
  }
  return { Authorization: `Bearer ${token}` };
}

function readGoogleAccessToken() {
  const tokenPath = process.env.IDEAMELT_GOOGLE_TOKEN_PATH || path.join(process.env.HOME || "", ".hermes/google_token.json");
  if (!existsSync(tokenPath)) return "";
  try {
    const token = JSON.parse(readFileSync(tokenPath, "utf8"));
    return token.access_token || token.token || "";
  } catch {
    return "";
  }
}

function pickRandomItems(items, count) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy.slice(0, count);
}

function cell(row, index) {
  if (index < 0) return "";
  return String(row[index] || "").trim();
}

function quoteSheetName(name) {
  return `'${String(name).replaceAll("'", "''")}'`;
}

function columnName(index) {
  let name = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required for --send.");

  for (const chunk of chunkText(text, 3900)) {
    const response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram send failed (${response.status}): ${body.slice(0, 500)}`);
    }
  }
}

function chunkText(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n\n", maxLength);
    if (cut < 1000) cut = maxLength;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function sampleIssue({ date, concept, sources = [] }) {
  return normalizeIssue({
    date,
    slug: `${date}-${concept}`,
    hook: "The future may not need a robot butler. It may need a butler for your chaos.",
    concept,
    whyNow: "People already live inside fragmented calendars, inboxes, tabs, forms, and apps. LLMs can now read, summarize, plan, and act across narrow workflows, while hardware robots are still expensive and clumsy.",
    nowAtoms: ["Voice assistants, smart home devices, and workflow automation already exist.", "LLMs can use tools, read documents, and draft actions with decent reliability in bounded tasks."],
    notYetAtoms: ["A safe general-purpose home robot is still too expensive and unreliable.", "Physical-world autonomy remains blocked by liability, dexterity, and edge-case chaos."],
    notYetBits: ["A personal bureaucracy autopilot that handles forms, renewals, appointments, and reminders.", "A household operations copilot that turns messy messages and documents into tasks."],
    startupOpportunity: "Build a narrow AI operations assistant for expats who drown in forms, appointments, renewals, insurance, and government portals.",
    whoWouldPay: "Expats, digital nomads, and relocation agencies because bureaucracy steals time and creates expensive mistakes.",
    sevenDayMvp: "Pick one painful workflow, like residency renewal reminders. Build a form intake, document checklist, deadline tracker, and AI-generated next-step plan. Sell it manually to 10 expats.",
    scores: { difficulty: 5, marketPull: 7, weirdness: 7, founderFit: 8 },
    whyThisMightFail: "The wedge gets killed if the product tries to automate official submissions before users trust it. Start with guidance and reminders, not full autopilot.",
    verdict: "test",
    publishableShortVersion: "Sci-fi promised robot butlers. The buildable version might be an AI butler for bureaucracy: forms, deadlines, renewals, and appointments for expats who hate admin.",
  }, { date, concept, sources });
}

function toStringArray(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function parseScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.round(score) : NaN;
}

async function fetchWithTimeout(url, options, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function list(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "ideamelt-issue";
}

function quoteYaml(value) {
  return JSON.stringify(String(value));
}

function formatDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
