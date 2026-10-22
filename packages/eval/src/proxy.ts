import {
  createServer as createHttpServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

export const DEFAULT_UPSTREAM_BASE_URL = "https://opencode.ai/inference/v1";
export const DEFAULT_PROXY_PORT = 8787;
export const DEFAULT_ADMIN_PORT = 8788;

const ALLOWED_PATHS = new Map<
  string,
  { method: "GET" | "POST"; upstreamPath: string }
>([
  [
    "/v1/chat/completions",
    { method: "POST", upstreamPath: "/chat/completions" },
  ],
  ["/v1/models", { method: "GET", upstreamPath: "/models" }],
]);

const BLOCKED_INCOMING_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-eval-attempt",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
]);

const BLOCKED_OUTGOING_HEADERS = new Set([
  "set-cookie",
  "connection",
  "keep-alive",
  "transfer-encoding",
]);

export type ProxyLogger = (entry: Record<string, unknown>) => void;

export interface EvalProxyOptions {
  apiKey: string;
  upstreamBaseUrl?: string;
  host?: string;
  port?: number;
  adminHost?: string;
  adminPort?: number;
  maxBodyBytes?: number;
  maxConcurrent?: number;
  maxRequestsPerAttempt?: number;
  requestTimeoutMs?: number;
  logger?: ProxyLogger;
  /** Unit tests point the proxy at a local fake upstream. */
  allowTestUpstream?: boolean;
}

export interface EvalProxyStats {
  startedAt: string;
  requests: number;
  allowed: number;
  rejected: number;
  upstreamErrors: number;
  active: number;
  byStatus: Record<string, number>;
}

export interface EvalProxyHandle {
  dataUrl: string;
  adminUrl: string;
  port: number;
  adminPort: number;
  stats(): EvalProxyStats;
  close(): Promise<void>;
}

class BodyTooLargeError extends Error {}

function jsonResponse(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  response.end(body);
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://eval-proxy.local").pathname;
  } catch {
    return "/";
  }
}

function attemptId(request: IncomingMessage): string {
  const value = request.headers["x-eval-attempt"];
  const selected = Array.isArray(value) ? value[0] : value;
  if (typeof selected !== "string" || selected.length === 0) return "anonymous";
  return selected.slice(0, 128);
}

function readBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<Buffer> {
  const contentLength = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    request.resume();
    return Promise.reject(new BodyTooLargeError("request body is too large"));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;

    const cleanup = (): void => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    };
    const fail = (error: Error): void => {
      if (done) return;
      done = true;
      cleanup();
      request.resume();
      reject(error);
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        fail(new BodyTooLargeError("request body is too large"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (error: Error): void => fail(error);

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

function upstreamUrl(
  baseUrl: string,
  upstreamPath: string,
): URL {
  const target = new URL(baseUrl);
  target.pathname = `${target.pathname.replace(/\/+$/, "")}${upstreamPath}`;
  target.search = "";
  return target;
}

function forwardedHeaders(
  incoming: IncomingHttpHeaders,
  apiKey: string,
  bodyBytes: number,
  method: string,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (BLOCKED_INCOMING_HEADERS.has(lower)) continue;
    headers[lower] = value;
  }

  headers.authorization = `Bearer ${apiKey}`;
  if (method !== "GET" && method !== "HEAD") {
    headers["content-length"] = String(bodyBytes);
  }
  return headers;
}

function responseHeaders(incoming: IncomingHttpHeaders): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (BLOCKED_OUTGOING_HEADERS.has(lower)) continue;
    headers[lower] = value;
  }
  return headers;
}

function listen(
  server: Server,
  host: string,
  port: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address() as AddressInfo | null;
      if (!address) {
        reject(new Error("proxy server has no address"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function publicHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "127.0.0.1";
  }
  return host;
}

export async function startEvalProxy(
  options: EvalProxyOptions,
): Promise<EvalProxyHandle> {
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error("eval proxy requires OPENCODE_API_KEY");

  const upstreamBaseUrl = options.upstreamBaseUrl ?? DEFAULT_UPSTREAM_BASE_URL;
  const upstream = new URL(upstreamBaseUrl);
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error("eval proxy upstream must be http or https");
  }
  if (
    !options.allowTestUpstream &&
    (upstream.protocol !== "https:" || upstream.hostname !== "opencode.ai")
  ) {
    throw new Error("eval proxy upstream must be https://opencode.ai");
  }

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? DEFAULT_PROXY_PORT;
  const adminHost = options.adminHost ?? "127.0.0.1";
  const adminPort = options.adminPort ?? DEFAULT_ADMIN_PORT;
  const maxBodyBytes = options.maxBodyBytes ?? 4 * 1024 * 1024;
  const maxConcurrent = options.maxConcurrent ?? 4;
  const maxRequestsPerAttempt = options.maxRequestsPerAttempt ?? 500;
  const requestTimeoutMs = options.requestTimeoutMs ?? 180_000;
  const logger: ProxyLogger =
    options.logger ?? ((entry) => console.log(JSON.stringify(entry)));

  const startedAt = new Date().toISOString();
  const stats: EvalProxyStats = {
    startedAt,
    requests: 0,
    allowed: 0,
    rejected: 0,
    upstreamErrors: 0,
    active: 0,
    byStatus: {},
  };
  const attemptCounts = new Map<string, number>();
  const activeRequests = new Set<ClientRequest>();

  const record = (
    status: number,
    method: string,
    path: string,
    attempt: string,
    started: number,
  ): void => {
    stats.byStatus[String(status)] = (stats.byStatus[String(status)] ?? 0) + 1;
    logger({
      event: "proxy_request",
      method,
      path,
      status,
      attemptId: attempt,
      durationMs: Date.now() - started,
    });
  };

  const dataServer = createHttpServer((request, response) => {
    const started = Date.now();
    const path = requestPath(request);
    const method = request.method ?? "GET";
    const attempt = attemptId(request);

    if (path === "/health") {
      stats.requests += 1;
      jsonResponse(response, 200, { ok: true });
      record(200, method, path, attempt, started);
      return;
    }

    const route = ALLOWED_PATHS.get(path);
    if (!route) {
      stats.requests += 1;
      stats.rejected += 1;
      request.resume();
      jsonResponse(response, 404, { error: "not_found" });
      record(404, method, path, attempt, started);
      return;
    }

    if (method !== route.method) {
      stats.requests += 1;
      stats.rejected += 1;
      request.resume();
      response.setHeader("allow", route.method);
      jsonResponse(response, 405, { error: "method_not_allowed" });
      record(405, method, path, attempt, started);
      return;
    }

    if (stats.active >= maxConcurrent) {
      stats.requests += 1;
      stats.rejected += 1;
      request.resume();
      jsonResponse(response, 429, { error: "too_many_concurrent_requests" });
      record(429, method, path, attempt, started);
      return;
    }

    const attemptRequests = (attemptCounts.get(attempt) ?? 0) + 1;
    if (attemptRequests > maxRequestsPerAttempt) {
      stats.requests += 1;
      stats.rejected += 1;
      request.resume();
      jsonResponse(response, 429, { error: "attempt_request_limit" });
      record(429, method, path, attempt, started);
      return;
    }
    attemptCounts.set(attempt, attemptRequests);

    const handleRequest = async (): Promise<void> => {
      let body: Buffer = Buffer.alloc(0);
      if (method === "POST") {
        body = await readBody(request, maxBodyBytes);
      } else {
        request.resume();
      }

      stats.requests += 1;
      stats.allowed += 1;
      stats.active += 1;

      const target = upstreamUrl(upstreamBaseUrl, route.upstreamPath);
      const headers = forwardedHeaders(
        request.headers,
        apiKey,
        body.length,
        method,
      );
      const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
      let finished = false;

      const finish = (status: number): void => {
        if (finished) return;
        finished = true;
        stats.active = Math.max(0, stats.active - 1);
        record(status, method, path, attempt, started);
      };

      const upstreamReq = transport(
        target,
        { method, headers },
        (upstreamResponse) => {
          const status = upstreamResponse.statusCode ?? 502;
          response.writeHead(
            status,
            responseHeaders(upstreamResponse.headers),
          );
          upstreamResponse.on("error", (error) => {
            stats.upstreamErrors += 1;
            if (!response.headersSent) {
              jsonResponse(response, 502, { error: "upstream_error" });
            } else {
              response.destroy(error);
            }
            finish(502);
          });
          upstreamResponse.on("end", () => finish(status));
          upstreamResponse.pipe(response);
        },
      );

      activeRequests.add(upstreamReq);
      upstreamReq.on("close", () => activeRequests.delete(upstreamReq));
      upstreamReq.setTimeout(requestTimeoutMs, () => {
        upstreamReq.destroy(new Error("upstream request timed out"));
      });
      upstreamReq.on("error", (error) => {
        stats.upstreamErrors += 1;
        const status = error.message.includes("timed out") ? 504 : 502;
        if (!response.headersSent) {
          jsonResponse(response, status, {
            error: status === 504 ? "upstream_timeout" : "upstream_error",
          });
        } else {
          response.destroy(error);
        }
        finish(status);
      });
      response.on("close", () => {
        if (!finished) {
          upstreamReq.destroy();
          finish(499);
        }
      });
      upstreamReq.end(body);
    };

    void handleRequest().catch((error: unknown) => {
      if (error instanceof BodyTooLargeError) {
        stats.requests += 1;
        stats.rejected += 1;
        if (!response.headersSent) {
          jsonResponse(response, 413, { error: "request_body_too_large" });
        }
        record(413, method, path, attempt, started);
        return;
      }

      stats.requests += 1;
      stats.rejected += 1;
      if (!response.headersSent) {
        jsonResponse(response, 400, { error: "bad_request" });
      }
      record(400, method, path, attempt, started);
    });
  });

  const adminServer = createHttpServer((request, response) => {
    const path = requestPath(request);
    if (request.method === "GET" && path === "/health") {
      jsonResponse(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && path === "/stats") {
      jsonResponse(response, 200, stats);
      return;
    }
    response.setHeader("content-type", "application/json");
    jsonResponse(response, 404, { error: "not_found" });
  });

  const actualPort = await listen(dataServer, host, port);
  const actualAdminPort = await listen(adminServer, adminHost, adminPort);

  return {
    dataUrl: `http://${publicHost(host)}:${actualPort}`,
    adminUrl: `http://${publicHost(adminHost)}:${actualAdminPort}`,
    port: actualPort,
    adminPort: actualAdminPort,
    stats() {
      return structuredClone(stats);
    },
    async close(): Promise<void> {
      for (const request of activeRequests) request.destroy();
      activeRequests.clear();
      await Promise.all([closeServer(dataServer), closeServer(adminServer)]);
    },
  };
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

async function main(): Promise<void> {
  const handle = await startEvalProxy({
    apiKey: process.env.OPENCODE_API_KEY ?? "",
    upstreamBaseUrl: process.env.EVAL_PROXY_UPSTREAM,
    host: process.env.EVAL_PROXY_HOST ?? "0.0.0.0",
    port: envNumber("EVAL_PROXY_PORT", DEFAULT_PROXY_PORT),
    adminHost: process.env.EVAL_PROXY_ADMIN_HOST ?? "127.0.0.1",
    adminPort: envNumber("EVAL_PROXY_ADMIN_PORT", DEFAULT_ADMIN_PORT),
    maxBodyBytes: envNumber("EVAL_PROXY_MAX_BODY_BYTES", 4 * 1024 * 1024),
    maxConcurrent: envNumber("EVAL_PROXY_MAX_CONCURRENT", 4),
    maxRequestsPerAttempt: envNumber(
      "EVAL_PROXY_MAX_REQUESTS_PER_ATTEMPT",
      500,
    ),
    requestTimeoutMs: envNumber("EVAL_PROXY_REQUEST_TIMEOUT_MS", 180_000),
    allowTestUpstream: process.env.EVAL_PROXY_ALLOW_TEST_UPSTREAM === "1",
  });

  console.log(
    JSON.stringify({
      event: "proxy_started",
      dataUrl: handle.dataUrl,
      adminUrl: handle.adminUrl,
    }),
  );

  const shutdown = (): void => {
    void handle.close().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "proxy_error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}
