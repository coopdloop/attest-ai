package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/attest-ai/auth_service/internal/db"
)

type APIKeyHandler struct {
	db *db.DB
}

func NewAPIKeyHandler(database *db.DB) *APIKeyHandler {
	return &APIKeyHandler{db: database}
}

// GET /orgs/:org_id/api-keys
func (h *APIKeyHandler) List(c *gin.Context) {
	orgID := c.Param("org_id")
	rows, err := h.db.Pool.Query(c.Request.Context(),
		`SELECT id, name, key_prefix, scopes, last_used_at, created_at
		 FROM api_keys WHERE org_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`, orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer rows.Close()

	var keys []map[string]interface{}
	for rows.Next() {
		var id, name, prefix string
		var scopes []string
		var lastUsed, createdAt interface{}
		if err := rows.Scan(&id, &name, &prefix, &scopes, &lastUsed, &createdAt); err != nil {
			continue
		}
		keys = append(keys, map[string]interface{}{
			"id": id, "name": name, "key_prefix": prefix,
			"scopes": scopes, "last_used_at": lastUsed, "created_at": createdAt,
		})
	}
	c.JSON(http.StatusOK, keys)
}

// POST /orgs/:org_id/api-keys
func (h *APIKeyHandler) Create(c *gin.Context) {
	orgID := c.Param("org_id")
	var req struct {
		Name   string   `json:"name" binding:"required"`
		Scopes []string `json:"scopes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate raw key: atai_<base64url(32 random bytes)>
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate key"})
		return
	}
	rawKey := fmt.Sprintf("atai_%s", base64.URLEncoding.EncodeToString(raw))
	prefix := rawKey[:12] // "atai_" + first 7 chars

	hash, err := bcrypt.GenerateFromPassword([]byte(rawKey), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash key"})
		return
	}

	id := uuid.New().String()
	_, err = h.db.Pool.Exec(c.Request.Context(),
		`INSERT INTO api_keys (id, org_id, name, key_hash, key_prefix, scopes)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		id, orgID, req.Name, string(hash), prefix, req.Scopes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to create key"})
		return
	}

	// Raw key is shown once and never stored
	c.JSON(http.StatusCreated, gin.H{"id": id, "key": rawKey})
}

// DELETE /orgs/:org_id/api-keys/:key_id
func (h *APIKeyHandler) Revoke(c *gin.Context) {
	orgID, keyID := c.Param("org_id"), c.Param("key_id")
	tag, err := h.db.Pool.Exec(c.Request.Context(),
		`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL`,
		keyID, orgID)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "key not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"revoked": true})
}
