import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { pathToFileURL } from "node:url";

export const DEFAULT_TUNNEL_HOST = "127.0.0.1";
export const DEFAULT_TUNNEL_PORT = 8787;
export const DEFAULT_ALLOWED_HOST = "opencode.ai";
export const DEFAULT_ALLOWED_HOSTS = [
  DEFAULT_ALLOWED_HOST,
  "models.opencode.ai",
] as const;
export const DEFAULT_ALLOWED_PORT = 443;

export type TunnelLogger = (entry: Record<string, unknown>) => void;

export interface EgressTunnelOptions {
  host?: string;
  port?: number;
  /** Exact hostnames permitted as CONNECT targets. */
  allowedHosts?: readonly string[];
  allowedPort?: number;
  connectTimeoutMs?: number;
  logger?: TunnelLogger;
}

export interface EgressTunnelStats {
  startedAt: string;
  requests: number;
  allowed: number;
  rejected: number;
  upstreamErrors: number;
  active: number;
}

export interface EgressTunnelHandle {
  url: string;
  port: number;
  stats(): EgressTunnelStats;
  close(): Promise<void>;
}

interface TunnelTarget {
  host: string;
  port: number;
}

class ForbiddenTargetError extends Error {}

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

function publicHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "127.0.0.1";
  }
  return host;
}

function parseTarget(
  raw: string | undefined,
  fallbackPort: number,
): TunnelTarget | null {
  if (!raw) return null;

  try {
    const parsed = new URL(`http://${raw}`);
    const port = parsed.port === "" ? fallbackPort : Number(parsed.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;
    return {
      host: parsed.hostname.toLowerCase().replace(/\.$/, ""),
      port,
    };
  } catch {
    return null;
  }
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("egress tunnel has no TCP address"));
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

function writeConnectError(socket: Duplex, status: number, reason: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/**
 * Start a minimal HTTP CONNECT tunnel that permits a tiny host allowlist. The
 * agent container uses this as HTTPS_PROXY, so TLS and the inference key stay
 * end-to-end between OpenCode and its API; the tunnel sees only the requested
 * host and port.
 */
export async function startEgressTunnel(
  options: EgressTunnelOptions = {},
): Promise<EgressTunnelHandle> {
  const host = options.host ?? DEFAULT_TUNNEL_HOST;
  const port = options.port ?? DEFAULT_TUNNEL_PORT;
  const allowedHosts = new Set(
    (options.allowedHosts ?? [DEFAULT_ALLOWED_HOST]).map((value) =>
      value.toLowerCase().replace(/\.$/, ""),
    ),
  );
  const allowedPort = options.allowedPort ?? DEFAULT_ALLOWED_PORT;
  const connectTimeoutMs = options.connectTimeoutMs ?? 30_000;
  const logger: TunnelLogger =
    options.logger ?? ((entry) => console.log(JSON.stringify(entry)));

  const startedAt = new Date().toISOString();
  const stats: EgressTunnelStats = {
    startedAt,
    requests: 0,
    allowed: 0,
    rejected: 0,
    upstreamErrors: 0,
    active: 0,
  };
  const sockets = new Set<Duplex>();

  const server = createHttpServer((request, response) => {
    stats.requests += 1;
    if (request.method === "GET" && request.url === "/health") {
      jsonResponse(response, 200, {
        ok: true,
        allowedHosts: [...allowedHosts],
        allowedPort,
        ...stats,
      });
      return;
    }
    stats.rejected += 1;
    request.resume();
    jsonResponse(response, 403, { error: "connect_required" });
  });

  server.on("connect", (request: IncomingMessage, socket, head) => {
    stats.requests += 1;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.once("error", () => socket.destroy());

    const target = parseTarget(request.url, allowedPort);
    if (!target || !allowedHosts.has(target.host) || target.port !== allowedPort) {
      stats.rejected += 1;
      logger({
        event: "tunnel_connect",
        allowed: false,
        target: request.url ?? null,
      });
      writeConnectError(socket, 403, "Forbidden");
      return;
    }

    stats.allowed += 1;
    stats.active += 1;
    logger({
      event: "tunnel_connect",
      allowed: true,
      target: `${target.host}:${target.port}`,
    });

    const upstream = connect({ host: target.host, port: target.port });
    let connected = false;
    upstream.setTimeout(connectTimeoutMs, () => {
      upstream.destroy(new Error("upstream connect timed out"));
    });
    upstream.once("connect", () => {
      if (!socket.writable) {
        upstream.destroy();
        return;
      }
      connected = true;
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.once("error", (error) => {
      stats.upstreamErrors += 1;
      logger({
        event: "tunnel_error",
        target: `${target.host}:${target.port}`,
        message: error.message,
      });
      if (connected) {
        socket.destroy();
      } else {
        writeConnectError(socket, 502, "Bad Gateway");
      }
    });
    upstream.once("close", () => {
      stats.active = Math.max(0, stats.active - 1);
      if (socket.writable) socket.end();
    });
    socket.once("close", () => upstream.destroy());
  });

  const actualPort = await listen(server, host, port);

  return {
    url: `http://${publicHost(host)}:${actualPort}`,
    port: actualPort,
    stats() {
      return structuredClone(stats);
    },
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      server.closeAllConnections();
      await closeServer(server);
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
  const handle = await startEgressTunnel({
    host: process.env.EVAL_TUNNEL_HOST ?? "0.0.0.0",
    port: envNumber("EVAL_TUNNEL_PORT", DEFAULT_TUNNEL_PORT),
    allowedHosts: (
      process.env.EVAL_TUNNEL_ALLOWED_HOSTS ??
      DEFAULT_ALLOWED_HOSTS.join(",")
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    allowedPort: envNumber("EVAL_TUNNEL_ALLOWED_PORT", DEFAULT_ALLOWED_PORT),
    connectTimeoutMs: envNumber("EVAL_TUNNEL_CONNECT_TIMEOUT_MS", 30_000),
  });

  console.log(
    JSON.stringify({
      event: "tunnel_started",
      url: handle.url,
      allowedHosts: process.env.EVAL_TUNNEL_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS.join(","),
      allowedPort: envNumber("EVAL_TUNNEL_ALLOWED_PORT", DEFAULT_ALLOWED_PORT),
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
        event: "tunnel_error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}
