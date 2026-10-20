import type { APIRoute } from "astro";

import { loadData } from "../lib/data";
import { buildFeed } from "../lib/feed";

export const GET: APIRoute = ({ site }) => {
  const { events } = loadData();
  const body = buildFeed(events, {
    site: site?.toString() ?? "https://example.github.io",
    base: import.meta.env.BASE_URL,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
