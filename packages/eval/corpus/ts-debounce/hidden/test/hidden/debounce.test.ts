import test from "node:test";
import assert from "node:assert/strict";

import { debounce } from "../../src/debounce.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("calls once with the latest arguments after the quiet period", async () => {
  const calls: Array<[string, number]> = [];
  const debounced = debounce((name: string, count: number) => {
    calls.push([name, count]);
  }, 20);

  debounced("first", 1);
  debounced("second", 2);
  await sleep(40);

  assert.deepEqual(calls, [["second", 2]]);
});

test("cancel drops a pending call", async () => {
  let calls = 0;
  const debounced = debounce(() => {
    calls += 1;
  }, 20);

  debounced();
  debounced.cancel();
  await sleep(40);

  assert.equal(calls, 0);
});

test("flush runs the latest pending call immediately and clears it", async () => {
  const calls: string[] = [];
  const debounced = debounce((value: string) => {
    calls.push(value);
  }, 50);

  debounced("one");
  debounced("two");
  debounced.flush();

  assert.deepEqual(calls, ["two"], "trailing call was not debounced");
  await sleep(60);
  assert.deepEqual(calls, ["two"], "trailing call was not debounced");
});

test("flush with no pending call is a no-op", () => {
  let calls = 0;
  const debounced = debounce(() => {
    calls += 1;
  }, 20);

  debounced.flush();
  assert.equal(calls, 0);
});
