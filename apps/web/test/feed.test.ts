import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import type { ChangeEvent } from "@omg/shared";

import { buildFeed, escapeXml } from "../src/lib/feed";

const baseEvent: ChangeEvent = {
  id: "free_started:opencode/example:2026-10-19",
  type: "free_started",
  at: "2026-10-19T13:00:00.000Z",
  modelKey: "opencode/example",
  summary: "Example <script> is now free & unlimited.",
  data: {},
  notify: true,
};

function parse(xml: string): Record<string, unknown> {
  const parser = new XMLParser({ ignoreAttributes: false });
  return parser.parse(xml) as Record<string, unknown>;
}

function itemsOf(parsed: Record<string, unknown>): unknown[] {
  const rss = parsed.rss as { channel?: { item?: unknown | unknown[] } };
  const item = rss.channel?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

describe("buildFeed", () => {
  it("emits absolute links and escapes XML", () => {
    const xml = buildFeed([baseEvent], {
      site: "https://example.github.io",
      base: "/repo",
    });

    expect(xml).toContain(
      "<link>https://example.github.io/repo/models/opencode-example/</link>",
    );
    expect(xml).toContain("&lt;script&gt;");
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&amp;");
  });

  it("handles zero events", () => {
    const xml = buildFeed([], {
      site: "https://example.github.io",
      base: "/",
    });
    const parsed = parse(xml);

    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
    expect(itemsOf(parsed)).toHaveLength(0);
    expect(xml).toContain("<lastBuildDate>");
  });

  it("parses as well-formed RSS and keeps newest events first", () => {
    const older = {
      ...baseEvent,
      id: "model_added:opencode/older:2026-10-18",
      type: "model_added" as const,
      at: "2026-10-18T13:00:00.000Z",
      modelKey: "opencode/older",
      summary: "Older model added.",
    };
    const newer = {
      ...baseEvent,
      id: "price_changed:opencode/newer:2026-10-20",
      type: "price_changed" as const,
      at: "2026-10-20T13:00:00.000Z",
      modelKey: "opencode/newer",
      summary: "Newer price changed.",
    };
    const xml = buildFeed([older, newer], {
      site: "https://example.github.io",
      base: "/",
    });
    const parsed = parse(xml);
    const rss = parsed.rss as {
      channel: {
        title: string;
        link: string;
        lastBuildDate: string;
      };
    };
    const items = itemsOf(parsed) as Array<{
      title: string;
      link: string;
      guid: { "#text": string; "@_isPermaLink": string };
    }>;

    expect(rss.channel.title).toBe("OpenCode Model Guide changes");
    expect(rss.channel.link).toBe("https://example.github.io/changes/");
    expect(rss.channel.lastBuildDate).toContain("2026");
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe("Newer price changed.");
    expect(items[0]!.link).toBe(
      "https://example.github.io/models/opencode-newer/",
    );
    expect(items[0]!.guid).toEqual({
      "#text": "price_changed:opencode/newer:2026-10-20",
      "@_isPermaLink": "false",
    });
  });

  it("truncates titles and keeps at most 100 items", () => {
    const events = Array.from({ length: 105 }, (_, index): ChangeEvent => ({
      ...baseEvent,
      id: `model_added:opencode/model-${index}:2026-10-20`,
      type: "model_added",
      at: `2026-10-20T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
      modelKey: `opencode/model-${index}`,
      summary: "A".repeat(200),
    }));

    const xml = buildFeed(events, {
      site: "https://example.github.io",
      base: "/repo",
    });
    const items = itemsOf(parse(xml));

    expect(items).toHaveLength(100);
    expect(xml).toContain("A".repeat(139) + "…");
  });

  it("escapes quotes and strips invalid control characters", () => {
    expect(escapeXml(`<&>"'\u0000`)).toBe(
      "&lt;&amp;&gt;&quot;&apos;",
    );
  });
});
