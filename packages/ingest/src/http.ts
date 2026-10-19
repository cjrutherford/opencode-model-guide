export class SourceError extends Error {
  constructor(
    public readonly source: string,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(`[${source}] ${message}`);
    this.name = "SourceError";
  }
}

const TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 500;
const USER_AGENT =
  "opencode-model-guide/1.0 (+https://github.com/cjrutherford/opencode-model-guide)";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
  return headers;
}

async function requestWithRetry(
  source: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: buildHeaders(init),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) {
          await delay(RETRY_DELAY_MS);
          continue;
        }
        throw new SourceError(
          source,
          `HTTP ${response.status} ${response.statusText} for ${url}`,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof SourceError) throw error;

      lastError = error;
      if (attempt === 0) {
        await delay(RETRY_DELAY_MS);
        continue;
      }
    }
  }

  throw new SourceError(source, `request failed for ${url}`, lastError);
}

export async function fetchJson<T>(
  source: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await requestWithRetry(source, url, init);
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new SourceError(source, `invalid JSON from ${url}`, error);
  }
}

export async function fetchText(
  source: string,
  url: string,
  init?: RequestInit,
): Promise<string> {
  const response = await requestWithRetry(source, url, init);
  try {
    return await response.text();
  } catch (error) {
    throw new SourceError(source, `could not read response body from ${url}`, error);
  }
}
