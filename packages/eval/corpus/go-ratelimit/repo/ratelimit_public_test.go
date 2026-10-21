package ratelimit

import (
	"testing"
	"time"
)

func TestRefillsByElapsedTime(t *testing.T) {
	now := time.Unix(0, 0)
	bucket := New(1, 1, func() time.Time { return now })

	if !bucket.Allow() {
		t.Fatal("initial token missing")
	}
	if bucket.Allow() {
		t.Fatal("unexpected extra token")
	}

	now = now.Add(time.Second)
	if !bucket.Allow() {
		t.Fatal("rate limiter behavior is incomplete: token did not refill")
	}
}
