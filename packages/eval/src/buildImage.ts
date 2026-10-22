import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runCommand } from "./process";
import { inspectImage } from "./sandbox/docker";

const SANDBOX_DIR = fileURLToPath(new URL("../sandbox", import.meta.url));
const DEFAULT_IMAGE = "omg-eval-sandbox:local";

async function main(): Promise<void> {
  const image = process.env.OMG_EVAL_IMAGE ?? DEFAULT_IMAGE;
  const arch = process.env.OMG_EVAL_ARCH ??
    (process.arch === "arm64" ? "arm64" : "amd64");
  const platform = process.env.OMG_EVAL_PLATFORM;

  const args = [
    "build",
    "--progress=plain",
    "--file",
    join(SANDBOX_DIR, "Dockerfile"),
    "--tag",
    image,
    "--build-arg",
    `TARGETARCH=${arch}`,
  ];
  if (platform) args.push("--platform", platform);
  args.push(SANDBOX_DIR);

  const result = await runCommand("docker", args, {
    cwd: process.cwd(),
    timeoutMs: 30 * 60_000,
    maxOutputChars: 64_000,
    keepOutput: "tail",
  });

  if (result.exitCode !== 0) {
    process.stderr.write(result.output);
    throw new Error(
      `sandbox image build failed with exit code ${result.exitCode ?? "null"}`,
    );
  }

  const info = await inspectImage(image);
  if (!info) throw new Error(`built image is not inspectable: ${image}`);

  process.stdout.write(
    `${JSON.stringify({
      image,
      digest: info.id,
      platform: info.platform,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
