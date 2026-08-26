package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/attest-ai/auth_service/internal/db"
	"github.com/attest-ai/auth_service/internal/models"
)

type UserHandler struct {
	db *db.DB
}

func NewUserHandler(database *db.DB) *UserHandler {
	return &UserHandler{db: database}
}

// GET /orgs/:org_id/users
func (h *UserHandler) List(c *gin.Context) {
	orgID := c.Param("org_id")
	rows, err := h.db.Pool.Query(c.Request.Context(),
		`SELECT id, email, role, is_active, last_login_at, created_at FROM users
		 WHERE org_id = $1 ORDER BY email`, orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer rows.Close()

	var users []map[string]interface{}
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Email, &u.Role, &u.IsActive, &u.LastLoginAt, &u.CreatedAt); err != nil {
			continue
		}
		users = append(users, map[string]interface{}{
			"id": u.ID, "email": u.Email, "role": u.Role,
			"is_active": u.IsActive, "last_login_at": u.LastLoginAt,
		})
	}
	c.JSON(http.StatusOK, users)
}

// POST /orgs/:org_id/users
func (h *UserHandler) Create(c *gin.Context) {
	orgID := c.Param("org_id")
	var req struct {
		Email string `json:"email" binding:"required,email"`
		Role  string `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate a temporary password — user should reset on first login
	tmpPass := make([]byte, 16)
	uuid.New().ID() // consume entropy
	hash, _ := bcrypt.GenerateFromPassword(tmpPass, bcrypt.DefaultCost)

	id := uuid.New().String()
	_, err := h.db.Pool.Exec(c.Request.Context(),
		`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)`,
		id, orgID, req.Email, string(hash), req.Role)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email already exists in org"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "email": req.Email})
}

// GET /orgs/:org_id/users/:user_id
func (h *UserHandler) Get(c *gin.Context) {
	orgID, userID := c.Param("org_id"), c.Param("user_id")
	var u models.User
	err := h.db.Pool.QueryRow(c.Request.Context(),
		`SELECT id, email, role, is_active FROM users WHERE id = $1 AND org_id = $2`, userID, orgID).
		Scan(&u.ID, &u.Email, &u.Role, &u.IsActive)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": u.ID, "email": u.Email, "role": u.Role})
}

// PUT /orgs/:org_id/users/:user_id
func (h *UserHandler) Update(c *gin.Context) {
	orgID, userID := c.Param("org_id"), c.Param("user_id")
	var req struct {
		Role   *string `json:"role"`
		TeamID *string `json:"team_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Role != nil {
		_, err := h.db.Pool.Exec(c.Request.Context(),
			`UPDATE users SET role = $1 WHERE id = $2 AND org_id = $3`, *req.Role, userID, orgID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
	}
	if req.TeamID != nil {
		_, _ = h.db.Pool.Exec(c.Request.Context(),
			`INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			*req.TeamID, userID)
	}
	c.JSON(http.StatusOK, gin.H{"id": userID, "role": req.Role})
}

// DELETE /orgs/:org_id/users/:user_id
func (h *UserHandler) Delete(c *gin.Context) {
	orgID, userID := c.Param("org_id"), c.Param("user_id")
	tag, err := h.db.Pool.Exec(c.Request.Context(),
		`UPDATE users SET is_active = false WHERE id = $1 AND org_id = $2`, userID, orgID)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
