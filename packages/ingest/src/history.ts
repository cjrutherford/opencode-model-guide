import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  Availability,
  FreeKind,
  Pricing,
  Snapshot,
} from "@omg/shared";

export const DEFAULT_HISTORY_DIR = "data/history";
export const HISTORY_KEEP_DAYS = 365;

export interface HistoryModel {
  key: string;
  pricing: Pricing;
  free: { kind: FreeKind };
  availability: Availability;
}

export interface HistoryRecord {
  date: string;
  generatedAt: string;
  models: HistoryModel[];
}

function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

export function toHistoryRecord(snapshot: Snapshot): HistoryRecord {
  return {
    date: snapshot.generatedAt.slice(0, 10),
    generatedAt: snapshot.generatedAt,
    models: snapshot.models.map((model) => ({
      key: model.key,
      pricing: model.pricing,
      free: { kind: model.free.kind },
      availability: model.availability,
    })),
  };
}

export async function writeHistory(
  snapshot: Snapshot,
  dir = DEFAULT_HISTORY_DIR,
): Promise<string> {
  const record = toHistoryRecord(snapshot);
  const path = join(dir, `${record.date}.json`);

  await mkdir(dir, { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporary, path);

  return path;
}

export async function pruneHistory(
  dir = DEFAULT_HISTORY_DIR,
  keepDays = HISTORY_KEEP_DAYS,
  now = new Date(),
): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(0, Math.floor(keepDays)));
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const removed: string[] = [];
  for (const name of names) {
    const match = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    if (!match) continue;
    if (match[1]! >= cutoffDate) continue;

    const path = join(dir, name);
    await rm(path);
    removed.push(path);
  }

  return removed.sort();
}
