import { sha256Hex } from "./corpus";

export interface PromptTask {
  id: string;
  language: string;
  prompt: string;
  publicTestCommand: string;
}

export interface RenderedPrompt {
  prompt: string;
  sha256: string;
  taskMarkdown: string;
}

function normalize(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

export function renderAgentPrompt(task: PromptTask): RenderedPrompt {
  const prompt = [
    `# Task: ${normalize(task.id)}`,
    "",
    normalize(task.prompt),
    "",
    "## Workspace",
    "The repository is in /workspace. You may read and edit files and run commands there.",
    "",
    "## Verification",
    "Run the public tests with:",
    "",
    "```sh",
    normalize(task.publicTestCommand),
    "```",
    "",
    "Do not modify the public tests. Hidden tests are not available in this environment.",
    "Do not use the network.",
    "",
  ].join("\n");

  return {
    prompt,
    sha256: sha256Hex(prompt),
    taskMarkdown: prompt,
  };
}
