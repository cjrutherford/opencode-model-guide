import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ChangeEventSchema, type ChangeEvent } from "@omg/shared";

import { compareEvents } from "./diff";

export const DEFAULT_EVENTS_PATH = "data/events.jsonl";

interface EventsFile {
  events: ChangeEvent[];
  exists: boolean;
}

interface IssueLike {
  path?: Array<string | number>;
  message?: string;
}

function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function describe(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: IssueLike[] }).issues ?? [];
    const issue = issues[0];
    if (issue) {
      const path = issue.path && issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message ?? "invalid value"}`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

async function readEventsFile(path: string): Promise<EventsFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { events: [], exists: false };
    throw new Error(`could not read events at ${path}: ${describe(error)}`);
  }

  const events: ChangeEvent[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `invalid JSON in events at ${path}:${index + 1}: ${describe(error)}`,
      );
    }

    try {
      events.push(ChangeEventSchema.parse(raw));
    } catch (error) {
      throw new Error(
        `schema-invalid event at ${path}:${index + 1}: ${describe(error)}`,
      );
    }
  }

  return { events, exists: true };
}

export async function readEvents(path = DEFAULT_EVENTS_PATH): Promise<ChangeEvent[]> {
  return (await readEventsFile(path)).events;
}

export async function appendEvents(
  events: ChangeEvent[],
  path = DEFAULT_EVENTS_PATH,
): Promise<ChangeEvent[]> {
  for (const candidate of events) ChangeEventSchema.parse(candidate);

  const existing = await readEventsFile(path);
  const byId = new Map<string, ChangeEvent>();
  for (const candidate of existing.events) byId.set(candidate.id, candidate);

  let added = 0;
  for (const candidate of events) {
    if (byId.has(candidate.id)) continue;
    byId.set(candidate.id, candidate);
    added += 1;
  }

  const merged = [...byId.values()].sort(compareEvents);
  if (added === 0 && existing.exists) return merged;

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  const body = merged.length > 0 ? `${merged.map((event) => JSON.stringify(event)).join("\n")}\n` : "";
  await writeFile(temporary, body, "utf8");
  await rename(temporary, path);

  return merged;
}
