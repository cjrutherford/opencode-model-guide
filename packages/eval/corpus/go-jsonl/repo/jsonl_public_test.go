package jsonl

import "testing"

func TestMalformedLinesAreReportedAndSkipped(t *testing.T) {
	values, errs := Decode([]string{`{"a":1}`, `not-json`, `{"b":2}`})
	if len(values) != 2 || len(errs) != 1 || errs[0].Line != 2 {
		t.Fatalf(
			"JSONL behavior is incomplete: values=%d errors=%d line=%d",
			len(values),
			len(errs),
			func() int {
				if len(errs) == 0 {
					return 0
				}
				return errs[0].Line
			}(),
		)
	}
}
