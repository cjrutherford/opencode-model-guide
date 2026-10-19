import { SourceStatusSchema, type SourceStatus } from "@omg/shared";

import { fetchJson } from "../http";

export const MODELS_DEV_URL = "https://models.dev/api.json";

export const NATIVE_PROVIDER_IDS = ["opencode", "opencode-go"] as const;
export type NativeProviderId = (typeof NATIVE_PROVIDER_IDS)[number];

export interface ModelsDevTierCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  tier?: { type?: string; size?: number };
}

export interface ModelsDevContextCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface ModelsDevCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  tiers?: ModelsDevTierCost[];
  context_over_200k?: ModelsDevContextCost;
}

export interface ModelsDevModel {
  id?: string;
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  release_date?: string;
  last_updated?: string;
  status?: string;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number; input?: number };
  cost?: ModelsDevCost;
}

export interface ModelsDevProvider {
  id: NativeProviderId;
  name: string;
  doc?: string;
  models: Record<string, ModelsDevModel>;
}

export interface ModelsDevResult {
  providers: ModelsDevProvider[];
  source: SourceStatus;
}

export function parseModelsDev(payload: unknown): ModelsDevProvider[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("models.dev payload is not an object");
  }

  const root = payload as Record<string, unknown>;
  const providers: ModelsDevProvider[] = [];

  for (const id of NATIVE_PROVIDER_IDS) {
    const raw = root[id];
    if (!raw || typeof raw !== "object") {
      throw new Error(`models.dev payload is missing provider ${id}`);
    }
    const provider = raw as ModelsDevProvider;
    if (!provider.models || typeof provider.models !== "object") {
      throw new Error(`models.dev provider ${id} has no models`);
    }
    providers.push({
      id,
      name: typeof provider.name === "string" ? provider.name : id,
      doc: typeof provider.doc === "string" ? provider.doc : undefined,
      models: provider.models,
    });
  }

  return providers;
}

export async function fetchModelsDev(): Promise<ModelsDevResult> {
  const started = Date.now();
  const payload = await fetchJson<unknown>("models.dev", MODELS_DEV_URL);
  const providers = parseModelsDev(payload);
  const itemCount = providers.reduce(
    (total, provider) => total + Object.keys(provider.models).length,
    0,
  );

  const source = SourceStatusSchema.parse({
    id: "models.dev",
    url: MODELS_DEV_URL,
    ok: true,
    status: "ok",
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    itemCount,
    required: true,
  });

  return { providers, source };
}
