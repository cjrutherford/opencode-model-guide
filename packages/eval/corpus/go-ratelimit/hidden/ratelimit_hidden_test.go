package ratelimit

import (
	"context"
	"testing"
	"time"
)

func TestRefillIsCappedAtCapacity(t *testing.T) {
	now := time.Unix(0, 0)
	bucket := New(2, 1, func() time.Time { return now })
	now = now.Add(10 * time.Second)

	if !bucket.Allow() || !bucket.Allow() {
		t.Fatal("rate limiter behavior is incomplete: refill did not reach capacity")
	}
	if bucket.Allow() {
		t.Fatal("rate limiter behavior is incomplete: capacity was exceeded")
	}
}

func TestPartialRefill(t *testing.T) {
	now := time.Unix(0, 0)
	bucket := New(1, 0.5, func() time.Time { return now })
	if !bucket.Allow() {
		t.Fatal("initial token missing")
	}

	now = now.Add(time.Second)
	if bucket.Allow() {
		t.Fatal("rate limiter behavior is incomplete: partial token was spent")
	}

	now = now.Add(time.Second)
	if !bucket.Allow() {
		t.Fatal("rate limiter behavior is incomplete: accumulated token was not spent")
	}
}

func TestWaitStopsOnCancellation(t *testing.T) {
	now := time.Unix(0, 0)
	bucket := New(1, 0.001, func() time.Time { return now })
	bucket.Allow()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := bucket.Wait(ctx); err != context.Canceled {
		t.Fatalf("rate limiter behavior is incomplete: cancellation returned %v", err)
	}
}

func TestWaitRefills(t *testing.T) {
	bucket := New(1, 100, nil)
	bucket.Allow()

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := bucket.Wait(ctx); err != nil {
		t.Fatalf("rate limiter behavior is incomplete: Wait did not refill: %v", err)
	}
}
