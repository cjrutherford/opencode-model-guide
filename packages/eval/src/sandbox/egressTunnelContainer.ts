import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_ALLOWED_PORT,
  DEFAULT_TUNNEL_PORT,
} from "../egressTunnel";
import {
  containerExists,
  copyIntoContainer,
  docker,
  dockerText,
  removeContainer,
} from "./docker";

const TUNNEL_SOURCE = fileURLToPath(
  new URL("../egressTunnel.ts", import.meta.url),
);

export interface EgressTunnelContainerOptions {
  image: string;
  name: string;
  network: string;
  controlNetwork: string;
  allowedHosts?: readonly string[];
  allowedPort?: number;
  port?: number;
  healthTimeoutMs?: number;
}

export interface EgressTunnelContainerHandle {
  name: string;
  url: string;
  logs(): Promise<string>;
  stop(): Promise<void>;
}

function tmpfs(path: string, bytes: number): string {
  return `${path}:rw,size=${bytes},mode=1777`;
}

/**
 * Run the allowlisted CONNECT tunnel in a disposable, dual-homed container.
 * It has no API key and no access to the task workspace; its only job is to
 * bridge the agent's internal network to `opencode.ai:443`.
 */
export async function startEgressTunnelContainer(
  options: EgressTunnelContainerOptions,
): Promise<EgressTunnelContainerHandle> {
  if (await containerExists(options.name)) {
    await removeContainer(options.name);
  }

  const port = options.port ?? DEFAULT_TUNNEL_PORT;
  const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  const allowedPort = options.allowedPort ?? DEFAULT_ALLOWED_PORT;
  const runResult = await docker(
    [
      "run",
      "-d",
      "--name",
      options.name,
      "--hostname",
      "egress",
      "--network",
      options.network,
      "--network-alias",
      "egress",
      "--read-only",
      "--init",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit",
      "128",
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--tmpfs",
      tmpfs("/workspace", 32 * 1024 * 1024),
      "--tmpfs",
      tmpfs("/tmp", 32 * 1024 * 1024),
      "--tmpfs",
      tmpfs("/home/eval", 32 * 1024 * 1024),
      "--label",
      "omg-eval=1",
      "--label",
      "omg-eval-role=tunnel",
      "--env",
      "EVAL_TUNNEL_HOST=0.0.0.0",
      "--env",
      `EVAL_TUNNEL_PORT=${port}`,
      "--env",
      `EVAL_TUNNEL_ALLOWED_HOSTS=${allowedHosts.join(",")}`,
      "--env",
      `EVAL_TUNNEL_ALLOWED_PORT=${allowedPort}`,
      "--entrypoint",
      "/bin/bash",
      options.image,
      "-c",
      "while [ ! -f /workspace/egressTunnel.ts ]; do sleep 0.1; done; exec tsx /workspace/egressTunnel.ts",
    ],
    { timeoutMs: 120_000 },
  );

  if (runResult.exitCode !== 0) {
    throw new Error(
      `could not start egress tunnel: ${runResult.output.slice(-2_000)}`,
    );
  }

  const tempDir = await mkdtemp(join(tmpdir(), "omg-eval-tunnel-"));
  try {
    await cp(TUNNEL_SOURCE, join(tempDir, "egressTunnel.ts"));

    const connect = await docker(
      ["network", "connect", options.controlNetwork, options.name],
      { timeoutMs: 30_000 },
    );
    if (connect.exitCode !== 0) {
      throw new Error(
        `could not attach egress tunnel to control network: ${connect.output.slice(-2_000)}`,
      );
    }

    await copyIntoContainer(options.name, tempDir, "/workspace");

    const deadline = Date.now() + (options.healthTimeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      const running = await docker(
        [
          "container",
          "inspect",
          "--format",
          "{{.State.Running}}",
          options.name,
        ],
        { timeoutMs: 15_000 },
      );
      if (running.exitCode !== 0 || running.stdout.trim() !== "true") {
        const logs = await docker(["logs", "--tail", "80", options.name], {
          timeoutMs: 30_000,
        });
        throw new Error(
          `egress tunnel exited before health check: ${logs.output.slice(-4_000)}`,
        );
      }

      const health = await docker(
        [
          "exec",
          options.name,
          "curl",
          "-fsS",
          `http://127.0.0.1:${port}/health`,
        ],
        { timeoutMs: 15_000 },
      );
      if (health.exitCode === 0) {
        return {
          name: options.name,
          url: `http://egress:${port}`,
          async logs(): Promise<string> {
            return dockerText(["logs", "--tail", "200", options.name], {
              timeoutMs: 30_000,
            });
          },
          async stop(): Promise<void> {
            await removeContainer(options.name);
          },
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error("egress tunnel did not become healthy");
  } catch (error) {
    await removeContainer(options.name);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
