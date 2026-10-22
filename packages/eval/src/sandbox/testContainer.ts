import { mkdir } from "node:fs/promises";

import type { CommandResult } from "../process";
import type { TestCommandExecutor } from "../testRunner";
import {
  containerExists,
  copyIntoContainer,
  docker,
  dockerText,
  removeContainer,
  uniqueName,
} from "./docker";

const DEFAULT_WORKSPACE_BYTES = 512 * 1024 * 1024;
const DEFAULT_TMP_BYTES = 256 * 1024 * 1024;
const DEFAULT_HOME_BYTES = 64 * 1024 * 1024;
const SECRET_ENV_PATTERN = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

export interface TestContainerOptions {
  image: string;
  name: string;
  workspaceDir: string;
  env?: Record<string, string>;
  workspaceBytes?: number;
  tmpBytes?: number;
  homeBytes?: number;
  cpus?: string;
  memory?: string;
  pidsLimit?: number;
}

export interface TestContainerHandle {
  id: string;
  name: string;
  run(
    command: string,
    options?: { timeoutMs?: number; env?: Record<string, string> },
  ): Promise<CommandResult>;
  logs(): Promise<string>;
  stop(): Promise<void>;
}

function envFlags(env: Record<string, string> | undefined): string[] {
  if (!env) return [];
  for (const key of Object.keys(env)) {
    if (SECRET_ENV_PATTERN.test(key)) {
      throw new Error(`refusing to pass a secret-looking env var to tests: ${key}`);
    }
  }
  return Object.entries(env).flatMap(([key, value]) => [
    "--env",
    `${key}=${value}`,
  ]);
}

function tmpfs(path: string, bytes: number): string {
  return `${path}:rw,size=${bytes},mode=1777`;
}

export async function startTestContainer(
  options: TestContainerOptions,
): Promise<TestContainerHandle> {
  if (await containerExists(options.name)) {
    await removeContainer(options.name);
  }

  const runResult = await docker(
    [
      "run",
      "-d",
      "--name",
      options.name,
      "--network",
      "none",
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
      tmpfs("/home/eval", options.homeBytes ?? DEFAULT_HOME_BYTES),
      "--label",
      "omg-eval=1",
      "--label",
      "omg-eval-role=test",
      ...envFlags(options.env),
      "--entrypoint",
      "/bin/sleep",
      options.image,
      "infinity",
    ],
    { timeoutMs: 120_000 },
  );

  if (runResult.exitCode !== 0) {
    throw new Error(
      `could not start test container: ${runResult.output.slice(-2_000)}`,
    );
  }

  const id = runResult.stdout.trim().split("\n").at(-1)?.trim();
  if (!id) throw new Error("docker run returned no test container id");

  try {
    await mkdir(options.workspaceDir, { recursive: true });
    await copyIntoContainer(options.name, options.workspaceDir);
  } catch (error) {
    await removeContainer(options.name);
    throw error;
  }

  return {
    id,
    name: options.name,

    async run(command, runOptions = {}): Promise<CommandResult> {
      const args = [
        "exec",
        "--workdir",
        "/workspace",
        ...envFlags({
          CI: "1",
          NO_COLOR: "1",
          PYTHONDONTWRITEBYTECODE: "1",
          ...runOptions.env,
        }),
        options.name,
        "bash",
        "-c",
        command,
      ];
      return docker(args, { timeoutMs: runOptions.timeoutMs ?? 60_000 });
    },

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

export interface DockerTestExecutorOptions {
  image: string;
  namePrefix?: string;
}

export function createDockerTestExecutor(
  options: DockerTestExecutorOptions,
): TestCommandExecutor {
  return {
    async run(command, cwd, _env, timeoutMs) {
      const container = await startTestContainer({
        image: options.image,
        name: uniqueName(options.namePrefix ?? "omg-eval-test"),
        workspaceDir: cwd,
      });
      const startedAt = Date.now();
      try {
        const result = await container.run(command, { timeoutMs });
        return {
          ...result,
          durationMs: Date.now() - startedAt,
        };
      } finally {
        await container.stop();
      }
    },
  };
}
