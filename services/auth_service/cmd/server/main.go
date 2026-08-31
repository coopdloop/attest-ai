package main

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/attest-ai/auth_service/internal/auth"
	"github.com/attest-ai/auth_service/internal/db"
	"github.com/attest-ai/auth_service/internal/handlers"
	"github.com/attest-ai/auth_service/internal/middleware"
)

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	port := envOr("PORT", "8081")
	dsn := mustEnv("DATABASE_URL")
	jwtKeyPath := envOr("JWT_PRIVATE_KEY_PATH", "/keys/jwt_private.pem")
	singleUser := os.Getenv("SINGLE_USER_MODE") == "true"

	// Reject known-insecure default secrets outside of dev.
	if os.Getenv("APP_ENV") == "production" {
		for _, k := range []string{"POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD", "OBJECT_STORE_SECRET_KEY", "DATABASE_URL"} {
			v := os.Getenv(k)
			if strings.Contains(v, "changeme") {
				log.Fatal().Str("var", k).Msg("insecure default secret detected in production; set a strong value")
			}
		}
	}

	ctx := context.Background()

	database, err := db.Connect(ctx, dsn)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to postgres")
	}
	defer database.Close()

	jwtSvc, err := auth.NewJWTService(jwtKeyPath)
	if err != nil {
		log.Fatal().Err(err).Str("key_path", jwtKeyPath).Msg("failed to load JWT private key")
	}

	if os.Getenv("GIN_MODE") != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger())

	// Health
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Auth routes
	authH := handlers.NewAuthHandler(database, jwtSvc, singleUser)
	r.POST("/register", authH.Register)
	r.POST("/login", authH.Login)
	r.POST("/sso/oidc/callback", authH.OIDCCallback)
	r.POST("/sso/saml/acs", authH.SAMLCallback)
	r.POST("/tokens/refresh", authH.RefreshToken)
	// Introspect is public — the api_gateway calls it without its own token
	r.POST("/tokens/introspect", authH.IntrospectToken)

	protected := r.Group("")
	protected.Use(middleware.RequireAuth(jwtSvc))

	// Org management — admin only
	orgH := handlers.NewOrgHandler(database)
	admin := protected.Group("")
	admin.Use(middleware.RequireRole("admin"))
	admin.GET("/orgs", orgH.List)
	admin.POST("/orgs", orgH.Create)
	admin.GET("/orgs/:org_id", orgH.Get)
	admin.PUT("/orgs/:org_id", orgH.Update)
	admin.DELETE("/orgs/:org_id", orgH.Delete)
	admin.GET("/orgs/:org_id/agent-registry-permissions", orgH.GetAgentPermissions)
	admin.PUT("/orgs/:org_id/agent-registry-permissions", orgH.UpdateAgentPermissions)

	// Users
	userH := handlers.NewUserHandler(database)
	protected.GET("/orgs/:org_id/users", userH.List)
	protected.POST("/orgs/:org_id/users", userH.Create)
	protected.GET("/orgs/:org_id/users/:user_id", userH.Get)
	protected.PUT("/orgs/:org_id/users/:user_id", userH.Update)
	protected.DELETE("/orgs/:org_id/users/:user_id", userH.Delete)

	// Teams
	teamH := handlers.NewTeamHandler(database)
	protected.GET("/orgs/:org_id/teams", teamH.List)
	protected.POST("/orgs/:org_id/teams", teamH.Create)
	protected.GET("/orgs/:org_id/teams/:team_id", teamH.Get)
	protected.PUT("/orgs/:org_id/teams/:team_id", teamH.Update)
	protected.DELETE("/orgs/:org_id/teams/:team_id", teamH.Delete)

	// API Keys
	keyH := handlers.NewAPIKeyHandler(database)
	protected.GET("/orgs/:org_id/api-keys", keyH.List)
	protected.POST("/orgs/:org_id/api-keys", keyH.Create)
	protected.DELETE("/orgs/:org_id/api-keys/:key_id", keyH.Revoke)

	log.Info().Str("port", port).Bool("single_user_mode", singleUser).Msg("auth_service starting")
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
