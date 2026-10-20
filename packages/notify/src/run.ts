import { readEvents } from "@omg/ingest";

import { notify } from "./ntfy";
import { readState, writeState } from "./state";

const DEFAULT_SITE = "https://cjrutherford.github.io/opencode-model-guide";

export interface NotifyCliArgs {
  dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): NotifyCliArgs {
  const dryRun = argv.includes("--dry-run");
  for (const arg of argv) {
    if (arg !== "--dry-run") throw new Error(`unknown argument: ${arg}`);
  }
  return { dryRun };
}

export async function runNotify(args: NotifyCliArgs): Promise<void> {
  const topic = process.env.NTFY_TOPIC?.trim() ?? "";
  if (!topic) {
    console.error(
      "NTFY_TOPIC is not set; skipping notification. The site can still deploy.",
    );
    process.exitCode = args.dryRun ? 1 : 0;
    return;
  }

  const [events, state] = await Promise.all([readEvents(), readState()]);
  const site = process.env.SITE_URL?.trim() || DEFAULT_SITE;
  const server = process.env.NTFY_SERVER?.trim() || undefined;

  const result = await notify({
    events,
    state,
    topic,
    site,
    server,
    fetch: globalThis.fetch,
    dryRun: args.dryRun,
  });

  if (!args.dryRun && result.sent > 0) {
    await writeState(result.state);
  }

  if (args.dryRun) {
    console.log(
      result.sent > 0
        ? `dry-run: would notify ${result.sent} events`
        : "dry-run: no unsent events",
    );
  } else {
    console.log(
      result.sent > 0
        ? `notified ${result.sent} events`
        : "no unsent events; notification skipped",
    );
  }
}

async function main(): Promise<void> {
  await runNotify(parseArgs(process.argv.slice(2)));
}

const invokedDirectly =
  process.argv[1] !== undefined && /(?:^|[/\\])run\.ts$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
