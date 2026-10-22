import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo, Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  startEvalProxy,
  type EvalProxyHandle,
  type ProxyLogger,
} from "../src/proxy";

interface UpstreamRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

type UpstreamHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: string,
) => void | Promise<void>;

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startUpstream(handler: UpstreamHandler): Promise<{
  url: string;
  requests: UpstreamRequest[];
}> {
  const requests: UpstreamRequest[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        headers: request.headers,
        body,
      });
      void Promise.resolve(handler(request, response, body)).catch(() => {
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "text/plain" });
        }
        response.end("upstream error");
      });
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  return { url: `http://127.0.0.1:${port}`, requests };
}

async function startProxy(
  upstreamUrl: string,
  overrides: {
    maxBodyBytes?: number;
    maxConcurrent?: number;
    maxRequestsPerAttempt?: number;
    requestTimeoutMs?: number;
    logger?: ProxyLogger;
  } = {},
): Promise<EvalProxyHandle> {
  const handle = await startEvalProxy({
    apiKey: "real-eval-key",
    upstreamBaseUrl: `${upstreamUrl}/v1`,
    allowTestUpstream: true,
    host: "127.0.0.1",
    port: 0,
    adminHost: "127.0.0.1",
    adminPort: 0,
    logger: () => {},
    ...overrides,
  });
  cleanups.push(() => handle.close());
  return handle;
}

describe("eval proxy", () => {
  it("serves a local health endpoint without calling upstream", async () => {
    const upstream = await startUpstream((_request, response) => {
      response.end("{}");
    });
    const proxy = await startProxy(upstream.url);

    const health = await fetch(`${proxy.dataUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    expect(upstream.requests).toHaveLength(0);

    const adminHealth = await fetch(`${proxy.adminUrl}/health`);
    expect(adminHealth.status).toBe(200);
    expect(await adminHealth.json()).toEqual({ ok: true });
  });

  it("forwards only the allowed chat path with a stripped and injected auth header", async () => {
    const upstream = await startUpstream((_request, response, body) => {
      expect(body).toBe('{"messages":[{"role":"user","content":"hello"}]}');
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "leaked=1",
      });
      response.end('{"id":"chatcmpl-test"}');
    });
    const proxy = await startProxy(upstream.url);

    const response = await fetch(`${proxy.dataUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer attacker-key",
        cookie: "session=leak",
        "x-api-key": "leak",
        "x-forwarded-host": "evil.example",
        "x-eval-attempt": "attempt-1",
        "content-type": "application/json",
      },
      body: '{"messages":[{"role":"user","content":"hello"}]}',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "chatcmpl-test" });
    expect(response.headers.get("set-cookie")).toBeNull();

    expect(upstream.requests).toHaveLength(1);
    const received = upstream.requests[0]!;
    expect(received.method).toBe("POST");
    expect(received.url).toBe("/v1/chat/completions");
    expect(received.headers.authorization).toBe("Bearer real-eval-key");
    expect(received.headers.cookie).toBeUndefined();
    expect(received.headers["x-api-key"]).toBeUndefined();
    expect(received.headers["x-forwarded-host"]).toBeUndefined();
    expect(received.headers["x-eval-attempt"]).toBeUndefined();
    expect(received.body).toBe(
      '{"messages":[{"role":"user","content":"hello"}]}',
    );
  });

  it("forwards GET /v1/models", async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"data":[]}');
    });
    const proxy = await startProxy(upstream.url);

    const response = await fetch(`${proxy.dataUrl}/v1/models`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(upstream.requests[0]?.method).toBe("GET");
    expect(upstream.requests[0]?.url).toBe("/v1/models");
    expect(upstream.requests[0]?.headers.authorization).toBe(
      "Bearer real-eval-key",
    );
  });

  it("rejects other paths and methods without calling upstream", async () => {
    const upstream = await startUpstream((_request, response) => {
      response.end("{}");
    });
    const proxy = await startProxy(upstream.url);

    const unknown = await fetch(`${proxy.dataUrl}/v1/responses`, {
      method: "POST",
    });
    expect(unknown.status).toBe(404);

    const wrongMethod = await fetch(`${proxy.dataUrl}/v1/chat/completions`);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");

    const wrongModelsMethod = await fetch(`${proxy.dataUrl}/v1/models`, {
      method: "POST",
    });
    expect(wrongModelsMethod.status).toBe(405);
    expect(wrongModelsMethod.headers.get("allow")).toBe("GET");

    const nested = await fetch(`${proxy.dataUrl}/v1/models/extra`);
    expect(nested.status).toBe(404);
    expect(upstream.requests).toHaveLength(0);
  });

  it("refuses a non-opencode upstream in production mode", async () => {
    await expect(
      startEvalProxy({
        apiKey: "real-eval-key",
        upstreamBaseUrl: "https://evil.example/v1",
        port: 0,
        adminPort: 0,
      }),
    ).rejects.toThrow(/opencode\.ai/);
  });

  it("never logs the key or request bodies", async () => {
    const logs: Record<string, unknown>[] = [];
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });
    const proxy = await startProxy(upstream.url, {
      logger: (entry) => logs.push(entry),
    });

    const response = await fetch(`${proxy.dataUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer attacker-key",
        "x-eval-attempt": "attempt-logs",
        "content-type": "application/json",
      },
      body: '{"messages":[{"role":"user","content":"super-secret-prompt"}]}',
    });
    expect(response.status).toBe(200);

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("real-eval-key");
    expect(serialized).not.toContain("attacker-key");
    expect(serialized).not.toContain("super-secret-prompt");
    expect(serialized).toContain("attempt-logs");
    expect(logs.some((entry) => entry.path === "/v1/chat/completions")).toBe(true);
  });

  it("rejects oversized request bodies", async () => {
    const upstream = await startUpstream((_request, response) => {
      response.end("{}");
    });
    const proxy = await startProxy(upstream.url, { maxBodyBytes: 64 });

    const response = await fetch(`${proxy.dataUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(128),
    });

    expect(response.status).toBe(413);
    expect(upstream.requests).toHaveLength(0);
  });

  it("rejects requests over the concurrency limit", async () => {
    let releaseUpstream: () => void = () => {};
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const upstream = await startUpstream((_request, response) => {
      markStarted?.();
      void new Promise<void>((resolve) => {
        releaseUpstream = resolve;
      }).then(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true}');
      });
    });
    const proxy = await startProxy(upstream.url, { maxConcurrent: 1 });

    const first = fetch(`${proxy.dataUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await started;
    const second = await fetch(`${proxy.dataUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(second.status).toBe(429);

    releaseUpstream();
    expect((await first).status).toBe(200);
  });

  it("streams SSE responses instead of buffering them", async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write("data: first\n\n");
      setTimeout(() => {
        response.write("data: second\n\n");
        response.end();
      }, 300);
    });
    const proxy = await startProxy(upstream.url);

    const response = await fetch(`${proxy.dataUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("SSE response was buffered")), 200),
      ),
    ]);
    expect(new TextDecoder().decode(first.value)).toContain("data: first");

    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toContain("data: second");
    await reader.cancel();
  });

  it("returns a timeout when upstream does not respond", async () => {
    const upstream = await startUpstream(() => {
      // Intentionally never responds.
    });
    const proxy = await startProxy(upstream.url, { requestTimeoutMs: 100 });

    const response = await fetch(`${proxy.dataUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(504);
  });
});
