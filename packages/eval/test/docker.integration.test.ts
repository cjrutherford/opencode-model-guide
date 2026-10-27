import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  copyIntoContainer,
  docker,
  ensureControlNetwork,
  ensureNetwork,
  inspectImage,
  listContainers,
  listNetworks,
  removeContainer,
  removeNetwork,
  uniqueName,
} from "../src/sandbox/docker";
import {
  startAgentContainer,
  type AgentContainerHandle,
} from "../src/sandbox/agentContainer";
import {
  createDockerTestExecutor,
  startTestContainer,
  type TestContainerHandle,
} from "../src/sandbox/testContainer";
import {
  startEgressTunnelContainer,
  type EgressTunnelContainerHandle,
} from "../src/sandbox/egressTunnelContainer";
import {
  startProxyContainer,
  type ProxyContainerHandle,
} from "../src/sandbox/proxyContainer";
import { runTestStage } from "../src/testRunner";
import { loadCorpus } from "../src/corpus";

const IMAGE = process.env.OMG_EVAL_IMAGE ?? "omg-eval-sandbox:local";
const imageAvailable = (await inspectImage(IMAGE)) !== null;

describe.skipIf(!imageAvailable)("docker sandbox", () => {
  let root = "";
  let network = "";
  let controlNetwork = "";
  let workspace = "";
  let agent: AgentContainerHandle | null = null;
  let testContainer: TestContainerHandle | null = null;
  let proxy: ProxyContainerHandle | null = null;
  let tunnel: EgressTunnelContainerHandle | null = null;
  let egress: string | null = null;
  const containerPrefix = "omg-eval-it-";

  async function waitForHttp(url: string, timeoutMs = 10_000): Promise<Response> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url);
        if (response.ok) return response;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`no HTTP response from ${url}`);
  }

  async function makeRunnerFixture(): Promise<{
    repoDir: string;
    hiddenDir: string;
  }> {
    const fixtureRoot = join(root, "runner");
    const repoDir = join(fixtureRoot, "repo");
    const hiddenDir = join(fixtureRoot, "hidden");
    await mkdir(join(repoDir, "src"), { recursive: true });
    await mkdir(join(hiddenDir, "hidden"), { recursive: true });
    await writeFile(
      join(repoDir, "package.json"),
      '{"name":"docker-eval-task","private":true,"type":"module"}\n',
    );
    await writeFile(
      join(repoDir, "src/value.js"),
      "export const value = 1;\n",
    );
    await writeFile(
      join(hiddenDir, "hidden/value.test.js"),
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        "",
        'import { value } from "../src/value.js";',
        "",
        'test("value is fixed", () => {',
        '  assert.equal(value, 2, "value was not fixed");',
        "});",
        "",
      ].join("\n"),
    );
    return { repoDir, hiddenDir };
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "omg-eval-it-"));
    workspace = join(root, "workspace");
    network = uniqueName("omg-eval-it-net");
    controlNetwork = uniqueName("omg-eval-it-control");
    await ensureNetwork(network);
    await ensureControlNetwork(controlNetwork);
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "baseline.txt"), "baseline\n");
  });

  afterAll(async () => {
    await agent?.stop();
    await testContainer?.stop();
    await proxy?.stop();
    await tunnel?.stop();
    if (egress) await removeContainer(egress);
    await removeNetwork(network);
    await removeNetwork(controlNetwork);
    await rm(root, { recursive: true, force: true });
  });

  it("starts an agent container, populates the tmpfs, and captures it", async () => {
    agent = await startAgentContainer({
      image: IMAGE,
      network,
      controlNetwork,
      name: uniqueName(containerPrefix),
      workspaceDir: workspace,
      env: { OPENCODE_API_KEY: "test-eval-key" },
      secretEnvAllowlist: ["OPENCODE_API_KEY"],
    });

    expect(agent.host.length).toBeGreaterThan(0);
    expect(agent.port).toBeGreaterThan(0);

    const server = await agent.exec([
      "bash",
      "-c",
      "nohup python3 -m http.server 4096 >/tmp/http.log 2>&1 &",
    ], { timeoutMs: 10_000 });
    expect(server.exitCode).toBe(0);
    const response = await waitForHttp(`http://${agent.host}:${agent.port}/`);
    expect(response.status).toBe(200);
    await response.text();

    const write = await agent.exec([
      "bash",
      "-c",
      "echo captured > /workspace/captured.txt",
    ]);
    expect(write.exitCode).toBe(0);

    const capture = join(root, "capture");
    await agent.copyOut(capture);
    expect(await readFile(join(capture, "baseline.txt"), "utf8")).toBe(
      "baseline\n",
    );
    expect(await readFile(join(capture, "captured.txt"), "utf8")).toBe(
      "captured\n",
    );
  });

  it("keeps only the dedicated eval key in the agent and blocks other secrets and the network", async () => {
    expect(agent).not.toBeNull();
    const env = await agent!.exec(["bash", "-c", "env"]);
    expect(env.output).toContain("OPENCODE_API_KEY=test-eval-key");
    expect(env.output).not.toContain("NTFY_TOPIC");
    expect(
      (
        await agent!.exec([
          "bash",
          "-c",
          "test ! -e /workspace/.secrets && test ! -e /home/eval/.secrets && test ! -S /var/run/docker.sock",
        ])
      ).exitCode,
    ).toBe(0);

    const outbound = await agent!.exec(
      ["curl", "-sS", "--max-time", "2", "https://example.com"],
      { timeoutMs: 10_000 },
    );
    expect(outbound.exitCode).not.toBe(0);
  });

  it("rejects a secret-looking env var unless it is explicitly allowlisted", async () => {
    await expect(
      startAgentContainer({
        image: IMAGE,
        network,
        controlNetwork,
        name: uniqueName(containerPrefix),
        workspaceDir: workspace,
        env: { OTHER_API_KEY: "not-allowed" },
      }),
    ).rejects.toThrow(/secret-looking env var/);
  });

  it("resolves an egress alias on the internal network", async () => {
    egress = uniqueName("omg-eval-it-egress");
    const started = await docker(
      [
        "run",
        "-d",
        "--name",
        egress,
        "--network",
        network,
        "--network-alias",
        "egress-placeholder",
        "--entrypoint",
        "/bin/sleep",
        IMAGE,
        "infinity",
      ],
      { timeoutMs: 60_000 },
    );
    expect(started.exitCode).toBe(0);

    const resolved = await agent!.exec([
      "python3",
      "-c",
      "import socket; print(socket.gethostbyname('egress-placeholder'))",
    ]);
    expect(resolved.exitCode).toBe(0);
    expect(resolved.stdout.trim()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it("starts the OpenCode server behind the forwarder", async () => {
    expect(agent).not.toBeNull();
    const stopProbeServer = await agent!.exec([
      "bash",
      "-c",
      "pkill -f '[p]ython3 -m http.server 4096' || true",
    ]);
    expect(stopProbeServer.exitCode).toBe(0);

    await agent!.signalReady();
    await agent!.waitForServer(60_000);

    const response = await waitForHttp(
      `http://${agent!.host}:${agent!.port}/`,
      10_000,
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(await agent!.logs()).toContain("opencode server listening");
  });

  it("runs a Go test binary inside the agent container", async () => {
    const task = loadCorpus().tasks.find((t) => t.manifest.id === "go-workerpool");
    expect(task).toBeDefined();
    await agent!.exec(["mkdir", "-p", "/workspace/go-check"]);
    await copyIntoContainer(agent!.name, task!.repoDir, "/workspace/go-check");

    const result = await agent!.exec(
      ["bash", "-lc", 'cd /workspace/go-check && go test ./... 2>&1; echo "go-exit=$?"'],
      { timeoutMs: 300_000 },
    );

    // The compiled test binary must execute from the scratch mounts, and the Go
    // build cache must fit without filling the small home tmpfs.
    expect(result.output).not.toMatch(/permission denied/i);
    expect(result.output).not.toMatch(/no space left on device/i);
    expect(result.output).toContain("worker pool behavior is incomplete");
    expect(result.output).toContain("go-exit=1");
  }, 300_000);

  it("starts the egress proxy on the internal network", async () => {
    proxy = await startProxyContainer({
      image: IMAGE,
      name: uniqueName("omg-eval-it-proxy"),
      network,
      controlNetwork,
      apiKey: "test-proxy-key",
    });

    const health = await agent!.exec([
      "curl",
      "-fsS",
      "http://egress:8787/health",
    ]);
    expect(health.exitCode).toBe(0);
    expect(health.stdout).toContain('"ok":true');

    const hostHealth = await fetch(`${proxy.hostDataUrl}/health`);
    expect(hostHealth.status).toBe(200);
    await hostHealth.text();

    const outbound = await agent!.exec(
      ["curl", "-sS", "--max-time", "2", "https://example.com"],
      { timeoutMs: 10_000 },
    );
    expect(outbound.exitCode).not.toBe(0);

    const stats = await proxy.stats();
    expect(stats.rejected).toBeGreaterThanOrEqual(0);
  });

  it("starts the allowlisted CONNECT tunnel on the internal network", async () => {
    await proxy?.stop();
    proxy = null;

    tunnel = await startEgressTunnelContainer({
      image: IMAGE,
      name: uniqueName("omg-eval-it-tunnel"),
      network,
      controlNetwork,
    });

    const health = await agent!.exec([
      "curl",
      "-fsS",
      "http://egress:8787/health",
    ]);
    expect(health.exitCode).toBe(0);
    expect(health.stdout).toContain('"opencode.ai"');
    expect(health.stdout).toContain('"models.opencode.ai"');

    const denied = await agent!.exec(
      [
        "curl",
        "-sS",
        "--max-time",
        "3",
        "-x",
        "http://egress:8787",
        "https://example.com",
      ],
      { timeoutMs: 10_000 },
    );
    expect(denied.exitCode).not.toBe(0);
  });

  it("starts a no-network test container with no key and no docker socket", async () => {
    testContainer = await startTestContainer({
      image: IMAGE,
      name: uniqueName(containerPrefix),
      workspaceDir: workspace,
    });

    const node = await testContainer.run("node --version");
    expect(node.exitCode).toBe(0);
    expect(node.stdout.trim()).toBe("v22.22.1");

    const toolchains = await testContainer.run(
      "python3 --version && go version && tsx --version",
    );
    expect(toolchains.exitCode).toBe(0);
    expect(toolchains.output).toContain("Python 3.14");
    expect(toolchains.output).toContain("go version go1.26.8");
    expect(toolchains.output).toContain("tsx v4.23.15");

    expect(
      (
        await testContainer.run(
          'test -z "${OPENCODE_API_KEY:-}" && test ! -S /var/run/docker.sock',
        )
      ).exitCode,
    ).toBe(0);

    const outbound = await testContainer.run(
      "curl -sS --max-time 2 https://example.com",
      { timeoutMs: 10_000 },
    );
    expect(outbound.exitCode).not.toBe(0);
  });

  it("runs hidden tests inside the no-network test container", async () => {
    const fixture = await makeRunnerFixture();
    const patch = [
      "diff --git a/src/value.js b/src/value.js",
      "--- a/src/value.js",
      "+++ b/src/value.js",
      "@@ -1 +1 @@",
      "-export const value = 1;",
      "+export const value = 2;",
      "",
    ].join("\n");

    const result = await runTestStage({
      repoDir: fixture.repoDir,
      hiddenDir: fixture.hiddenDir,
      patch,
      hiddenTestCommand: "node --test hidden/*.test.js",
      timeoutMs: 30_000,
      executor: createDockerTestExecutor({ image: IMAGE }),
    });

    expect(result.status).toBe("passed");
    expect(result.testExitCode).toBe(0);
    expect(result.patchApplied).toBe(true);
  });

  it("passes the Go corpus with the reference solution", async () => {
    const task = loadCorpus().tasks.find((t) => t.manifest.id === "go-workerpool");
    expect(task).toBeDefined();
    const patch = await readFile(task!.solutionPath, "utf8");

    const result = await runTestStage({
      repoDir: task!.repoDir,
      hiddenDir: task!.hiddenDir,
      patch,
      hiddenTestCommand: task!.manifest.hiddenTestCommand,
      timeoutMs: 300_000,
      executor: createDockerTestExecutor({ image: IMAGE }),
    });

    expect(result.status).toBe("passed");
    expect(result.testExitCode).toBe(0);
  }, 300_000);

  it("cleans up its containers and network", async () => {
    await agent?.stop();
    await testContainer?.stop();
    await proxy?.stop();
    await tunnel?.stop();
    if (egress) await removeContainer(egress);
    agent = null;
    testContainer = null;
    proxy = null;
    tunnel = null;
    egress = null;
    await removeNetwork(network);
    await removeNetwork(controlNetwork);

    expect(await listContainers(containerPrefix)).toEqual([]);
    expect(await listNetworks(network)).toEqual([]);
    expect(await listNetworks(controlNetwork)).toEqual([]);
  });
});
