import { createServer, Socket, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  startEgressTunnel,
  type EgressTunnelHandle,
} from "../src/egressTunnel";

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test server has no port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function readUntil(socket: Socket, marker: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk: Buffer): void => {
      data += chunk.toString("utf8");
      if (data.includes(marker)) {
        socket.off("data", onData);
        resolve(data);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

function connectRequest(
  port: number,
  target: string,
): Promise<{ socket: Socket; response: string }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.once("error", reject);
    socket.connect(port, "127.0.0.1", () => {
      socket.write(
        `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: Bearer test-secret\r\n\r\n`,
      );
      readUntil(socket, "\r\n\r\n").then((response) => {
        resolve({ socket, response });
      }, reject);
    });
  });
}

describe("egress tunnel", () => {
  let tunnel: EgressTunnelHandle | null = null;
  let echo: Server | null = null;

  afterEach(async () => {
    await tunnel?.close();
    tunnel = null;
    if (echo) await close(echo);
    echo = null;
  });

  it("exposes health and allows only the configured CONNECT target", async () => {
    echo = createServer((socket) => {
      socket.on("data", (chunk) => socket.write(chunk));
    });
    const echoPort = await listen(echo);
    const logs: Array<Record<string, unknown>> = [];
    tunnel = await startEgressTunnel({
      port: 0,
      allowedHosts: ["127.0.0.1"],
      allowedPort: echoPort,
      logger: (entry) => logs.push(entry),
    });

    const health = await fetch(`${tunnel.url}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      ok: true,
      allowedHosts: ["127.0.0.1"],
      allowedPort: echoPort,
    });

    const allowed = await connectRequest(tunnel.port, `127.0.0.1:${echoPort}`);
    expect(allowed.response).toContain("200 Connection Established");
    allowed.socket.write("ping");
    await expect(readUntil(allowed.socket, "ping")).resolves.toContain("ping");
    allowed.socket.end();

    const denied = await connectRequest(tunnel.port, "example.com:443");
    expect(denied.response).toContain("403 Forbidden");
    denied.socket.destroy();

    expect(tunnel.stats()).toMatchObject({
      allowed: 1,
      rejected: 1,
      upstreamErrors: 0,
    });
    expect(JSON.stringify(logs)).not.toContain("test-secret");
  });

  it("keeps an established tunnel open past the connect timeout", async () => {
    echo = createServer((socket) => {
      socket.on("data", (chunk) => socket.write(chunk));
    });
    const echoPort = await listen(echo);
    tunnel = await startEgressTunnel({
      port: 0,
      allowedHosts: ["127.0.0.1"],
      allowedPort: echoPort,
      connectTimeoutMs: 150,
    });

    const { socket, response } = await connectRequest(
      tunnel.port,
      `127.0.0.1:${echoPort}`,
    );
    expect(response).toContain("200 Connection Established");

    // A model that thinks for a while streams nothing; the established tunnel
    // must survive that quiet period.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(socket.destroyed).toBe(false);

    socket.write("pong");
    await expect(readUntil(socket, "pong")).resolves.toContain("pong");
    socket.end();
    expect(tunnel.stats().upstreamErrors).toBe(0);
  }, 10_000);

  it("rejects plain HTTP data requests", async () => {
    tunnel = await startEgressTunnel({ port: 0 });

    const response = await fetch(`${tunnel.url}/v1/models`);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "connect_required",
    });
  });
});
