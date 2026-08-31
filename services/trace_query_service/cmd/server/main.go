package main

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/attest-ai/trace_query_service/internal/handlers"
	"github.com/attest-ai/trace_query_service/internal/store"
)

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	port := envOr("PORT", "8084")
	dsn := mustEnv("DATABASE_URL")
	objEndpoint := mustEnv("OBJECT_STORE_ENDPOINT")
	objBucket := mustEnv("OBJECT_STORE_BUCKET")
	objAccessKey := mustEnv("OBJECT_STORE_ACCESS_KEY")
	objSecretKey := mustEnv("OBJECT_STORE_SECRET_KEY")
	signURL := mustEnv("SIGNING_SERVICE_URL")

	ctx := context.Background()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to postgres")
	}
	if err := pool.Ping(ctx); err != nil {
		log.Fatal().Err(err).Msg("postgres ping failed")
	}
	defer pool.Close()

	objStore, err := store.NewObjectStore(ctx, objEndpoint, objBucket, objAccessKey, objSecretKey)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to object store")
	}

	h := handlers.New(pool, objStore, signURL)

	if os.Getenv("GIN_MODE") != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.GET("/traces", h.ListSessions)
	r.GET("/traces/:session_id", h.GetTrace)
	r.GET("/traces/:session_id/bundle", h.GetBundle)
	r.GET("/traces/:session_id/export", h.ExportTrace)

	// Command Center — usage / cost / model analytics.
	r.GET("/analytics/overview", h.AnalyticsOverview)
	r.GET("/analytics/timeseries", h.AnalyticsTimeseries)
	r.GET("/analytics/by-model", h.AnalyticsByModel)
	r.GET("/analytics/recent", h.AnalyticsRecent)

	// Trust Center — org-wide attestation verification + public receipts.
	r.GET("/attestation/trust-score", h.TrustScore)
	r.GET("/attestation/verify-batch", h.VerifyBatch)
	r.GET("/attestation/audit-log", h.AuditLog)
	r.GET("/verify/:session_id", h.PublicVerify)

	// Governance Console — key spend, budgets, guardrail alerts.
	r.GET("/governance/keys", h.GovernanceKeys)
	r.GET("/governance/alerts", h.GovernanceAlerts)

	log.Info().Str("port", port).Msg("trace_query_service starting")
	if err := r.Run(":" + port); err != nil {
		log.Fatal().Err(err).Msg("server failed")
	}
}

func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Info().Int("status", c.Writer.Status()).Str("method", c.Request.Method).
			Str("path", c.Request.URL.Path).Dur("latency", time.Since(start)).Msg("request")
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatal().Str("var", key).Msg("required environment variable not set")
	}
	return v
}
