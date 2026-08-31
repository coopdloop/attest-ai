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

	"github.com/attest-ai/attestation_service/internal/handlers"
	"github.com/attest-ai/attestation_service/internal/signclient"
	"github.com/attest-ai/attestation_service/internal/store"
)

// version is stamped at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	port := envOr("PORT", "8082")
	dsn := mustEnv("DATABASE_URL")
	objEndpoint := mustEnv("OBJECT_STORE_ENDPOINT")
	objBucket := mustEnv("OBJECT_STORE_BUCKET")
	objAccessKey := mustEnv("OBJECT_STORE_ACCESS_KEY")
	objSecretKey := mustEnv("OBJECT_STORE_SECRET_KEY")
	signingURL := mustEnv("SIGNING_SERVICE_URL")
	rekorEnabled := os.Getenv("REKOR_ENABLED") == "true"

	ctx := context.Background()

	// Postgres
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to postgres")
	}
	if err := pool.Ping(ctx); err != nil {
		log.Fatal().Err(err).Msg("postgres ping failed")
	}
	defer pool.Close()
	log.Info().Msg("connected to postgres")

	// MinIO / S3
	objStore, err := store.NewObjectStore(ctx, objEndpoint, objBucket, objAccessKey, objSecretKey)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to object store")
	}
	log.Info().Str("endpoint", objEndpoint).Str("bucket", objBucket).Msg("connected to object store")

	// signing_service gRPC client
	signClient, err := signclient.New(signingURL)
	if err != nil {
		log.Fatal().Err(err).Str("url", signingURL).Msg("failed to connect to signing_service")
	}
	defer signClient.Close()
	log.Info().Str("url", signingURL).Msg("connected to signing_service")

	h := handlers.New(pool, objStore, signClient, rekorEnabled)

	if os.Getenv("GIN_MODE") != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "version": version})
	})

	r.POST("/sessions/:session_id/events", h.AppendEvent)
	r.POST("/sessions/:session_id/finalize", h.FinalizeSession)
	r.GET("/sessions/:session_id/bundle", h.GetBundle)

	log.Info().Str("port", port).Bool("rekor_enabled", rekorEnabled).Msg("attestation_service starting")
	if err := r.Run(":" + port); err != nil {
		log.Fatal().Err(err).Msg("server failed")
	}
}

func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Info().
			Int("status", c.Writer.Status()).
			Str("method", c.Request.Method).
			Str("path", c.Request.URL.Path).
			Dur("latency", time.Since(start)).
			Msg("request")
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
