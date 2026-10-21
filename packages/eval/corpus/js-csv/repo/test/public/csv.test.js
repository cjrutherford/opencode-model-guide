import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv } from "../../src/csv.js";

test("parses a quoted field containing a comma", () => {
  assert.deepEqual(
    parseCsv('a,b\n"x,y",z'),
    [["a", "b"], ["x,y", "z"]],
    "CSV behavior is incomplete: quoted field was not parsed",
  );
});
