package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AuditDB writes signing operations to the audit log table.
type AuditDB struct {
	pool *pgxpool.Pool
}

func NewAuditDB(pool *pgxpool.Pool) *AuditDB {
	return &AuditDB{pool: pool}
}

type SigningAuditEntry struct {
	OrgID         string
	KeyID         string
	Digest        string
	Signature     string
	CallerService string
	SignedAt      time.Time
}

func (db *AuditDB) LogSigningOp(ctx context.Context, entry SigningAuditEntry) error {
	_, err := db.pool.Exec(ctx, `
		INSERT INTO signing_audit_log
			(org_id, key_id, digest, signature, caller_service, signed_at)
		VALUES
			($1, $2, $3, $4, $5, $6)
	`,
		nullableStr(entry.OrgID),
		entry.KeyID,
		entry.Digest,
		entry.Signature,
		entry.CallerService,
		entry.SignedAt,
	)
	if err != nil {
		return fmt.Errorf("insert signing audit log: %w", err)
	}
	return nil
}

func nullableStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// Connect creates a pgxpool connection.
func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return pool, nil
}
