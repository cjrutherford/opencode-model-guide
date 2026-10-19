import { SourceStatusSchema, type SourceStatus } from "@omg/shared";

import { fetchJson } from "../http";

export const OPENCODE_MODELS_URL = "https://opencode.ai/inference/v1/models";
export const OPENCODE_GO_MODELS_URL = "https://opencode.ai/inference/go/v1/models";

export interface LiveModelsResult {
  live: Set<string>;
  goLive: Set<string>;
  sources: SourceStatus[];
}

export function parseLiveIds(payload: unknown): Set<string> {
  if (!payload || typeof payload !== "object") {
    throw new Error("live models payload is not an object");
  }

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("live models payload has no data array");
  }

  const ids = new Set<string>();
  for (const entry of data) {
    if (entry && typeof entry === "object") {
      const id = (entry as { id?: unknown }).id;
      if (typeof id === "string" && id.length > 0) ids.add(id);
    }
  }
  return ids;
}

async function fetchLive(
  id: "opencode.models" | "opencode-go.models",
  url: string,
): Promise<{ ids: Set<string>; status: SourceStatus }> {
  const started = Date.now();
  const payload = await fetchJson<unknown>(id, url);
  const ids = parseLiveIds(payload);

  const status = SourceStatusSchema.parse({
    id,
    url,
    ok: true,
    status: "ok",
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    itemCount: ids.size,
    required: true,
  });

  return { ids, status };
}

export async function fetchLiveModels(): Promise<LiveModelsResult> {
  const [live, goLive] = await Promise.all([
    fetchLive("opencode.models", OPENCODE_MODELS_URL),
    fetchLive("opencode-go.models", OPENCODE_GO_MODELS_URL),
  ]);

  return {
    live: live.ids,
    goLive: goLive.ids,
    sources: [live.status, goLive.status],
  };
}
