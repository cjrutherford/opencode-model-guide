import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChangeEvent } from "@omg/shared";

import { notify } from "../src/ntfy";

function event(
  id: string,
  type: ChangeEvent["type"],
  summary = "Example is now free.",
  data: Record<string, unknown> = {},
): ChangeEvent {
  return {
    id,
    type,
    at: "2026-10-19T13:00:00.000Z",
    modelKey: "opencode/example",
    summary,
    data,
    notify: true,
  };
}

function sourceFailure(source = "models.dev"): ChangeEvent {
  return {
    id: `source_failed:system/${source}:2026-10-19`,
    type: "source_failed",
    at: "2026-10-19T13:00:00.000Z",
    modelKey: `system/${source}`,
    summary: `Required source ${source} failed: HTTP 503`,
    data: { source, error: "HTTP 503" },
    notify: true,
  };
}

function captureFetch() {
  const requests: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response("ok");
  };
  return { requests, fetch };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notify", () => {
  it("sends one summary and records the sent ids", async () => {
    const { requests, fetch } = captureFetch();
    const result = await notify({
      events: [
        event("free_started:a", "free_started"),
        event("free_ended:b", "free_ended"),
      ],
      state: { sent: [] },
      topic: "test-topic",
      site: "https://example.github.io/repo",
      fetch,
    });

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://ntfy.sh/test-topic");
    expect(request.headers.get("Title")).toContain("2 changes");
    expect(request.headers.get("Tags")).toContain("sparkles");
    expect(request.headers.get("Tags")).toContain("warning");
    expect(request.headers.get("Priority")).toBe("high");
    expect(request.headers.get("Click")).toBe(
      "https://example.github.io/repo/changes",
    );

    const body = await request.text();
    expect(body).toContain("2 changes");
    expect(body).toContain("1 new free model");
    expect(body).toContain("1 free offer ended");
    expect(body).toContain("- Example is now free.");
    expect(body).toContain("https://example.github.io/repo/changes");

    expect(result.sent).toBe(2);
    expect(result.state.sent).toHaveLength(2);
    expect(new Set(result.state.sent)).toEqual(
      new Set(["free_started:a", "free_ended:b"]),
    );
  });

  it("summarizes multiple free starts as new free models", async () => {
    const { requests, fetch } = captureFetch();
    const result = await notify({
      events: [
        event("free_started:a", "free_started"),
        event("free_started:b", "free_started"),
      ],
      state: { sent: [] },
      topic: "test-topic",
      site: "https://example.github.io/repo",
      fetch,
    });

    expect(requests).toHaveLength(1);
    expect(await requests[0]!.text()).toContain("2 new free models");
    expect(result.sent).toBe(2);
  });

  it("does nothing with no unsent events", async () => {
    let called = false;
    const result = await notify({
      events: [],
      state: { sent: [] },
      topic: "t",
      site: "https://example.github.io",
      fetch: async () => {
        called = true;
        return new Response("ok");
      },
    });

    expect(called).toBe(false);
    expect(result.sent).toBe(0);
    expect(result.state).toEqual({ sent: [] });
  });

  it("does not resend an event already in state", async () => {
    let called = false;
    const result = await notify({
      events: [event("free_started:a", "free_started")],
      state: { sent: ["free_started:a"] },
      topic: "t",
      site: "https://example.github.io",
      fetch: async () => {
        called = true;
        return new Response("ok");
      },
    });

    expect(called).toBe(false);
    expect(result.sent).toBe(0);
  });

  it("ignores events with notify false", async () => {
    let called = false;
    await notify({
      events: [{ ...event("model_added:a", "model_added"), notify: false }],
      state: { sent: [] },
      topic: "t",
      site: "https://example.github.io",
      fetch: async () => {
        called = true;
        return new Response("ok");
      },
    });

    expect(called).toBe(false);
  });

  it("prints a dry-run payload without sending or changing state", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { requests, fetch } = captureFetch();
    const result = await notify({
      events: [event("free_started:a", "free_started")],
      state: { sent: [] },
      topic: "secret-topic",
      site: "https://example.github.io/repo/",
      fetch,
      dryRun: true,
    });

    expect(requests).toHaveLength(0);
    expect(result.sent).toBe(1);
    expect(result.state).toEqual({ sent: [] });
    expect(log.mock.calls.flat().join("\n")).toContain("dry-run");
    expect(log.mock.calls.flat().join("\n")).toContain(
      "https://example.github.io/repo/changes",
    );
    expect(log.mock.calls.flat().join("\n")).not.toContain("secret-topic");
  });

  it("sends source failures as separate high-priority alerts", async () => {
    const { requests, fetch } = captureFetch();
    const result = await notify({
      events: [
        event("free_started:a", "free_started"),
        sourceFailure("models.dev"),
      ],
      state: { sent: [] },
      topic: "test-topic",
      site: "https://example.github.io/repo",
      fetch,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]!.headers.get("Click")).toBe(
      "https://example.github.io/repo/changes",
    );
    expect(requests[1]!.headers.get("Priority")).toBe("high");
    expect(requests[1]!.headers.get("Tags")).toBe("rotating_light");
    expect(requests[1]!.headers.get("Click")).toBe(
      "https://example.github.io/repo/health",
    );
    expect(requests[1]!.headers.get("Title")).toContain("models.dev");
    expect(await requests[1]!.text()).toContain("Required source models.dev failed");
    expect(result.sent).toBe(2);
  });

  it("sends only the source alert when there are no other changes", async () => {
    const { requests, fetch } = captureFetch();
    await notify({
      events: [sourceFailure("opencode.console-docs")],
      state: { sent: [] },
      topic: "test-topic",
      site: "https://example.github.io/repo",
      fetch,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get("Click")).toBe(
      "https://example.github.io/repo/health",
    );
  });

  it("throws on a non-2xx response with a short body", async () => {
    const longBody = "x".repeat(500);
    await expect(
      notify({
        events: [event("free_started:a", "free_started")],
        state: { sent: [] },
        topic: "test-topic",
        site: "https://example.github.io",
        fetch: async () => new Response(longBody, { status: 500 }),
      }),
    ).rejects.toThrow(/ntfy returned 500: x+/);
  });

  it("supports a custom ntfy server", async () => {
    const { requests, fetch } = captureFetch();
    await notify({
      events: [event("free_started:a", "free_started")],
      state: { sent: [] },
      topic: "test-topic",
      site: "https://example.github.io",
      server: "https://ntfy.example.com/",
      fetch,
    });

    expect(requests[0]!.url).toBe("https://ntfy.example.com/test-topic");
  });
});
