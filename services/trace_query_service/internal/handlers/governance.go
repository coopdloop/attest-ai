package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// GET /governance/keys?org_id=&window=30d
// Per-key usage + budget burn-down for the Governance Console.
func (h *QueryHandler) GovernanceKeys(c *gin.Context) {
	orgID := c.Query("org_id")
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id required"})
		return
	}
	since := windowStart(c.DefaultQuery("window", "30d"))
	ctx := c.Request.Context()

	rows, err := h.db.Query(ctx, `
		SELECT
			k.id, k.name, k.key_prefix, k.scopes, k.budget_usd, k.monthly_quota,
			k.last_used_at, k.expires_at, k.revoked_at, k.created_at,
			COALESCE(u.requests, 0)   AS requests,
			COALESCE(u.cost, 0)       AS cost,
			COALESCE(u.tokens, 0)     AS tokens,
			COALESCE(u.failed, 0)     AS failed
		FROM api_keys k
		LEFT JOIN (
			SELECT api_key_id,
			       COUNT(*) AS requests,
			       SUM(total_cost_usd) AS cost,
			       SUM(total_tokens) AS tokens,
			       COUNT(*) FILTER (WHERE status = 'failed') AS failed
			FROM sessions
			WHERE org_id = $1 AND started_at >= $2 AND api_key_id IS NOT NULL
			GROUP BY api_key_id
		) u ON u.api_key_id = k.id
		WHERE k.org_id = $1
		ORDER BY k.created_at DESC`, orgID, since)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "keys query failed"})
		return
	}
	defer rows.Close()

	keys := []gin.H{}
	for rows.Next() {
		var id, name, prefix string
		var scopes []string
		var budget *float64
		var quota *int
		var lastUsed, expiresAt, revokedAt *time.Time
		var createdAt time.Time
		var requests, failed, tokens int
		var cost float64
		if err := rows.Scan(&id, &name, &prefix, &scopes, &budget, &quota,
			&lastUsed, &expiresAt, &revokedAt, &createdAt,
			&requests, &cost, &tokens, &failed); err != nil {
			continue
		}
		burn := 0.0
		if budget != nil && *budget > 0 {
			burn = cost / *budget * 100
		}
		status := "active"
		if revokedAt != nil {
			status = "revoked"
		} else if expiresAt != nil && expiresAt.Before(time.Now()) {
			status = "expired"
		}
		keys = append(keys, gin.H{
			"id": id, "name": name, "key_prefix": prefix, "scopes": scopes,
			"budget_usd": budget, "monthly_quota": quota,
			"last_used_at": lastUsed, "expires_at": expiresAt, "revoked_at": revokedAt,
			"created_at": createdAt, "status": status,
			"requests": requests, "cost_usd": cost, "tokens": tokens, "failed": failed,
			"budget_burn_pct": burn,
		})
	}
	c.JSON(http.StatusOK, gin.H{"keys": keys})
}

// GET /governance/alerts?org_id=&limit=50
// Guardrail / ROE trip events + budget-breach + key-expiry warnings.
func (h *QueryHandler) GovernanceAlerts(c *gin.Context) {
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

	alerts := []gin.H{}

	// Guardrail trip events.
	rows, err := h.db.Query(ctx, `
		SELECT guardrail_id, action, detail, session_id, created_at
		FROM guardrail_events
		WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2`, orgID, limit)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var gid, action string
			var detail *string
			var sessionID *string
			var createdAt time.Time
			if err := rows.Scan(&gid, &action, &detail, &sessionID, &createdAt); err != nil {
				continue
			}
			severity := "warn"
			if action == "block" {
				severity = "critical"
			}
			d := ""
			if detail != nil {
				d = *detail
			}
			sid := ""
			if sessionID != nil {
				sid = *sessionID
			}
			alerts = append(alerts, gin.H{
				"type": "guardrail", "severity": severity,
				"title":  "Guardrail " + action + ": " + gid,
				"detail": d, "session_id": sid, "created_at": createdAt,
			})
		}
	}

	// Budget breaches.
	bRows, err := h.db.Query(ctx, `
		SELECT k.name, k.budget_usd, COALESCE(SUM(s.total_cost_usd), 0) AS spend
		FROM api_keys k
		JOIN sessions s ON s.api_key_id = k.id
		WHERE k.org_id = $1 AND k.budget_usd IS NOT NULL AND k.revoked_at IS NULL
		GROUP BY k.id, k.name, k.budget_usd
		HAVING COALESCE(SUM(s.total_cost_usd), 0) >= k.budget_usd * 0.8`, orgID)
	if err == nil {
		defer bRows.Close()
		for bRows.Next() {
			var name string
			var budget, spend float64
			if err := bRows.Scan(&name, &budget, &spend); err != nil {
				continue
			}
			severity := "warn"
			title := "Budget warning: " + name + " at 80%+"
			if spend >= budget {
				severity = "critical"
				title = "Budget exceeded: " + name
			}
			alerts = append(alerts, gin.H{
				"type": "budget", "severity": severity, "title": title,
				"detail":     "Spend $" + strconv.FormatFloat(spend, 'f', 4, 64) + " of $" + strconv.FormatFloat(budget, 'f', 2, 64),
				"created_at": time.Now().UTC(),
			})
		}
	}

	// Key expiry warnings (within 7 days).
	eRows, err := h.db.Query(ctx, `
		SELECT name, expires_at FROM api_keys
		WHERE org_id = $1 AND revoked_at IS NULL AND expires_at IS NOT NULL
		  AND expires_at BETWEEN now() AND now() + interval '7 days'`, orgID)
	if err == nil {
		defer eRows.Close()
		for eRows.Next() {
			var name string
			var expiresAt time.Time
			if err := eRows.Scan(&name, &expiresAt); err != nil {
				continue
			}
			alerts = append(alerts, gin.H{
				"type": "expiry", "severity": "warn",
				"title":      "Key expiring soon: " + name,
				"detail":     "Expires " + expiresAt.Format(time.RFC3339),
				"created_at": time.Now().UTC(),
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{"alerts": alerts, "count": len(alerts)})
}
