import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL("https://example.github.io");
  const basePath = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const baseUrl = new URL(basePath, origin);
  const sitemap = new URL("sitemap-index.xml", baseUrl).toString();
  const body = [
    "User-agent: *",
    "Allow: /",
    `Sitemap: ${sitemap}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
