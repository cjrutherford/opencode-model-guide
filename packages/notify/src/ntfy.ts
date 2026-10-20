import type { ChangeEvent } from "@omg/shared";

import { mergeSent, type NotifyState } from "./state";

export const DEFAULT_NTFY_SERVER = "https://ntfy.sh";
const MAX_SUMMARY_LINES = 20;

export interface NotifyOptions {
  events: ChangeEvent[];
  state: NotifyState;
  topic: string;
  /** Absolute site URL, including the Pages base path. */
  site: string;
  fetch: typeof fetch;
  dryRun?: boolean;
  /** Defaults to https://ntfy.sh. */
  server?: string;
}

export interface NotifyResult {
  sent: number;
  state: NotifyState;
}

interface Message {
  title: string;
  body: string;
  headers: Record<string, string>;
}

function normalizeBase(value: string, label: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function summaryCounts(events: readonly ChangeEvent[]): string[] {
  const counts = new Map<ChangeEvent["type"], number>();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }

  const parts: string[] = [];
  const add = (type: ChangeEvent["type"], singular: string, plural: string) => {
    const count = counts.get(type);
    if (count) parts.push(countPhrase(count, singular, plural));
  };

  add("free_started", "new free model", "new free models");
  add("free_ended", "free offer ended", "free offers ended");
  add("price_changed", "price change", "price changes");
  add("deprecated", "model deprecated", "models deprecated");
  add("model_added", "new model", "new models");
  return parts;
}

function summaryMessage(
  events: readonly ChangeEvent[],
  site: string,
): Message {
  const counts = summaryCounts(events);
  const count = events.length;
  const heading = `${countPhrase(count, "change", "changes")}${
    counts.length > 0 ? `: ${counts.join(" · ")}` : ""
  }`;

  const lines = [heading, ""];
  for (const event of events.slice(0, MAX_SUMMARY_LINES)) {
    lines.push(`- ${event.summary}`);
  }
  if (events.length > MAX_SUMMARY_LINES) {
    lines.push(`- …and ${events.length - MAX_SUMMARY_LINES} more`);
  }
  lines.push("", `${site}/changes`, "");

  const tags: string[] = [];
  if (events.some((event) => event.type === "free_started")) tags.push("sparkles");
  if (events.some((event) => event.type === "free_ended")) tags.push("warning");
  if (events.some((event) => event.type === "price_changed")) tags.push("money");

  const priority = events.some((event) => event.type === "free_ended")
    ? "high"
    : "default";

  const title = `OpenCode Model Guide - ${countPhrase(count, "change", "changes")}`;
  return {
    title,
    body: lines.join("\n"),
    headers: {
      Title: title,
      Tags: tags.length > 0 ? tags.join(",") : "information_source",
      Priority: priority,
      Click: `${site}/changes`,
    },
  };
}

function sourceMessage(event: ChangeEvent, site: string): Message {
  const source =
    typeof event.data.source === "string" && event.data.source.length > 0
      ? event.data.source
      : "required source";
  const title = `OpenCode Model Guide - source failure: ${source}`;
  return {
    title,
    body: `${event.summary}\n\n${site}/health\n`,
    headers: {
      Title: title,
      Tags: "rotating_light",
      Priority: "high",
      Click: `${site}/health`,
    },
  };
}

async function sendMessage(
  message: Message,
  opts: NotifyOptions,
  url: string,
): Promise<void> {
  if (opts.dryRun) {
    console.log(`[dry-run] ${message.title}`);
    console.log(message.body);
    console.log(`headers: ${JSON.stringify(message.headers)}`);
    return;
  }

  const response = await opts.fetch(url, {
    method: "POST",
    headers: message.headers,
    body: message.body,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300).replace(/\s+/g, " ").trim();
    throw new Error(
      `ntfy returned ${response.status}${detail.length > 0 ? `: ${detail}` : ""}`,
    );
  }
}

export async function notify(opts: NotifyOptions): Promise<NotifyResult> {
  const topic = opts.topic.trim();
  if (!topic) throw new Error("ntfy topic is required");

  const site = normalizeBase(opts.site, "site");
  const server = normalizeBase(opts.server ?? DEFAULT_NTFY_SERVER, "ntfy server");
  const url = `${server}/${encodeURIComponent(topic)}`;

  const alreadySent = new Set(opts.state.sent);
  const pending: ChangeEvent[] = [];
  const pendingIds = new Set<string>();
  for (const event of opts.events) {
    if (!event.notify || alreadySent.has(event.id) || pendingIds.has(event.id)) continue;
    pending.push(event);
    pendingIds.add(event.id);
  }

  if (pending.length === 0) {
    return { sent: 0, state: opts.state };
  }

  pending.sort(
    (left, right) =>
      left.at.localeCompare(right.at) || left.id.localeCompare(right.id),
  );

  const sourceEvents = pending.filter((event) => event.type === "source_failed");
  const changeEvents = pending.filter((event) => event.type !== "source_failed");

  if (changeEvents.length > 0) {
    await sendMessage(summaryMessage(changeEvents, site), opts, url);
  }
  for (const event of sourceEvents) {
    await sendMessage(sourceMessage(event, site), opts, url);
  }

  return {
    sent: pending.length,
    state: opts.dryRun
      ? opts.state
      : await mergeSent(
          opts.state,
          pending.map((event) => event.id),
        ),
  };
}
