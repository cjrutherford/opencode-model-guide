import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv } from "../src/csv.js";

test("parses escaped quotes", () => {
  assert.deepEqual(
    parseCsv('"a""b",c'),
    [['a"b', "c"]],
    "CSV behavior is incomplete: escaped quote was not parsed",
  );
});

test("parses embedded newlines", () => {
  assert.deepEqual(
    parseCsv('"a\nb",c'),
    [["a\nb", "c"]],
    "CSV behavior is incomplete: embedded newline was not parsed",
  );
});

test("handles CRLF and trailing empty fields", () => {
  assert.deepEqual(
    parseCsv("a,\r\nb,c\r\n"),
    [["a", ""], ["b", "c"]],
    "CSV behavior is incomplete: CRLF or trailing field",
  );
});

test("returns no rows for empty input", () => {
  assert.deepEqual(parseCsv(""), [], "CSV behavior is incomplete: empty input");
});
