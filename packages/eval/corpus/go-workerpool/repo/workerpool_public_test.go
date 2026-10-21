package workerpool

import (
	"context"
	"errors"
	"testing"
)

func TestCancellationStopsWork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0

	_, err := Run(ctx, []int{1, 2, 3}, 1, func(ctx context.Context, job int) (int, error) {
		calls++
		cancel()
		return job, nil
	})

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("worker pool behavior is incomplete: expected cancellation, got %v", err)
	}
	if calls != 1 {
		t.Fatalf("worker pool behavior is incomplete: continued after cancellation: %d calls", calls)
	}
}
