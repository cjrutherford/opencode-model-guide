import { readFile } from "node:fs/promises";

import { normalizeModelName } from "@omg/shared";

export const DEFAULT_ALIASES_PATH = "data/aliases.json";

function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

export async function loadAliases(
  path = DEFAULT_ALIASES_PATH,
): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return {};
    throw new Error(
      `could not read aliases at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `invalid JSON in aliases at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`aliases at ${path} must be a JSON object`);
  }

  const aliases: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`alias "${key}" must map to a non-empty model key`);
    }
    const normalized = normalizeModelName(key);
    if (!normalized) {
      throw new Error(`alias "${key}" normalizes to an empty string`);
    }
    const existing = aliases[normalized];
    if (existing !== undefined && existing !== value) {
      throw new Error(
        `aliases "${key}" and another key both normalize to "${normalized}"`,
      );
    }
    aliases[normalized] = value;
  }

  return aliases;
}
