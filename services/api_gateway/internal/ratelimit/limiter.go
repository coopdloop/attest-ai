package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	defaultLimit  = 100
	windowSeconds = 60
)

// Limiter enforces per-org/per-key rate limits using a Redis sliding window.
type Limiter struct {
	rdb *redis.Client
}

func New(redisURL string) (*Limiter, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis URL: %w", err)
	}
	return &Limiter{rdb: redis.NewClient(opt)}, nil
}

func (l *Limiter) Close() error {
	return l.rdb.Close()
}

// Check returns (remaining, resetAt, allowed).
func (l *Limiter) Check(ctx context.Context, key string, limit int) (int, time.Time, bool) {
	if limit <= 0 {
		limit = defaultLimit
	}
	window := time.Now().Truncate(time.Minute)
	redisKey := fmt.Sprintf("ratelimit:%s:%d", key, window.Unix())

	pipe := l.rdb.Pipeline()
	incr := pipe.Incr(ctx, redisKey)
	pipe.Expire(ctx, redisKey, time.Duration(windowSeconds+5)*time.Second)
	_, _ = pipe.Exec(ctx)

	count := int(incr.Val())
	remaining := limit - count
	resetAt := window.Add(time.Minute)

	return remaining, resetAt, count <= limit
}

// Status returns current usage without incrementing.
func (l *Limiter) Status(ctx context.Context, key string, limit int) (int, int, time.Time) {
	if limit <= 0 {
		limit = defaultLimit
	}
	window := time.Now().Truncate(time.Minute)
	redisKey := fmt.Sprintf("ratelimit:%s:%d", key, window.Unix())
	count, _ := l.rdb.Get(ctx, redisKey).Int()
	remaining := limit - count
	if remaining < 0 {
		remaining = 0
	}
	return limit, remaining, window.Add(time.Minute)
}
