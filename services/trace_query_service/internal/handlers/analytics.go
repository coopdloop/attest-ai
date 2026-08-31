package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// GET /analytics/overview?org_id=&window=7d
// Headline KPIs for the Command Center dashboard.
func (h *QueryHandler) AnalyticsOverview(c *gin.Context) {
	orgID := c.Query("org_id")
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id required"})
		return
	}
	since := windowStart(c.DefaultQuery("window", "7d"))
	ctx := c.Request.Context()

	var (
		sessions, completed, failed, active int
		totalTokens                         int64
		totalCost                           float64
		avgLatency                          float64
	)
	err := h.db.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE status = 'completed'),
			COUNT(*) FILTER (WHERE status = 'failed'),
			COUNT(*) FILTER (WHERE status = 'active'),
			COALESCE(SUM(total_tokens), 0),
			COALESCE(SUM(total_cost_usd), 0),
			COALESCE(AVG(NULLIF(total_latency_ms, 0)), 0)
		FROM sessions
		WHERE org_id = $1 AND started_at >= $2`, orgID, since).
		Scan(&sessions, &completed, &failed, &active, &totalTokens, &totalCost, &avgLatency)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "overview query failed"})
		return
	}

	// Latency percentiles from turns (more granular than session rollups).
	var p50, p95 float64
	_ = h.db.QueryRow(ctx, `
		SELECT
			COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0),
			COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)
		FROM turns
		WHERE org_id = $1 AND started_at >= $2 AND latency_ms IS NOT NULL`, orgID, since).
		Scan(&p50, &p95)

	var distinctModels, activeKeys int
	_ = h.db.QueryRow(ctx,
		`SELECT COUNT(DISTINCT model_id) FROM sessions WHERE org_id = $1 AND started_at >= $2 AND model_id IS NOT NULL`,
		orgID, since).Scan(&distinctModels)
	_ = h.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM api_keys WHERE org_id = $1 AND revoked_at IS NULL`, orgID).Scan(&activeKeys)

	errorRate := 0.0
	if sessions > 0 {
		errorRate = float64(failed) / float64(sessions) * 100
	}

	c.JSON(http.StatusOK, gin.H{
		"window":          c.DefaultQuery("window", "7d"),
		"sessions":        sessions,
		"completed":       completed,
		"failed":          failed,
		"active":          active,
		"total_tokens":    totalTokens,
		"total_cost_usd":  totalCost,
		"avg_latency_ms":  avgLatency,
		"p50_latency_ms":  p50,
		"p95_latency_ms":  p95,
		"error_rate":      errorRate,
		"distinct_models": distinctModels,
		"active_keys":     activeKeys,
	})
}

// GET /analytics/timeseries?org_id=&window=7d&bucket=day
// Spend / tokens / requests bucketed over time for area + bar charts.
func (h *QueryHandler) AnalyticsTimeseries(c *gin.Context) {
	orgID := c.Query("org_id")
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id required"})
		return
	}
	window := c.DefaultQuery("window", "7d")
	since := windowStart(window)
	bucket := c.DefaultQuery("bucket", "")
	if bucket == "" {
		bucket = defaultBucket(window)
	}
	if bucket != "hour" && bucket != "day" {
		bucket = "day"
	}
	ctx := c.Request.Context()

	rows, err := h.db.Query(ctx, `
		SELECT
			date_trunc($3, started_at) AS ts,
			COUNT(*) AS requests,
			COUNT(*) FILTER (WHERE status = 'failed') AS failed,
			COALESCE(SUM(total_tokens), 0) AS tokens,
			COALESCE(SUM(total_cost_usd), 0) AS cost,
			COALESCE(AVG(NULLIF(total_latency_ms, 0)), 0) AS avg_latency
		FROM sessions
		WHERE org_id = $1 AND started_at >= $2
		GROUP BY ts ORDER BY ts ASC`, orgID, since, bucket)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "timeseries query failed"})
		return
	}
	defer rows.Close()

	points := []gin.H{}
	for rows.Next() {
		var ts time.Time
		var requests, failed int
		var tokens int64
		var cost, avgLatency float64
		if err := rows.Scan(&ts, &requests, &failed, &tokens, &cost, &avgLatency); err != nil {
			continue
		}
		points = append(points, gin.H{
			"ts":             ts,
			"requests":       requests,
			"failed":         failed,
			"tokens":         tokens,
			"cost_usd":       cost,
			"avg_latency_ms": avgLatency,
		})
	}
	c.JSON(http.StatusOK, gin.H{"bucket": bucket, "points": points})
}

// GET /analytics/by-model?org_id=&window=7d
// Model-mix breakdown — powers the donut chart and model leaderboard.
func (h *QueryHandler) AnalyticsByModel(c *gin.Context) {
	orgID := c.Query("org_id")
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id required"})
		return
	}
	since := windowStart(c.DefaultQuery("window", "7d"))
	ctx := c.Request.Context()

	rows, err := h.db.Query(ctx, `
		SELECT
			COALESCE(model_id, 'unknown') AS model,
			COUNT(*) AS requests,
			COALESCE(SUM(total_tokens), 0) AS tokens,
			COALESCE(SUM(total_cost_usd), 0) AS cost,
			COALESCE(AVG(NULLIF(total_latency_ms, 0)), 0) AS avg_latency,
			COUNT(*) FILTER (WHERE status = 'failed') AS failed
		FROM sessions
		WHERE org_id = $1 AND started_at >= $2
		GROUP BY model ORDER BY requests DESC`, orgID, since)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "by-model query failed"})
		return
	}
	defer rows.Close()

	models := []gin.H{}
	for rows.Next() {
		var model string
		var requests, failed int
		var tokens int64
		var cost, avgLatency float64
		if err := rows.Scan(&model, &requests, &tokens, &cost, &avgLatency, &failed); err != nil {
			continue
		}
		models = append(models, gin.H{
			"model":          model,
			"requests":       requests,
			"tokens":         tokens,
			"cost_usd":       cost,
			"avg_latency_ms": avgLatency,
			"failed":         failed,
		})
	}
	c.JSON(http.StatusOK, gin.H{"models": models})
}

// GET /analytics/recent?org_id=&limit=15
// Live request ticker — most recent sessions with their economics.
func (h *QueryHandler) AnalyticsRecent(c *gin.Context) {
	orgID := c.Query("org_id")
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id required"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "15"))
	if limit <= 0 || limit > 100 {
		limit = 15
	}
	ctx := c.Request.Context()

	rows, err := h.db.Query(ctx, `
		SELECT id, COALESCE(model_id, 'unknown'), mode, status,
		       total_tokens, total_cost_usd, total_latency_ms, started_at
		FROM sessions
		WHERE org_id = $1
		ORDER BY started_at DESC LIMIT $2`, orgID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "recent query failed"})
		return
	}
	defer rows.Close()

	items := []gin.H{}
	for rows.Next() {
		var id, model, mode, status string
		var tokens, latency int
		var cost float64
		var startedAt time.Time
		if err := rows.Scan(&id, &model, &mode, &status, &tokens, &cost, &latency, &startedAt); err != nil {
			continue
		}
		items = append(items, gin.H{
			"session_id": id, "model": model, "mode": mode, "status": status,
			"tokens": tokens, "cost_usd": cost, "latency_ms": latency, "started_at": startedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"sessions": items})
}

// windowStart converts a window token (24h, 7d, 30d, 90d) into a start time.
func windowStart(window string) time.Time {
	now := time.Now().UTC()
	switch window {
	case "24h", "1d":
		return now.Add(-24 * time.Hour)
	case "7d":
		return now.Add(-7 * 24 * time.Hour)
	case "30d":
		return now.Add(-30 * 24 * time.Hour)
	case "90d":
		return now.Add(-90 * 24 * time.Hour)
	case "all":
		return time.Unix(0, 0)
	default:
		return now.Add(-7 * 24 * time.Hour)
	}
}

func defaultBucket(window string) string {
	if window == "24h" || window == "1d" {
		return "hour"
	}
	return "day"
}
