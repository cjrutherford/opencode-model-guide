import type { ChangeEvent } from "@omg/shared";

import { formatEventType } from "./format";
import { slugify } from "./models";
import { url } from "./url";

export interface FeedOptions {
  site: string;
  base?: string;
}

const MAX_ITEMS = 100;
const MAX_TITLE_LENGTH = 140;

/**
 * Escape text for XML text nodes and attribute values.
 *
 * RSS readers are not browsers: URLs and summaries must be escaped here rather
 * than relying on CDATA. Invalid XML 1.0 control characters are removed.
 */
export function escapeXml(value: unknown): string {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absoluteHref(path: string, options: FeedOptions): string {
  return new URL(url(path, options.base), options.site).toString();
}

function eventTime(event: ChangeEvent): number {
  const parsed = Date.parse(event.at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function titleFor(event: ChangeEvent): string {
  const summary = event.summary.replace(/\s+/g, " ").trim();
  if (summary.length <= MAX_TITLE_LENGTH) return summary;
  return `${summary.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

function rfc822(value: number): string {
  return new Date(value).toUTCString();
}

/**
 * Build a valid RSS 2.0 document from the append-only event log.
 *
 * The feed is deliberately generated at build time; event delivery belongs to
 * S10 and must not depend on this builder.
 */
export function buildFeed(
  events: readonly ChangeEvent[],
  options: FeedOptions,
): string {
  const newestFirst = [...events].sort(
    (left, right) => eventTime(right) - eventTime(left),
  );
  const items = newestFirst.slice(0, MAX_ITEMS);
  const lastBuild = items.length > 0 ? eventTime(items[0]!) : Date.now();
  const base = options.base ?? "/";
  const channelLink = absoluteHref("/changes/", { ...options, base });
  const selfLink = absoluteHref("/feed.xml", { ...options, base });

  const itemXml = items
    .map((event) => {
      const link = absoluteHref(
        `/models/${slugify(event.modelKey)}/`,
        { ...options, base },
      );
      const pubDate = rfc822(eventTime(event) || Date.now());
      const description = `${formatEventType(event.type)}: ${event.summary}`;

      return [
        "    <item>",
        `      <title>${escapeXml(titleFor(event))}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(event.id)}</guid>`,
        `      <pubDate>${escapeXml(pubDate)}</pubDate>`,
        `      <description>${escapeXml(description)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>OpenCode Model Guide changes</title>",
    `    <link>${escapeXml(channelLink)}</link>`,
    "    <description>Free offers, price changes, new models, deprecations, and source issues for OpenCode-native models.</description>",
    "    <language>en-us</language>",
    `    <lastBuildDate>${escapeXml(rfc822(lastBuild))}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml" />`,
    ...(itemXml ? [itemXml] : []),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
