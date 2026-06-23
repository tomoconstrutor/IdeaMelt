const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !emailPattern.test(email)) {
    return null;
  }

  return email;
}

export function cleanText(value: unknown, fallback = "", maxLength = 160): string {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim().slice(0, maxLength) || fallback;
}

export function cleanNullableText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim().slice(0, maxLength);
  return text || null;
}

export function cleanSlug(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const slug = value.trim().toLowerCase();
  return slugPattern.test(slug) ? slug : null;
}

export function cleanUtm(value: unknown): Record<string, string> {
  const allowedKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const cleaned: Record<string, string> = {};

  for (const key of allowedKeys) {
    const item = source[key];
    if (typeof item === "string" && item.trim()) {
      cleaned[key] = item.trim().slice(0, 200);
    }
  }

  return cleaned;
}

export function parseTagSlugs(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return [...new Set(raw
    .map((item) => typeof item === "string" ? item.trim().toLowerCase() : "")
    .filter((item) => slugPattern.test(item))
  )];
}
