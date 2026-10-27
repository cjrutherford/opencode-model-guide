import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { EvalProxyStats } from "../proxy";
import {
  startPortForwarder,
  type PortForwarderHandle,
} from "./agentContainer";
import {
  containerExists,
  copyIntoContainer,
  docker,
  dockerLogs,
  dockerText,
  removeContainer,
  uniqueName,
} from "./docker";

const PROXY_SOURCE = fileURLToPath(new URL("../proxy.ts", import.meta.url));
const DEFAULT_PROXY_PORT = 8787;
const DEFAULT_ADMIN_PORT = 8788;

export interface ProxyContainerOptions {
  image: string;
  name: string;
  network: string;
  controlNetwork: string;
  apiKey: string;
  upstreamBaseUrl?: string;
  proxyPort?: number;
  adminPort?: number;
  dataForwarderName?: string;
  maxBodyBytes?: number;
  maxConcurrent?: number;
  requestTimeoutMs?: number;
  maxRequestsPerAttempt?: number;
  allowTestUpstream?: boolean;
}

export interface ProxyContainerHandle {
  name: string;
  dataUrl: string;
  /** Host-accessible URL for direct-patch, which does not run in a container. */
  hostDataUrl: string;
  adminUrl: string;
  stats(): Promise<EvalProxyStats>;
  logs(): Promise<string>;
  stop(): Promise<void>;
}

function tmpfs(path: string, bytes: number): string {
  return `${path}:rw,size=${bytes},mode=1777`;
}

export async function startProxyContainer(
  options: ProxyContainerOptions,
): Promise<ProxyContainerHandle> {
  if (!options.apiKey) throw new Error("proxy container requires an API key");
  if (await containerExists(options.name)) {
    await removeContainer(options.name);
  }

  const proxyPort = options.proxyPort ?? DEFAULT_PROXY_PORT;
  const adminPort = options.adminPort ?? DEFAULT_ADMIN_PORT;
  const env = [
    `OPENCODE_API_KEY=${options.apiKey}`,
    "EVAL_PROXY_HOST=0.0.0.0",
    `EVAL_PROXY_PORT=${proxyPort}`,
    "EVAL_PROXY_ADMIN_HOST=127.0.0.1",
    `EVAL_PROXY_ADMIN_PORT=${adminPort}`,
  ];
  if (options.upstreamBaseUrl) {
    env.push(`EVAL_PROXY_UPSTREAM=${options.upstreamBaseUrl}`);
  }
  if (options.maxBodyBytes !== undefined) {
    env.push(`EVAL_PROXY_MAX_BODY_BYTES=${options.maxBodyBytes}`);
  }
  if (options.maxConcurrent !== undefined) {
    env.push(`EVAL_PROXY_MAX_CONCURRENT=${options.maxConcurrent}`);
  }
  if (options.requestTimeoutMs !== undefined) {
    env.push(`EVAL_PROXY_REQUEST_TIMEOUT_MS=${options.requestTimeoutMs}`);
  }
  if (options.maxRequestsPerAttempt !== undefined) {
    env.push(
      `EVAL_PROXY_MAX_REQUESTS_PER_ATTEMPT=${options.maxRequestsPerAttempt}`,
    );
  }
  if (options.allowTestUpstream) {
    env.push("EVAL_PROXY_ALLOW_TEST_UPSTREAM=1");
  }

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
      "256",
      "--memory",
      "1g",
      "--cpus",
      "1",
      "--tmpfs",
      tmpfs("/workspace", 64 * 1024 * 1024),
      "--tmpfs",
      tmpfs("/tmp", 64 * 1024 * 1024),
      "--tmpfs",
      tmpfs("/home/eval", 64 * 1024 * 1024),
      "--label",
      "omg-eval=1",
      "--label",
      "omg-eval-role=proxy",
      ...env.flatMap((value) => ["--env", value]),
      "--entrypoint",
      "/bin/bash",
      options.image,
      "-c",
      "while [ ! -f /workspace/proxy.ts ]; do sleep 0.1; done; exec tsx /workspace/proxy.ts",
    ],
    { timeoutMs: 120_000 },
  );

  if (runResult.exitCode !== 0) {
    throw new Error(
      `could not start proxy container: ${runResult.output.slice(-2_000)}`,
    );
  }

  const tempDir = await mkdtemp(join(tmpdir(), "omg-eval-proxy-"));
  let forwarder: PortForwarderHandle | null = null;
  try {
    await copyFile(PROXY_SOURCE, join(tempDir, "proxy.ts"));

    const connect = await docker(
      ["network", "connect", options.controlNetwork, options.name],
      { timeoutMs: 30_000 },
    );
    if (connect.exitCode !== 0) {
      throw new Error(
        `could not attach proxy to control network: ${connect.output.slice(-2_000)}`,
      );
    }

    await copyIntoContainer(options.name, tempDir, "/workspace");

    const deadline = Date.now() + 30_000;
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
          `proxy container exited before health check: ${logs.output.slice(-4_000)}`,
        );
      }

      const health = await docker(
        [
          "exec",
          options.name,
          "curl",
          "-fsS",
          `http://127.0.0.1:${adminPort}/health`,
        ],
        { timeoutMs: 15_000 },
      );
      if (health.exitCode === 0) {
        // The data plane is bound to the internal network. A second forwarder
        // makes the same proxy reachable from the host for direct-patch.
        forwarder = await startPortForwarder({
          image: options.image,
          name:
            options.dataForwarderName ??
            uniqueName("omg-eval-proxy-forward"),
          network: options.network,
          controlNetwork: options.controlNetwork,
          targetHost: "egress",
          targetPort: proxyPort,
        });

        const host = "egress";
        return {
          name: options.name,
          dataUrl: `http://${host}:${proxyPort}`,
          hostDataUrl: `http://${forwarder.host}:${forwarder.port}`,
          adminUrl: `http://127.0.0.1:${adminPort}`,
          async stats(): Promise<EvalProxyStats> {
            const payload = await dockerText([
              "exec",
              options.name,
              "curl",
              "-fsS",
              `http://127.0.0.1:${adminPort}/stats`,
            ]);
            return JSON.parse(payload) as EvalProxyStats;
          },
          async logs(): Promise<string> {
            return dockerLogs(options.name);
          },
          async stop(): Promise<void> {
            await forwarder?.stop();
            await removeContainer(options.name);
          },
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error("proxy container did not become healthy");
  } catch (error) {
    await forwarder?.stop();
    await removeContainer(options.name);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
