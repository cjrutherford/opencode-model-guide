package ratelimit

import (
	"context"
	"time"
)

type Bucket struct {
	capacity float64
	tokens   float64
	rate     float64
	now      func() time.Time
	last     time.Time
}

func New(capacity int, ratePerSecond float64, now func() time.Time) *Bucket {
	if now == nil {
		now = time.Now
	}
	return &Bucket{
		capacity: float64(capacity),
		tokens:   float64(capacity),
		rate:     ratePerSecond,
		now:      now,
		last:     now(),
	}
}

func (bucket *Bucket) Allow() bool {
	if bucket.tokens >= 1 {
		bucket.tokens -= 1
		return true
	}
	return false
}

func (bucket *Bucket) Refill(amount float64) {
	bucket.tokens += amount
	if bucket.tokens > bucket.capacity {
		bucket.tokens = bucket.capacity
	}
}

func (bucket *Bucket) Wait(ctx context.Context) error {
	for !bucket.Allow() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
	return nil
}
