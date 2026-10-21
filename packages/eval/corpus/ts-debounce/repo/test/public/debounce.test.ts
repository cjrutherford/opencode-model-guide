import test from "node:test";
import assert from "node:assert/strict";

import { debounce } from "../../src/debounce.ts";

test("flush runs a pending call", () => {
  let calls = 0;
  const debounced = debounce(() => {
    calls += 1;
  }, 50);

  debounced();
  debounced.flush();

  assert.equal(calls, 1, "trailing call was not debounced");
});
