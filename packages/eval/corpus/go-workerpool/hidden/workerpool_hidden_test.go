package workerpool

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunsConcurrently(t *testing.T) {
	var active int32
	var maximum int32

	_, err := Run(context.Background(), []int{1, 2, 3, 4, 5, 6}, 3, func(ctx context.Context, job int) (int, error) {
		current := atomic.AddInt32(&active, 1)
		for {
			old := atomic.LoadInt32(&maximum)
			if current <= old || atomic.CompareAndSwapInt32(&maximum, old, current) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		atomic.AddInt32(&active, -1)
		return job * 2, nil
	})

	if err != nil {
		t.Fatalf("worker pool behavior is incomplete: concurrent run failed: %v", err)
	}
	if maximum < 2 {
		t.Fatalf("worker pool behavior is incomplete: did not run concurrently: max %d", maximum)
	}
}

func TestPreservesOrder(t *testing.T) {
	results, err := Run(context.Background(), []int{1, 2, 3, 4}, 3, func(ctx context.Context, job int) (int, error) {
		return job * 10, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []int{10, 20, 30, 40}
	if len(results) != len(want) {
		t.Fatalf("worker pool behavior is incomplete: result length %d", len(results))
	}
	for index := range want {
		if results[index] != want[index] {
			t.Fatalf("worker pool behavior is incomplete: result order %v", results)
		}
	}
}

func TestPropagatesErrors(t *testing.T) {
	sentinel := errors.New("boom")
	_, err := Run(context.Background(), []int{1, 2, 3}, 2, func(ctx context.Context, job int) (int, error) {
		if job == 2 {
			return 0, sentinel
		}
		return job, nil
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("worker pool behavior is incomplete: error not propagated: %v", err)
	}
}

func TestEmptyJobs(t *testing.T) {
	results, err := Run(context.Background(), nil, 2, func(ctx context.Context, job int) (int, error) {
		return job, nil
	})
	if err != nil || len(results) != 0 {
		t.Fatalf("worker pool behavior is incomplete: empty run returned %v, %v", results, err)
	}
}

func TestRejectsNonPositiveWorkers(t *testing.T) {
	_, err := Run(context.Background(), []int{1}, 0, func(ctx context.Context, job int) (int, error) {
		return job, nil
	})
	if err == nil {
		t.Fatal("worker pool behavior is incomplete: zero workers was accepted")
	}
}
