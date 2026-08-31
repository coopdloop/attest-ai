package handlers

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/attest-ai/trace_query_service/internal/store"
)

type QueryHandler struct {
	db       *pgxpool.Pool
	objStore *store.ObjectStore
	signURL  string
}

func New(db *pgxpool.Pool, objStore *store.ObjectStore, signURL string) *QueryHandler {
	return &QueryHandler{db: db, objStore: objStore, signURL: signURL}
}

// GET /traces — paginated session list with filtering
func (h *QueryHandler) ListSessions(c *gin.Context) {
	orgID := c.Query("org_id")
	agentID := c.Query("agent_id")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	query := `SELECT id, agent_id, mode, status, started_at, completed_at, attestation_id
	          FROM sessions WHERE org_id = $1`
	args := []interface{}{orgID}
	argIdx := 2

	if agentID != "" {
		query += fmt.Sprintf(" AND agent_id = $%d", argIdx)
		args = append(args, agentID)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY started_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := h.db.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer rows.Close()

	var sessions []map[string]interface{}
	for rows.Next() {
		var id, agentIDv, mode, status string
		var startedAt time.Time
		var completedAt *time.Time
		var attestationID *string
		if err := rows.Scan(&id, &agentIDv, &mode, &status, &startedAt, &completedAt, &attestationID); err != nil {
			continue
		}
		sessions = append(sessions, map[string]interface{}{
			"session_id":     id,
			"agent_id":       agentIDv,
			"mode":           mode,
			"status":         status,
			"started_at":     startedAt,
			"completed_at":   completedAt,
			"attestation_id": attestationID,
		})
	}
	c.JSON(http.StatusOK, sessions)
}

// GET /traces/:session_id — full trace waterfall for a session
func (h *QueryHandler) GetTrace(c *gin.Context) {
	sessionID := c.Param("session_id")
	ctx := c.Request.Context()

	// Fetch chain entries from postgres (ordered by seq)
	rows, err := h.db.Query(ctx, `
		SELECT id, seq, event_type, payload_hash, chain_hash, prev_hash, blob_key, created_at
		FROM hash_chain_entries WHERE session_id = $1 ORDER BY seq ASC`, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer rows.Close()

	type ChainEntry struct {
		ID          string      `json:"id"`
		Seq         int64       `json:"seq"`
		EventType   string      `json:"event_type"`
		PayloadHash string      `json:"payload_hash"`
		ChainHash   string      `json:"chain_hash"`
		PrevHash    string      `json:"prev_hash"`
		BlobKey     string      `json:"blob_key"`
		CreatedAt   time.Time   `json:"created_at"`
		Payload     interface{} `json:"payload,omitempty"`
	}

	var entries []ChainEntry
	for rows.Next() {
		var e ChainEntry
		if err := rows.Scan(&e.ID, &e.Seq, &e.EventType, &e.PayloadHash,
			&e.ChainHash, &e.PrevHash, &e.BlobKey, &e.CreatedAt); err != nil {
			continue
		}

		// Fetch full payload from MinIO
		if e.BlobKey != "" {
			data, err := h.objStore.GetObject(ctx, e.BlobKey)
			if err == nil {
				var payload interface{}
				_ = json.Unmarshal(data, &payload)
				e.Payload = payload
			}
		}
		entries = append(entries, e)
	}

	// Verify hash chain integrity by recomputing every link.
	tampered := -1
	prevHash := genesisHash
	for i := range entries {
		e := entries[i]
		expectedChain := hashChain(prevHash, e.PayloadHash)
		if e.ChainHash != expectedChain {
			tampered = int(e.Seq)
			break
		}
		if i > 0 && e.PrevHash != entries[i-1].ChainHash {
			tampered = int(e.Seq)
			break
		}
		prevHash = e.ChainHash
	}

	c.JSON(http.StatusOK, gin.H{
		"session_id": sessionID,
		"entries":    entries,
		"count":      len(entries),
		"integrity":  gin.H{"valid": tampered < 0, "tampered_at_seq": tampered},
	})
}

const genesisHash = "0000000000000000000000000000000000000000000000000000000000000000"

// hashChain recomputes SHA-256(prevHash || payloadHash), matching
// attestation_service's chain.HashChain.
func hashChain(prevHash, payloadHash string) string {
	h := sha256.Sum256([]byte(prevHash + payloadHash))
	return hex.EncodeToString(h[:])
}

// GET /traces/:session_id/bundle — retrieve and verify attestation bundle
func (h *QueryHandler) GetBundle(c *gin.Context) {
	sessionID := c.Param("session_id")
	ctx := c.Request.Context()

	// Get bundle from postgres
	var bundleID, rootHash, signature, keyID string
	var orgID string
	err := h.db.QueryRow(ctx, `
		SELECT id, org_id, root_hash, signature, signing_key_id
		FROM attestation_bundles WHERE session_id = $1`, sessionID).
		Scan(&bundleID, &orgID, &rootHash, &signature, &keyID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "attestation bundle not found"})
		return
	}

	// Fetch full bundle blob from MinIO
	bundleKey := fmt.Sprintf("bundles/%s/attestation_bundle.json", sessionID)
	bundleData, err := h.objStore.GetObject(ctx, bundleKey)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "bundle blob not found"})
		return
	}

	var bundle map[string]interface{}
	_ = json.Unmarshal(bundleData, &bundle)

	// Verify signature
	sigValid := h.verifySignature(ctx, orgID, keyID, rootHash, signature)
	bundle["signature_valid"] = sigValid

	c.JSON(http.StatusOK, bundle)
}

// GET /traces/:session_id/export — download signed bundle + full trace
func (h *QueryHandler) ExportTrace(c *gin.Context) {
	sessionID := c.Param("session_id")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="attest-ai-trace-%s.json"`, sessionID))
	c.Header("Content-Type", "application/json")

	// Fetch both trace and bundle
	ctx := c.Request.Context()
	bundleKey := fmt.Sprintf("bundles/%s/attestation_bundle.json", sessionID)
	bundle, _ := h.objStore.GetObject(ctx, bundleKey)

	rows, _ := h.db.Query(ctx,
		"SELECT blob_key FROM hash_chain_entries WHERE session_id = $1 ORDER BY seq", sessionID)
	defer rows.Close()

	var events []interface{}
	for rows.Next() {
		var blobKey string
		if err := rows.Scan(&blobKey); err != nil {
			continue
		}
		data, err := h.objStore.GetObject(ctx, blobKey)
		if err == nil {
			var ev interface{}
			_ = json.Unmarshal(data, &ev)
			events = append(events, ev)
		}
	}

	var bundleObj interface{}
	_ = json.Unmarshal(bundle, &bundleObj)

	export := map[string]interface{}{
		"session_id":         sessionID,
		"attestation_bundle": bundleObj,
		"trace_events":       events,
		"exported_at":        time.Now().UTC(),
	}
	c.JSON(http.StatusOK, export)
}

func (h *QueryHandler) verifySignature(ctx context.Context, orgID, keyID, rootHash, sigHex string) bool {
	// Fetch public key from signing_service HTTP endpoint
	// The signing_service exposes gRPC but we use the REST-equivalent here
	resp, err := http.Get(fmt.Sprintf("%s/public-key?org_id=%s&key_id=%s", h.signURL, orgID, keyID))
	if err != nil || resp.StatusCode != http.StatusOK {
		return false
	}
	defer resp.Body.Close()

	var keyResp struct {
		PublicKey string `json:"public_key_hex"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&keyResp)

	pubKeyBytes, err := hex.DecodeString(keyResp.PublicKey)
	if err != nil || len(pubKeyBytes) != ed25519.PublicKeySize {
		return false
	}

	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil {
		return false
	}

	return ed25519.Verify(ed25519.PublicKey(pubKeyBytes), []byte(rootHash), sigBytes)
}
