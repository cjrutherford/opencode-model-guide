export function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

export function slugify(key: string): string {
  return key
    .replace("/", "--")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function eventId(type: string, key: string, at: string): string {
  return `${type}:${key}:${at.slice(0, 10)}`;
}

export function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(preview|free|instruct|stealth|contributor|unlimited|experimental)\b/g, " ")
    .replace(/\b(20\d{2}[-/]?\d{2}[-/]?\d{2})\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
