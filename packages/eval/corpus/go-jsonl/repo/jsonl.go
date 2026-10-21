package jsonl

import "encoding/json"

type LineError struct {
	Line int
	Err  error
}

func Decode(lines []string) ([]map[string]any, []LineError) {
	var values []map[string]any
	for _, line := range lines {
		var value map[string]any
		if err := json.Unmarshal([]byte(line), &value); err != nil {
			return nil, []LineError{{Line: 0, Err: err}}
		}
		values = append(values, value)
	}
	return values, nil
}
