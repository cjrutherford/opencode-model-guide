import test from "node:test";
import assert from "node:assert/strict";

import { retry } from "../src/retry.js";

test("does not invoke the function when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    retry(
      async () => {
        calls += 1;
        throw new Error("should not run");
      },
      { baseDelayMs: 0, signal: controller.signal },
    ),
  );

  assert.equal(
    calls,
    0,
    "retry behavior is incomplete: aborted signal still invoked the function",
  );
});

test("returns the first successful value", async () => {
  let calls = 0;
  const value = await retry(
    async () => {
      calls += 1;
      if (calls < 2) throw new Error("try again");
      return "ok";
    },
    { attempts: 3, baseDelayMs: 0 },
  );

  assert.equal(value, "ok");
  assert.equal(calls, 2);
});

test("throws the last error after the attempts are exhausted", async () => {
  let calls = 0;
  await assert.rejects(
    retry(
      async () => {
        calls += 1;
        throw new Error(`failure-${calls}`);
      },
      { attempts: 2, baseDelayMs: 0 },
    ),
    /failure-2/,
  );
  assert.equal(calls, 2);
});
