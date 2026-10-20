import {
  skippedStatus,
  type AdapterResult,
} from "./types";

export const TERMINAL_BENCH_URL = "https://www.tbench.ai/leaderboard";

export function terminalBenchAdapter(
  now = new Date().toISOString(),
): AdapterResult {
  return {
    results: [],
    status: skippedStatus(
      "terminal-bench",
      TERMINAL_BENCH_URL,
      "no stable machine-readable leaderboard in v1",
      now,
    ),
  };
}
