import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceError, fetchJson, fetchText } from "../src/http";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchJson", () => {
  it("returns parsed JSON on the first try", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson("test", "https://example.com/a.json")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on a 5xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson("test", "https://example.com/a.json")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson("test", "https://example.com/a.json")).rejects.toBeInstanceOf(
      SourceError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on a network error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson("test", "https://example.com/a.json")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("wraps invalid JSON in a SourceError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson("test", "https://example.com/a.json")).rejects.toThrow(
      /invalid JSON/i,
    );
  });

  it("sends the project User-Agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchJson("test", "https://example.com/a.json");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("user-agent")).toBe(
      "opencode-model-guide/1.0 (+https://github.com/cjrutherford/opencode-model-guide)",
    );
  });
});

describe("fetchText", () => {
  it("returns the response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("hello", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchText("test", "https://example.com/a.txt")).resolves.toBe("hello");
  });
});
