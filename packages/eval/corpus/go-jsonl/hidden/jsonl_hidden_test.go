package jsonl

import "testing"

func TestSkipsBlankLinesWithOneBasedNumbers(t *testing.T) {
	values, errs := Decode([]string{"", "  ", `{"a":1}`, "bad", `{"b":2}`})
	if len(values) != 2 || len(errs) != 1 || errs[0].Line != 4 {
		t.Fatalf(
			"JSONL behavior is incomplete: blank/line handling values=%d errors=%d",
			len(values),
			len(errs),
		)
	}
}

func TestReportsEveryMalformedLine(t *testing.T) {
	values, errs := Decode([]string{"bad", `{"ok":true}`, "also-bad"})
	if len(values) != 1 || len(errs) != 2 {
		t.Fatalf(
			"JSONL behavior is incomplete: multiple errors values=%d errors=%d",
			len(values),
			len(errs),
		)
	}
	if errs[0].Line != 1 || errs[1].Line != 3 {
		t.Fatalf("JSONL behavior is incomplete: error lines %d, %d", errs[0].Line, errs[1].Line)
	}
}

func TestPreservesNestedValues(t *testing.T) {
	values, errs := Decode([]string{`{"user":{"id":7},"tags":["a","b"]}`})
	if len(errs) != 0 || len(values) != 1 {
		t.Fatalf("JSONL behavior is incomplete: nested decode failed: %v", errs)
	}
	user, ok := values[0]["user"].(map[string]any)
	if !ok || user["id"] != float64(7) {
		t.Fatalf("JSONL behavior is incomplete: nested value %v", values[0])
	}
}

func TestEmptyInput(t *testing.T) {
	values, errs := Decode(nil)
	if len(values) != 0 || len(errs) != 0 {
		t.Fatalf("JSONL behavior is incomplete: empty input returned %v, %v", values, errs)
	}
}
