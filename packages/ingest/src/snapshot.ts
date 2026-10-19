import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { SnapshotSchema, type Snapshot } from "@omg/shared";

export const DEFAULT_SNAPSHOT_PATH = "data/snapshot.json";

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
    const issues = (error as { issues?: Array<{ path?: Array<string | number>; message?: string }> })
      .issues;
    const issue = issues?.[0];
    if (issue) {
      const path = issue.path && issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message ?? "invalid value"}`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function readSnapshot(
  path = DEFAULT_SNAPSHOT_PATH,
): Promise<Snapshot | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw new Error(`could not read snapshot at ${path}: ${describe(error)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in snapshot at ${path}: ${describe(error)}`);
  }

  try {
    return SnapshotSchema.parse(raw);
  } catch (error) {
    throw new Error(`schema-invalid snapshot at ${path}: ${describe(error)}`);
  }
}

export async function writeSnapshotAtomic(
  snapshot: Snapshot,
  path = DEFAULT_SNAPSHOT_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
