package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// GET /attestation/trust-score?org_id=&window=30d
// Org-wide attestation health: how many sessions are signed + chain-intact.
func (h *QueryHandler) TrustScore(c *gin.Context) {
	orgID := c.Query("org_id")
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id required"})
		return
	}
	since := windowStart(c.DefaultQuery("window", "30d"))
	ctx := c.Request.Context()

	var totalSessions, completedSessions, signedBundles int
	_ = h.db.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed')
		FROM sessions WHERE org_id = $1 AND started_at >= $2`, orgID, since).
		Scan(&totalSessions, &completedSessions)
	_ = h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM attestation_bundles b
		JOIN sessions s ON s.id = b.session_id
		WHERE b.org_id = $1 AND s.started_at >= $2`, orgID, since).
		Scan(&signedBundles)

	var signingEvents int
	_ = h.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM signing_audit_log WHERE org_id = $1 AND signed_at >= $2`, orgID, since).
		Scan(&signingEvents)

	// Coverage = signed bundles / completed sessions.
	coverage := 100.0
	if completedSessions > 0 {
		coverage = float64(signedBundles) / float64(completedSessions) * 100
	}

	c.JSON(http.StatusOK, gin.H{
		"window":             c.DefaultQuery("window", "30d"),
		"total_sessions":     totalSessions,
		"completed_sessions": completedSessions,
		"signed_bundles":     signedBundles,
		"signing_events":     signingEvents,
		"coverage_pct":       coverage,
	})
}

// GET /attestation/verify-batch?org_id=&limit=50
// Re-verifies hash chains + Ed25519 signatures across recent bundles.
// This is the sweep that powers the Trust Center "live re-verification" wall.
func (h *QueryHandler) VerifyBatch(c *gin.Context) {
	orgID := c.Query("org_id")
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id required"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	ctx := c.Request.Context()

	rows, err := h.db.Query(ctx, `
		SELECT b.session_id, b.org_id, b.root_hash, b.signature, b.signing_key_id,
		       b.event_count, b.model_id, b.created_at
		FROM attestation_bundles b
		WHERE b.org_id = $1
		ORDER BY b.created_at DESC LIMIT $2`, orgID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "batch query failed"})
		return
	}
	defer rows.Close()

	type bundleRow struct {
		sessionID, org, rootHash, signature, keyID, model string
		eventCount                                        int
		createdAt                                         time.Time
	}
	var bundles []bundleRow
	for rows.Next() {
		var b bundleRow
		var model *string
		if err := rows.Scan(&b.sessionID, &b.org, &b.rootHash, &b.signature, &b.keyID,
			&b.eventCount, &model, &b.createdAt); err != nil {
			continue
		}
		if model != nil {
			b.model = *model
		}
		bundles = append(bundles, b)
	}
	rows.Close()

	results := []gin.H{}
	verified, sigFail, chainFail := 0, 0, 0
	for _, b := range bundles {
		sigValid := h.verifySignature(ctx, b.org, b.keyID, b.rootHash, b.signature)
		chainValid := h.verifyChain(ctx, b.sessionID)
		ok := sigValid && chainValid
		if ok {
			verified++
		}
		if !sigValid {
			sigFail++
		}
		if !chainValid {
			chainFail++
		}
		results = append(results, gin.H{
			"session_id":      b.sessionID,
			"model_id":        b.model,
			"event_count":     b.eventCount,
			"root_hash":       b.rootHash,
			"signing_key_id":  b.keyID,
			"signature_valid": sigValid,
			"chain_valid":     chainValid,
			"verified":        ok,
			"created_at":      b.createdAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"checked":         len(bundles),
		"verified":        verified,
		"signature_fails": sigFail,
		"chain_fails":     chainFail,
		"results":         results,
	})
}

// GET /verify/:session_id — PUBLIC, no auth. Anyone can validate a receipt.
// Returns a minimal, shareable verification of the signed attestation bundle.
func (h *QueryHandler) PublicVerify(c *gin.Context) {
	sessionID := c.Param("session_id")
	ctx := c.Request.Context()

	var org, rootHash, signature, keyID, model string
	var eventCount int
	var createdAt time.Time
	var modelPtr *string
	err := h.db.QueryRow(ctx, `
		SELECT org_id, root_hash, signature, signing_key_id, event_count, model_id, created_at
		FROM attestation_bundles WHERE session_id = $1`, sessionID).
		Scan(&org, &rootHash, &signature, &keyID, &eventCount, &modelPtr, &createdAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"verified": false,
			"error":    "no attestation bundle for this session",
		})
		return
	}
	if modelPtr != nil {
		model = *modelPtr
	}

	sigValid := h.verifySignature(ctx, org, keyID, rootHash, signature)
	chainValid := h.verifyChain(ctx, sessionID)

	c.JSON(http.StatusOK, gin.H{
		"session_id":      sessionID,
		"verified":        sigValid && chainValid,
		"signature_valid": sigValid,
		"chain_valid":     chainValid,
		"root_hash":       rootHash,
		"signing_key_id":  keyID,
		"event_count":     eventCount,
		"model_id":        model,
		"signed_at":       createdAt,
		"algorithm":       "Ed25519",
		"verified_at":     time.Now().UTC(),
	})
}

// GET /attestation/audit-log?org_id=&limit=100 — signing audit trail.
func (h *QueryHandler) AuditLog(c *gin.Context) {
	orgID := c.Query("org_id")
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id required"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	ctx := c.Request.Context()

	rows, err := h.db.Query(ctx, `
		SELECT key_id, digest, caller_service, signed_at
		FROM signing_audit_log
		WHERE org_id = $1 ORDER BY signed_at DESC LIMIT $2`, orgID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "audit query failed"})
		return
	}
	defer rows.Close()

	entries := []gin.H{}
	for rows.Next() {
		var keyID, digest, caller string
		var signedAt time.Time
		if err := rows.Scan(&keyID, &digest, &caller, &signedAt); err != nil {
			continue
		}
		entries = append(entries, gin.H{
			"key_id":         keyID,
			"digest":         digest,
			"caller_service": caller,
			"signed_at":      signedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}

// verifyChain re-fetches a session's hash-chain entries and recomputes every
// link, returning false if any link is broken (tampering).
func (h *QueryHandler) verifyChain(ctx context.Context, sessionID string) bool {
	rows, err := h.db.Query(ctx, `
		SELECT seq, payload_hash, chain_hash, prev_hash
		FROM hash_chain_entries WHERE session_id = $1 ORDER BY seq ASC`, sessionID)
	if err != nil {
		return false
	}
	defer rows.Close()

	prevHash := genesisHash
	var prevChain string
	first := true
	any := false
	for rows.Next() {
		any = true
		var seq int64
		var payloadHash, chainHash, prev string
		if err := rows.Scan(&seq, &payloadHash, &chainHash, &prev); err != nil {
			return false
		}
		if hashChain(prevHash, payloadHash) != chainHash {
			return false
		}
		if !first && prev != prevChain {
			return false
		}
		prevChain = chainHash
		prevHash = chainHash
		first = false
	}
	return any
}
