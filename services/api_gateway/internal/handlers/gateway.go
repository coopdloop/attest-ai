package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/attest-ai/api_gateway/internal/ratelimit"
)

type GatewayHandler struct {
	orchestratorURL    string
	attestationURL     string
	limiter            *ratelimit.Limiter
}

func New(orchestratorURL, attestationURL string, limiter *ratelimit.Limiter) *GatewayHandler {
	return &GatewayHandler{
		orchestratorURL:    orchestratorURL,
		attestationURL:     attestationURL,
		limiter:            limiter,
	}
}

// POST /v1/chat/completions — OpenAI-compatible endpoint, proxied to orchestrator.
func (h *GatewayHandler) ChatCompletions(c *gin.Context) {
	orgID, _ := c.Get("org_id")

	// Rate limit check
	if h.limiter != nil {
		remaining, resetAt, allowed := h.limiter.Check(c.Request.Context(), fmt.Sprintf("org:%v", orgID), 100)
		c.Header("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
		c.Header("X-RateLimit-Reset", fmt.Sprintf("%d", resetAt.Unix()))
		if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded"})
			return
		}
	}

	var reqBody map[string]interface{}
	if err := c.ShouldBindJSON(&reqBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	stream, _ := reqBody["stream"].(bool)

	userID, _ := c.Get("user_id")
	body, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(c.Request.Context(), "POST",
		fmt.Sprintf("%s/chat/completions", h.orchestratorURL), bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build orchestrator request"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Org-Id", fmt.Sprintf("%v", orgID))
	req.Header.Set("X-User-Id", fmt.Sprintf("%v", userID))

	if stream {
		h.proxySSE(c, req)
		return
	}

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "orchestrator unavailable"})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json", respBody)
}

// POST /v1/agents/:id/invoke — attested agent invocation
func (h *GatewayHandler) InvokeAgent(c *gin.Context) {
	agentID := c.Param("id")
	orgID, _ := c.Get("org_id")

	// Rate limit check
	if h.limiter != nil {
		_, _, allowed := h.limiter.Check(c.Request.Context(), fmt.Sprintf("org:%v", orgID), 50)
		if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded"})
			return
		}
	}

	var reqBody struct {
		Input           string                 `json:"input" binding:"required"`
		ContextOverrides map[string]interface{} `json:"context_overrides"`
		Stream          bool                   `json:"stream"`
	}
	if err := c.ShouldBindJSON(&reqBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 1. Create session
	sessionPayload, _ := json.Marshal(map[string]interface{}{
		"agent_id": agentID,
		"mode":     "machine",
		"org_id":   orgID,
	})
	sessionResp, err := http.Post(
		fmt.Sprintf("%s/sessions", h.orchestratorURL),
		"application/json",
		bytes.NewReader(sessionPayload),
	)
	if err != nil || sessionResp.StatusCode != http.StatusCreated {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to create agent session"})
		return
	}
	defer sessionResp.Body.Close()

	var sessionData map[string]interface{}
	json.NewDecoder(sessionResp.Body).Decode(&sessionData)
	sessionID, _ := sessionData["session_id"].(string)
	if sessionID == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "no session_id returned"})
		return
	}

	// 2. Submit turn
	turnPayload, _ := json.Marshal(map[string]interface{}{"message": reqBody.Input})
	turnResp, err := http.Post(
		fmt.Sprintf("%s/sessions/%s/turns", h.orchestratorURL, sessionID),
		"application/json",
		bytes.NewReader(turnPayload),
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to invoke agent"})
		return
	}
	defer turnResp.Body.Close()

	var turnData map[string]interface{}
	json.NewDecoder(turnResp.Body).Decode(&turnData)

	// 3. Fetch attestation bundle
	bundleResp, err := http.Get(
		fmt.Sprintf("%s/sessions/%s/bundle", h.attestationURL, sessionID),
	)
	var bundle interface{}
	if err == nil && bundleResp.StatusCode == http.StatusOK {
		defer bundleResp.Body.Close()
		json.NewDecoder(bundleResp.Body).Decode(&bundle)
	}

	c.JSON(http.StatusOK, gin.H{
		"completion":         turnData,
		"attestation_bundle": bundle,
	})
}

// GET /v1/models — proxy OpenRouter model catalog, keyed for this gateway.
func (h *GatewayHandler) ListModels(c *gin.Context) {
	req, err := http.NewRequestWithContext(c.Request.Context(), "GET",
		fmt.Sprintf("%s/models", h.orchestratorURL), nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build request"})
		return
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "orchestrator unavailable"})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json", body)
}

// GET /v1/agents — list available agents, proxied to orchestrator.
func (h *GatewayHandler) ListAgents(c *gin.Context) {
	req, err := http.NewRequestWithContext(c.Request.Context(), "GET",
		fmt.Sprintf("%s/agents", h.orchestratorURL), nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build request"})
		return
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "orchestrator unavailable"})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, "application/json", body)
}

// GET /v1/rate-limits — current rate limit status for caller
func (h *GatewayHandler) RateLimits(c *gin.Context) {
	orgID, _ := c.Get("org_id")
	limit, remaining, resetAt := h.limiter.Status(
		c.Request.Context(), fmt.Sprintf("org:%v", orgID), 100)
	c.JSON(http.StatusOK, gin.H{
		"limit":     limit,
		"remaining": remaining,
		"reset_at":  resetAt.Format(time.RFC3339),
	})
}

// proxySSE proxies a streaming response as Server-Sent Events.
func (h *GatewayHandler) proxySSE(c *gin.Context, req *http.Request) {
	// No overall timeout for SSE — the model controls when it finishes.
	// Keep a transport-level dial timeout only.
	client := &http.Client{
		Timeout: 0,
		Transport: &http.Transport{
			DialContext:           (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
			ResponseHeaderTimeout: 30 * time.Second,
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream unavailable"})
		return
	}
	defer resp.Body.Close()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			c.Writer.Write(buf[:n])
			c.Writer.Flush()
		}
		if err != nil {
			break
		}
	}
}
