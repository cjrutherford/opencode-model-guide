import { randomUUID } from "node:crypto";

import type { CommandResult } from "../process";
import { runCommand } from "../process";

export interface DockerOptions {
  timeoutMs?: number;
  maxOutputChars?: number;
}

export async function docker(
  args: string[],
  options: DockerOptions = {},
): Promise<CommandResult> {
  return runCommand("docker", args, {
    cwd: process.cwd(),
    timeoutMs: options.timeoutMs ?? 120_000,
    maxOutputChars: options.maxOutputChars ?? 64_000,
    keepOutput: "tail",
  });
}

export async function dockerText(
  args: string[],
  options: DockerOptions = {},
): Promise<string> {
  const result = await docker(args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `docker ${args.join(" ")} failed: ${result.output.slice(-2_000)}`,
    );
  }
  return result.stdout.trim();
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 12)}`;
}
export async function dockerLogs(
  container: string,
  tail = 200,
  timeoutMs = 30_000,
): Promise<string> {
  const result = await docker(["logs", "--tail", String(tail), container], {
    timeoutMs,
    maxOutputChars: 128_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `docker logs ${container} failed: ${result.output.slice(-2_000)}`,
    );
  }
  return result.output.trim();
}


function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function copyOutOfContainer(
  container: string,
  destination: string,
  source = "/workspace",
  timeoutMs = 120_000,
): Promise<void> {
  const command = [
    `docker exec ${shellQuote(container)} tar -C ${shellQuote(source)} -cf - .`,
    `| tar --strip-components=1 -xf - -C ${shellQuote(destination)}`,
  ].join(" ");
  const result = await runCommand("bash", ["-lc", command], {
    cwd: process.cwd(),
    timeoutMs,
    maxOutputChars: 4_000,
    keepOutput: "tail",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `could not copy workspace out of ${container}: ${result.output.slice(-2_000)}`,
    );
  }
}

export async function copyIntoContainer(
  container: string,
  sourceDir: string,
  destination = "/workspace",
  timeoutMs = 120_000,
): Promise<void> {
  // A read-only rootfs makes `docker cp <host> <container>` fail even when the
  // destination is a writable tmpfs. Streaming a tar through `docker exec`
  // writes only to the tmpfs.
  const command = [
    `tar -C ${shellQuote(sourceDir)} -cf - .`,
    `| docker exec -i ${shellQuote(container)} tar --strip-components=1 --no-same-owner --no-same-permissions -xf - -C ${shellQuote(destination)}`,
  ].join(" ");
  const result = await runCommand("bash", ["-lc", command], {
    cwd: process.cwd(),
    timeoutMs,
    maxOutputChars: 4_000,
    keepOutput: "tail",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `could not copy workspace into ${container}: ${result.output.slice(-2_000)}`,
    );
  }
}

export async function networkExists(name: string): Promise<boolean> {
  const result = await docker(["network", "inspect", name], {
    timeoutMs: 30_000,
  });
  return result.exitCode === 0;
}

async function ensureNetworkMode(
  name: string,
  internal: boolean,
): Promise<void> {
  if (await networkExists(name)) return;

  const args = [
    "network",
    "create",
    "--driver",
    "bridge",
    "--label",
    "omg-eval=1",
  ];
  if (internal) args.push("--internal");
  args.push(name);

  const result = await docker(args, { timeoutMs: 60_000 });
  if (result.exitCode !== 0 && !(await networkExists(name))) {
    throw new Error(
      `could not create eval network ${name}: ${result.output.slice(-2_000)}`,
    );
  }
}

export async function ensureNetwork(name: string): Promise<void> {
  await ensureNetworkMode(name, true);
}

export async function ensureControlNetwork(name: string): Promise<void> {
  await ensureNetworkMode(name, false);
}

export async function removeNetwork(name: string): Promise<void> {
  await docker(["network", "rm", name], { timeoutMs: 60_000 }).catch(
    () => undefined,
  );
}

export async function containerExists(name: string): Promise<boolean> {
  const result = await docker(["container", "inspect", name], {
    timeoutMs: 30_000,
  });
  return result.exitCode === 0;
}

export async function removeContainer(name: string): Promise<void> {
  await docker(["rm", "-f", name], { timeoutMs: 60_000 }).catch(
    () => undefined,
  );
}

export async function listContainers(prefix: string): Promise<string[]> {
  const output = await dockerText(
    [
      "ps",
      "-a",
      "--filter",
      `name=${prefix}`,
      "--format",
      "{{.Names}}",
    ],
    { timeoutMs: 30_000 },
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix));
}

export async function listNetworks(prefix: string): Promise<string[]> {
  const output = await dockerText(
    [
      "network",
      "ls",
      "--filter",
      `name=${prefix}`,
      "--format",
      "{{.Name}}",
    ],
    { timeoutMs: 30_000 },
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix));
}

export interface ImageInfo {
  id: string;
  platform: string;
}

export async function inspectImage(image: string): Promise<ImageInfo | null> {
  const result = await docker(
    [
      "image",
      "inspect",
      "--format",
      "{{.Id}}|{{.Os}}/{{.Architecture}}",
      image,
    ],
    { timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) return null;

  const [id, platform] = result.stdout.trim().split("|");
  if (!id || !platform) return null;
  return { id, platform };
}

export async function getPublishedPort(
  container: string,
  containerPort: number,
): Promise<{ host: string; port: number } | null> {
  const result = await docker(
    ["port", container, `${containerPort}/tcp`],
    { timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) return null;

  const line = result.stdout
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  if (!line) return null;

  const separator = line.lastIndexOf(":");
  if (separator < 0) return null;
  const port = Number(line.slice(separator + 1));
  if (!Number.isInteger(port) || port <= 0) return null;
  return { host: line.slice(0, separator), port };
}

export async function getContainerIp(
  container: string,
): Promise<string | null> {
  const result = await docker(
    [
      "container",
      "inspect",
      "--format",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}",
      container,
    ],
    { timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) return null;

  const address = result.stdout
    .trim()
    .split(/\s+/)
    .find((value) => value.length > 0);
  return address ?? null;
}
