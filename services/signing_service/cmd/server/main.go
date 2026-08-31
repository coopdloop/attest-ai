package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	"github.com/attest-ai/signing_service/internal/db"
	"github.com/attest-ai/signing_service/internal/keystore"
	"github.com/attest-ai/signing_service/internal/signer"
	pb "github.com/attest-ai/signing_service/proto/signingpb"
)

// version is stamped at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("LOG_LEVEL") == "debug" {
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	} else {
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	}
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	port := envOr("PORT", "8083")
	keyPath := envOr("LOCAL_KEY_PATH", "/keys")
	dsn := mustEnv("AUDIT_LOG_DATABASE_URL")

	ctx := context.Background()

	// Connect to postgres for audit logging
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to postgres")
	}
	defer pool.Close()
	log.Info().Msg("connected to postgres audit database")

	// Init key store
	store, err := keystore.NewLocalFileStore(keyPath)
	if err != nil {
		log.Fatal().Err(err).Str("path", keyPath).Msg("failed to init key store")
	}

	auditDB := db.NewAuditDB(pool)
	signerSvc := signer.New(store, auditDB)

	// Ensure a default org key exists (for single-user mode)
	defaultOrg := envOr("DEFAULT_ORG_ID", "default")
	if err := signerSvc.EnsureOrgKey(ctx, defaultOrg); err != nil {
		log.Fatal().Err(err).Str("org_id", defaultOrg).Msg("failed to ensure org key")
	}

	// Start gRPC server
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		log.Fatal().Err(err).Str("port", port).Msg("failed to listen")
	}

	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(loggingInterceptor),
	)
	pb.RegisterSigningServiceServer(grpcServer, &grpcHandler{svc: signerSvc})
	reflection.Register(grpcServer) // enable grpcurl in dev

	log.Info().Str("port", port).Str("version", version).Msg("signing_service gRPC server starting")
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatal().Err(err).Msg("gRPC server failed")
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

func loggingInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	start := time.Now()
	resp, err := handler(ctx, req)
	log.Info().
		Str("method", info.FullMethod).
		Dur("duration", time.Since(start)).
		Bool("error", err != nil).
		Msg("gRPC call")
	return resp, err
}
