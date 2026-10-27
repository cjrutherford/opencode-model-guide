import { mkdir } from "node:fs/promises";

import type { CommandResult } from "../process";
import {
  containerExists,
  copyIntoContainer,
  copyOutOfContainer,
  docker,
  dockerLogs,
  getContainerIp,
  getPublishedPort,
  removeContainer,
  uniqueName,
} from "./docker";
import { tmpfs } from "./tmpfs";

const DEFAULT_WORKSPACE_BYTES = 512 * 1024 * 1024;
const DEFAULT_TMP_BYTES = 512 * 1024 * 1024;
const DEFAULT_HOME_BYTES = 64 * 1024 * 1024;

const SECRET_ENV_PATTERN = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

export interface AgentContainerOptions {
  image: string;
  network: string;
  name: string;
  workspaceDir: string;
  env?: Record<string, string>;
  /**
   * Secret-looking environment variables that may be passed deliberately.
   * The eval key is the only production use: it stays inside the disposable
   * agent container so native OpenCode can satisfy the free-tier gate.
   */
  secretEnvAllowlist?: string[];
  workspaceBytes?: number;
  tmpBytes?: number;
  homeBytes?: number;
  cpus?: string;
  memory?: string;
  pidsLimit?: number;
  publishServer?: boolean;
  serverPort?: number;
  controlNetwork?: string;
  forwarderName?: string;
}

export interface PortForwarderOptions {
  image: string;
  name: string;
  network: string;
  controlNetwork: string;
  targetHost: string;
  targetPort: number;
}

export interface PortForwarderHandle {
  name: string;
  host: string;
  port: number;
  stop(): Promise<void>;
}

export interface AgentContainerHandle {
  id: string;
  name: string;
  containerName: string;
  host: string;
  port: number;
  workspaceDir: string;
  copyOut(destination: string): Promise<void>;
  exec(
    command: string[],
    options?: { user?: string; timeoutMs?: number },
  ): Promise<CommandResult>;
  signalReady(): Promise<void>;
  waitForServer(timeoutMs?: number): Promise<void>;
  logs(): Promise<string>;
  stop(): Promise<void>;
}

function envFlags(
  env: Record<string, string> | undefined,
  allowlist: readonly string[] = [],
): string[] {
  if (!env) return [];
  for (const key of Object.keys(env)) {
    if (SECRET_ENV_PATTERN.test(key) && !allowlist.includes(key)) {
      throw new Error(
        `refusing to put a secret-looking env var in the agent container: ${key}`,
      );
    }
  }
  return Object.entries(env).flatMap(([key, value]) => [
    "--env",
    `${key}=${value}`,
  ]);
}

function redactEnvValues(
  message: string,
  env: Record<string, string> | undefined,
): string {
  if (!env) return message;
  let redacted = message;
  for (const value of Object.values(env)) {
    if (value.length >= 8) redacted = redacted.split(value).join("[REDACTED]");
  }
  return redacted;
}

/**
 * Docker cannot publish a port from a container attached only to an
 * `--internal` network. Keep the agent on that isolated network and expose its
 * server through a small dual-homed TCP forwarder on a separate control bridge.
 * The forwarder is trusted plumbing; the agent still has no route to the
 * internet and can only reach the egress proxy on the internal network.
 */
export async function startPortForwarder(
  options: PortForwarderOptions,
): Promise<PortForwarderHandle> {
  if (await containerExists(options.name)) {
    await removeContainer(options.name);
  }

  const command = [
    `until getent hosts ${options.targetHost} >/dev/null 2>&1; do sleep 0.1; done;`,
    `exec socat TCP-LISTEN:${options.targetPort},fork,reuseaddr`,
    `TCP:${options.targetHost}:${options.targetPort}`,
  ].join(" ");

  const runResult = await docker(
    [
      "run",
      "-d",
      "--name",
      options.name,
      "--network",
      options.controlNetwork,
      "--read-only",
      "--init",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--publish",
      `127.0.0.1::${options.targetPort}`,
      "--label",
      "omg-eval=1",
      "--label",
      "omg-eval-role=forwarder",
      "--entrypoint",
      "/bin/bash",
      options.image,
      "-c",
      command,
    ],
    { timeoutMs: 120_000 },
  );

  if (runResult.exitCode !== 0) {
    throw new Error(
      `could not start port forwarder: ${runResult.output.slice(-2_000)}`,
    );
  }

  try {
    const connect = await docker(
      ["network", "connect", options.network, options.name],
      { timeoutMs: 30_000 },
    );
    if (connect.exitCode !== 0) {
      throw new Error(
        `could not attach port forwarder to eval network: ${connect.output.slice(-2_000)}`,
      );
    }

    const published = await getPublishedPort(options.name, options.targetPort);
    if (!published) {
      throw new Error("port forwarder did not publish a host port");
    }

    const host =
      published.host === "0.0.0.0" ||
      published.host === "[::]" ||
      published.host === "::"
        ? "127.0.0.1"
        : published.host;

    return {
      name: options.name,
      host,
      port: published.port,
      async stop(): Promise<void> {
        await removeContainer(options.name);
      },
    };
  } catch (error) {
    await removeContainer(options.name);
    throw error;
  }
}

export async function startAgentContainer(
  options: AgentContainerOptions,
): Promise<AgentContainerHandle> {
  if (await containerExists(options.name)) {
    await removeContainer(options.name);
  }

  const serverPort = options.serverPort ?? 4096;
  const args = [
    "run",
    "-d",
    "--name",
    options.name,
    "--hostname",
    "agent",
    "--network",
    options.network,
    "--network-alias",
    "agent",
    "--read-only",
    "--init",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit",
    String(options.pidsLimit ?? 256),
    "--memory",
    options.memory ?? "2g",
    "--cpus",
    options.cpus ?? "2",
    "--tmpfs",
    tmpfs("/workspace", options.workspaceBytes ?? DEFAULT_WORKSPACE_BYTES),
    "--tmpfs",
    tmpfs("/tmp", options.tmpBytes ?? DEFAULT_TMP_BYTES),
    "--tmpfs",
    tmpfs("/home/eval", options.homeBytes ?? DEFAULT_HOME_BYTES, {
      exec: false,
    }),
    "--label",
    "omg-eval=1",
    "--label",
    "omg-eval-role=agent",
    ...envFlags(options.env, options.secretEnvAllowlist),
  ];

  args.push(options.image);

  const runResult = await docker(args, { timeoutMs: 120_000 });
  if (runResult.exitCode !== 0) {
    throw new Error(
      `could not start agent container: ${redactEnvValues(
        runResult.output.slice(-2_000),
        options.env,
      )}`,
    );
  }

  const id = runResult.stdout.trim().split("\n").at(-1)?.trim();
  if (!id) throw new Error("docker run returned no container id");

  let forwarder: PortForwarderHandle | null = null;
  try {
    await copyIntoContainer(options.name, options.workspaceDir);

    if (options.publishServer !== false && options.controlNetwork) {
      forwarder = await startPortForwarder({
        image: options.image,
        name: options.forwarderName ?? uniqueName("omg-eval-forward"),
        network: options.network,
        controlNetwork: options.controlNetwork,
        targetHost: "agent",
        targetPort: serverPort,
      });
    }
  } catch (error) {
    await forwarder?.stop();
    await removeContainer(options.name);
    throw error;
  }

  const host = forwarder?.host ?? (await getContainerIp(options.name)) ?? "127.0.0.1";
  const port = forwarder?.port ?? serverPort;

  return {
    id,
    name: options.name,
    containerName: options.name,
    host,
    port,
    workspaceDir: options.workspaceDir,

    async copyOut(destination: string): Promise<void> {
      await mkdir(destination, { recursive: true });
      await copyOutOfContainer(options.name, destination);
    },

    async exec(command, execOptions = {}): Promise<CommandResult> {
      const args = ["exec"];
      if (execOptions.user) args.push("-u", execOptions.user);
      args.push(options.name, ...command);
      return docker(args, { timeoutMs: execOptions.timeoutMs ?? 60_000 });
    },

    async signalReady(): Promise<void> {
      const result = await docker(
        ["exec", options.name, "touch", "/workspace/.eval-ready"],
        { timeoutMs: 30_000 },
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `could not signal agent entrypoint: ${result.output.slice(-2_000)}`,
        );
      }
    },

    async waitForServer(timeoutMs = 60_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
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
        if (running.exitCode !== 0) {
          throw new Error("agent container disappeared while waiting for server");
        }
        if (running.stdout.trim() !== "true") {
          const logs = await docker(["logs", "--tail", "80", options.name], {
            timeoutMs: 30_000,
          });
          throw new Error(
            `agent container exited before server was ready: ${logs.output.slice(-4_000)}`,
          );
        }

        const probe = await docker(
          [
            "exec",
            options.name,
            "bash",
            "-c",
            `curl -fsS --max-time 2 http://127.0.0.1:${serverPort}/ >/dev/null`,
          ],
          { timeoutMs: 15_000 },
        );
        if (probe.exitCode === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`agent server did not become ready within ${timeoutMs}ms`);
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
