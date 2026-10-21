import test from "node:test";
import assert from "node:assert/strict";

import { retry } from "../../src/retry.js";

test("stops retrying after the signal is aborted", async () => {
  const controller = new AbortController();
  let calls = 0;

  await assert.rejects(
    retry(
      async () => {
        calls += 1;
        controller.abort();
        throw new Error("boom");
      },
      { attempts: 5, baseDelayMs: 0, signal: controller.signal },
    ),
  );

  assert.equal(
    calls,
    1,
    "retry behavior is incomplete: retry continued after abort",
  );
});
