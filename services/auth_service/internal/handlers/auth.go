package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/attest-ai/auth_service/internal/auth"
	"github.com/attest-ai/auth_service/internal/db"
	"github.com/attest-ai/auth_service/internal/models"
)

type AuthHandler struct {
	db         *db.DB
	jwtService *auth.JWTService
	singleUser bool
}

func NewAuthHandler(database *db.DB, jwtSvc *auth.JWTService, singleUser bool) *AuthHandler {
	return &AuthHandler{db: database, jwtService: jwtSvc, singleUser: singleUser}
}

// POST /register
func (h *AuthHandler) Register(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required,min=8"`
		OrgName  string `json:"org_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()

	// Check email uniqueness before touching orgs
	var exists bool
	_ = h.db.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)`, req.Email).Scan(&exists)
	if exists {
		c.JSON(http.StatusBadRequest, gin.H{"error": "an account with that email already exists"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	orgID := uuid.New().String()
	userID := uuid.New().String()
	orgName := req.OrgName
	if orgName == "" {
		orgName = req.Email
	}
	// Append short UUID suffix to guarantee slug uniqueness
	orgSlug := slugify(orgName) + "-" + orgID[:8]

	tx, err := h.db.Pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin transaction"})
		return
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		INSERT INTO orgs (id, name, slug) VALUES ($1, $2, $3)
	`, orgID, orgName, orgSlug)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create workspace"})
		return
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO users (id, org_id, email, password_hash, role)
		VALUES ($1, $2, $3, $4, 'admin')
	`, userID, orgID, req.Email, string(hash))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "an account with that email already exists"})
		return
	}

	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"user_id": userID, "org_id": orgID})
}

// POST /login
func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	user, err := h.getUserByEmail(ctx, req.Email)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	if user.PasswordHash == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "SSO login required"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	claims := models.TokenClaims{
		UserID: user.ID,
		OrgID:  user.OrgID,
		Roles:  []string{string(user.Role)},
	}
	accessToken, err := h.jwtService.IssueAccessToken(claims)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}

	refreshToken, err := h.createRefreshToken(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create refresh token"})
		return
	}

	// Update last_login_at
	_, _ = h.db.Pool.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1`, user.ID)

	c.JSON(http.StatusOK, gin.H{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"expires_in":    int(15 * time.Minute / time.Second),
		"org_id":        user.OrgID,
		"user_id":       user.ID,
	})
}

// POST /tokens/refresh
func (h *AuthHandler) RefreshToken(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	userID, err := h.validateRefreshToken(ctx, req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}

	user, err := h.getUserByID(ctx, userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	claims := models.TokenClaims{
		UserID: user.ID,
		OrgID:  user.OrgID,
		Roles:  []string{string(user.Role)},
	}
	accessToken, err := h.jwtService.IssueAccessToken(claims)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token": accessToken,
		"expires_in":   int(15 * time.Minute / time.Second),
	})
}

// POST /tokens/introspect — used by other services to validate tokens or API keys
func (h *AuthHandler) IntrospectToken(c *gin.Context) {
	var req struct {
		Token string `json:"token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Try JWT first
	if claims, err := h.jwtService.ValidateToken(req.Token); err == nil {
		c.JSON(http.StatusOK, gin.H{
			"active":     true,
			"user_id":    claims.UserID,
			"org_id":     claims.OrgID,
			"roles":      claims.Roles,
			"token_type": "jwt",
		})
		return
	}

	// Fall back to API key (atai_ prefix)
	if strings.HasPrefix(req.Token, "atai_") {
		orgID, keyID, err := h.validateAPIKey(c.Request.Context(), req.Token)
		if err == nil {
			c.JSON(http.StatusOK, gin.H{
				"active":     true,
				"user_id":    keyID, // key ID stands in as the caller identity
				"org_id":     orgID,
				"roles":      []string{"member"},
				"token_type": "api_key",
			})
			return
		}
	}

	c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
}

// validateAPIKey looks up a raw atai_... key by prefix and bcrypt-verifies it.
func (h *AuthHandler) validateAPIKey(ctx context.Context, rawKey string) (orgID, keyID string, err error) {
	if len(rawKey) < 12 {
		return "", "", fmt.Errorf("key too short")
	}
	prefix := rawKey[:12]

	rows, err := h.db.Pool.Query(ctx,
		`SELECT id, org_id, key_hash FROM api_keys WHERE key_prefix = $1 AND revoked_at IS NULL`,
		prefix)
	if err != nil {
		return "", "", err
	}
	defer rows.Close()

	for rows.Next() {
		var id, oid, hash string
		if err := rows.Scan(&id, &oid, &hash); err != nil {
			continue
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(rawKey)) == nil {
			// Best-effort: update last_used_at
			_, _ = h.db.Pool.Exec(ctx, `UPDATE api_keys SET last_used_at = now() WHERE id = $1`, id)
			return oid, id, nil
		}
	}
	return "", "", fmt.Errorf("invalid api key")
}

// POST /sso/oidc/callback
func (h *AuthHandler) OIDCCallback(c *gin.Context) {
	// OIDC callback: exchange code for tokens, upsert user, issue attest-ai JWT
	// Full OIDC implementation requires coreid/oidc or go-oidc — stubbed for MVP
	c.JSON(http.StatusOK, gin.H{"error": "OIDC SSO not yet configured"})
}

// POST /sso/saml/acs
func (h *AuthHandler) SAMLCallback(c *gin.Context) {
	// SAML ACS: parse SAMLResponse, upsert user, issue attest-ai JWT
	// Full SAML requires crewjam/saml — stubbed for MVP
	c.JSON(http.StatusOK, gin.H{"error": "SAML SSO not yet configured"})
}

// ── helpers ──────────────────────────────────────────────────────────────────

func (h *AuthHandler) getUserByEmail(ctx context.Context, email string) (*models.User, error) {
	row := h.db.Pool.QueryRow(ctx, `
		SELECT id, org_id, email, password_hash, role, oidc_subject, saml_name_id,
		       is_active, last_login_at, created_at, updated_at
		FROM users WHERE email = $1 AND is_active = true
	`, email)

	var u models.User
	err := row.Scan(&u.ID, &u.OrgID, &u.Email, &u.PasswordHash, &u.Role,
		&u.OIDCSubject, &u.SAMLNameID, &u.IsActive, &u.LastLoginAt,
		&u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (h *AuthHandler) getUserByID(ctx context.Context, id string) (*models.User, error) {
	row := h.db.Pool.QueryRow(ctx, `
		SELECT id, org_id, email, password_hash, role, is_active, last_login_at, created_at, updated_at
		FROM users WHERE id = $1 AND is_active = true
	`, id)

	var u models.User
	err := row.Scan(&u.ID, &u.OrgID, &u.Email, &u.PasswordHash, &u.Role,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (h *AuthHandler) createRefreshToken(ctx context.Context, userID string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.URLEncoding.EncodeToString(raw)
	hash, err := bcrypt.GenerateFromPassword([]byte(token), bcrypt.MinCost)
	if err != nil {
		return "", err
	}
	_, err = h.db.Pool.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, userID, string(hash), time.Now().Add(7*24*time.Hour))
	if err != nil {
		return "", err
	}
	return token, nil
}

func (h *AuthHandler) validateRefreshToken(ctx context.Context, token string) (string, error) {
	// Look up all non-expired, non-revoked tokens and check hash
	rows, err := h.db.Pool.Query(ctx, `
		SELECT id, user_id, token_hash FROM refresh_tokens
		WHERE expires_at > now() AND revoked_at IS NULL
		LIMIT 100
	`)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	for rows.Next() {
		var id, userID, hash string
		if err := rows.Scan(&id, &userID, &hash); err != nil {
			continue
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(token)) == nil {
			// Mark as used (revoke single-use)
			_, _ = h.db.Pool.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, id)
			return userID, nil
		}
	}
	return "", fmt.Errorf("token not found or expired")
}

func slugify(s string) string {
	result := make([]byte, 0, len(s))
	for _, c := range s {
		if c >= 'a' && c <= 'z' || c >= '0' && c <= '9' {
			result = append(result, byte(c))
		} else if c >= 'A' && c <= 'Z' {
			result = append(result, byte(c+32))
		} else {
			result = append(result, '-')
		}
	}
	return string(result)
}
