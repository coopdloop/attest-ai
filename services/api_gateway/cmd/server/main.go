package main

import (
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/attest-ai/api_gateway/internal/handlers"
	"github.com/attest-ai/api_gateway/internal/middleware"
	"github.com/attest-ai/api_gateway/internal/ratelimit"
)

// version is stamped at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	port := envOr("PORT", "8080")
	authServiceURL := mustEnv("AUTH_SERVICE_URL")
	orchestratorURL := mustEnv("ORCHESTRATOR_URL")
	attestationURL := mustEnv("ATTESTATION_SERVICE_URL")
	redisURL := mustEnv("REDIS_URL")

	limiter, err := ratelimit.New(redisURL)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to Redis")
	}
	defer limiter.Close()

	authMW := middleware.NewAuth(authServiceURL)
	gatewayH := handlers.New(orchestratorURL, attestationURL, limiter)

	if os.Getenv("GIN_MODE") != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger())

	// Health — unauthenticated
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "version": version})
	})

	// All API routes require auth
	v1 := r.Group("/v1")
	v1.Use(authMW.RequireAuth())
	{
		// OpenAI-compatible completions
		v1.POST("/chat/completions", gatewayH.ChatCompletions)

		// Attested agent invocation
		v1.POST("/agents/:id/invoke", gatewayH.InvokeAgent)

		// OpenAI-compatible model catalog
		v1.GET("/models", gatewayH.ListModels)

		// Agent registry
		v1.GET("/agents", gatewayH.ListAgents)

		// Rate limit status
		v1.GET("/rate-limits", gatewayH.RateLimits)
	}

	log.Info().Str("port", port).Msg("api_gateway starting")
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
			Str("ip", c.ClientIP()).
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
