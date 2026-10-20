import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULT_STATE_PATH = "data/notify-state.json";
export const MAX_SENT_IDS = 500;

export interface NotifyState {
  sent: string[];
}

function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function normalizeSent(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique.slice(-MAX_SENT_IDS);
}

function parseState(text: string, path: string): NotifyState {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid notify state at ${path}: ${message}`);
  }

  if (!raw || typeof raw !== "object" || !Array.isArray((raw as NotifyState).sent)) {
    throw new Error(`invalid notify state at ${path}: expected { "sent": string[] }`);
  }

  const sent = (raw as NotifyState).sent;
  if (sent.some((id) => typeof id !== "string")) {
    throw new Error(`invalid notify state at ${path}: sent ids must be strings`);
  }

  return { sent: normalizeSent(sent) };
}

export async function readState(path = DEFAULT_STATE_PATH): Promise<NotifyState> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { sent: [] };
    throw new Error(
      `could not read notify state at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return parseState(text, path);
}

export async function writeState(
  state: NotifyState,
  path = DEFAULT_STATE_PATH,
): Promise<void> {
  const normalized = { sent: normalizeSent(state.sent) };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function mergeSent(
  state: NotifyState,
  ids: readonly string[],
): Promise<NotifyState> {
  return { sent: normalizeSent([...state.sent, ...ids]) };
}
