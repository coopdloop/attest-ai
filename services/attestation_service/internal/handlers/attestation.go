package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/attest-ai/attestation_service/internal/chain"
	"github.com/attest-ai/attestation_service/internal/signclient"
	"github.com/attest-ai/attestation_service/internal/store"
)

type AttestationHandler struct {
	db           *pgxpool.Pool
	objStore     *store.ObjectStore
	signClient   *signclient.Client
	rekorEnabled bool
}

func New(db *pgxpool.Pool, objStore *store.ObjectStore, signClient *signclient.Client, rekor bool) *AttestationHandler {
	return &AttestationHandler{
		db: db, objStore: objStore, signClient: signClient, rekorEnabled: rekor,
	}
}

// POST /sessions/:session_id/events — append a trace event to the hash chain
func (h *AttestationHandler) AppendEvent(c *gin.Context) {
	sessionID := c.Param("session_id")

	var event chain.TraceEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	event.SessionID = sessionID

	ctx := c.Request.Context()

	// Get next seq and prev_hash for this session (atomic via postgres)
	var seq int64
	var prevHash string
	err := h.db.QueryRow(ctx, `
		SELECT COALESCE(MAX(seq) + 1, 0), COALESCE(
			(SELECT chain_hash FROM hash_chain_entries WHERE session_id = $1 ORDER BY seq DESC LIMIT 1),
			$2
		)
		FROM hash_chain_entries WHERE session_id = $1
	`, sessionID, chain.GenesisHash()).Scan(&seq, &prevHash)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get chain state"})
		return
	}

	payloadHash := chain.HashPayload(event.Payload)
	chainHash := chain.HashChain(prevHash, payloadHash)
	entryID := uuid.New().String()

	// Store blob to MinIO
	blobKey := store.TraceEventKey(sessionID, seq)
	blobData, _ := json.Marshal(event)
	if err := h.objStore.PutObject(ctx, blobKey, blobData, "application/json"); err != nil {
		log.Warn().Err(err).Str("blob_key", blobKey).Msg("failed to store trace event blob")
	}

	// Insert chain entry
	_, err = h.db.Exec(ctx, `
		INSERT INTO hash_chain_entries
			(id, session_id, org_id, seq, event_type, payload_hash, chain_hash, prev_hash, blob_key, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, entryID, sessionID, event.OrgID, seq, string(event.EventType),
		payloadHash, chainHash, prevHash, blobKey, time.Now().UTC())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("insert chain entry: %v", err)})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"entry_id":   entryID,
		"seq":        seq,
		"chain_hash": chainHash,
	})
}

// POST /sessions/:session_id/finalize — seal session, sign bundle, return attestation
func (h *AttestationHandler) FinalizeSession(c *gin.Context) {
	sessionID := c.Param("session_id")
	ctx := c.Request.Context()

	var req struct {
		OrgID         string `json:"org_id"`
		ModelID       string `json:"model_id"`
		PolicyVersion string `json:"policy_version"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get final chain state
	var rootHash string
	var eventCount int
	err := h.db.QueryRow(ctx, `
		SELECT chain_hash, seq + 1 FROM hash_chain_entries
		WHERE session_id = $1 ORDER BY seq DESC LIMIT 1
	`, sessionID).Scan(&rootHash, &eventCount)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no events found for session"})
		return
	}

	// Request signature from signing_service
	digest := []byte(rootHash)
	keyID, sig, err := h.signClient.Sign(ctx, req.OrgID, "", "attestation_service", digest)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("signing failed: %v", err)})
		return
	}

	bundle := chain.AttestationBundle{
		SessionID:     sessionID,
		OrgID:         req.OrgID,
		RootHash:      rootHash,
		EventCount:    eventCount,
		ModelID:       req.ModelID,
		PolicyVersion: req.PolicyVersion,
		Signature:     fmt.Sprintf("%x", sig),
		SigningKeyID:  keyID,
		CreatedAt:     time.Now().UTC(),
	}

	// Store bundle to MinIO
	bundleKey := store.BundleKey(sessionID)
	bundleData, _ := json.Marshal(bundle)
	_ = h.objStore.PutObject(ctx, bundleKey, bundleData, "application/json")

	// Persist to postgres. A session can now be finalized more than once — a
	// continued (multi-turn) session re-finalizes after every turn so the
	// bundle always reflects the current hash-chain root — so this is an
	// upsert keyed on the session's one-bundle-per-session constraint rather
	// than a plain insert.
	bundleID := uuid.New().String()
	err = h.db.QueryRow(ctx, `
		INSERT INTO attestation_bundles
			(id, session_id, org_id, root_hash, event_count, model_id, policy_version,
			 signature, signing_key_id, bundle_blob_key, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (session_id) DO UPDATE SET
			root_hash = EXCLUDED.root_hash,
			event_count = EXCLUDED.event_count,
			model_id = EXCLUDED.model_id,
			policy_version = EXCLUDED.policy_version,
			signature = EXCLUDED.signature,
			signing_key_id = EXCLUDED.signing_key_id,
			bundle_blob_key = EXCLUDED.bundle_blob_key,
			created_at = EXCLUDED.created_at
		RETURNING id
	`, bundleID, sessionID, req.OrgID, rootHash, eventCount, req.ModelID, req.PolicyVersion,
		bundle.Signature, keyID, bundleKey, bundle.CreatedAt).Scan(&bundleID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist attestation bundle"})
		return
	}

	// Update session with attestation_id. Session status is owned by the
	// turn/session lifecycle (agent_orchestrator), not here — a session
	// finalized mid-task (e.g. paused on a client-side tool call) isn't done.
	_, _ = h.db.Exec(ctx, `UPDATE sessions SET attestation_id = $1 WHERE id = $2`,
		bundleID, sessionID)

	c.JSON(http.StatusOK, bundle)
}

// GET /sessions/:session_id/bundle — retrieve the attestation bundle
func (h *AttestationHandler) GetBundle(c *gin.Context) {
	sessionID := c.Param("session_id")
	ctx := c.Request.Context()

	bundleKey := store.BundleKey(sessionID)
	data, err := h.objStore.GetObject(ctx, bundleKey)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "attestation bundle not found"})
		return
	}

	var bundle chain.AttestationBundle
	if err := json.Unmarshal(data, &bundle); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse bundle"})
		return
	}
	c.JSON(http.StatusOK, bundle)
}

func connectDB(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	return pool, pool.Ping(ctx)
}
