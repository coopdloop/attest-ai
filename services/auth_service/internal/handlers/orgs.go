package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/attest-ai/auth_service/internal/db"
	"github.com/attest-ai/auth_service/internal/models"
)

type OrgHandler struct {
	db *db.DB
}

func NewOrgHandler(database *db.DB) *OrgHandler {
	return &OrgHandler{db: database}
}

// GET /orgs
func (h *OrgHandler) List(c *gin.Context) {
	rows, err := h.db.Pool.Query(c.Request.Context(),
		`SELECT id, name, slug, sso_config, created_at, updated_at FROM orgs ORDER BY name`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list orgs"})
		return
	}
	defer rows.Close()

	var orgs []models.Org
	for rows.Next() {
		var o models.Org
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.SSOConfig, &o.CreatedAt, &o.UpdatedAt); err != nil {
			continue
		}
		orgs = append(orgs, o)
	}
	c.JSON(http.StatusOK, orgs)
}

// POST /orgs
func (h *OrgHandler) Create(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id := uuid.New().String()
	slug := slugify(req.Name)
	_, err := h.db.Pool.Exec(c.Request.Context(),
		`INSERT INTO orgs (id, name, slug) VALUES ($1, $2, $3)`, id, req.Name, slug)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org name already taken"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "name": req.Name})
}

// GET /orgs/:org_id
func (h *OrgHandler) Get(c *gin.Context) {
	orgID := c.Param("org_id")
	var o models.Org
	err := h.db.Pool.QueryRow(c.Request.Context(),
		`SELECT id, name, slug, sso_config, created_at, updated_at FROM orgs WHERE id = $1`, orgID).
		Scan(&o.ID, &o.Name, &o.Slug, &o.SSOConfig, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "org not found"})
		return
	}
	c.JSON(http.StatusOK, o)
}

// PUT /orgs/:org_id
func (h *OrgHandler) Update(c *gin.Context) {
	orgID := c.Param("org_id")
	var req struct {
		Name      *string                `json:"name"`
		SSOConfig map[string]interface{} `json:"sso_config"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != nil {
		_, err := h.db.Pool.Exec(c.Request.Context(),
			`UPDATE orgs SET name = $1 WHERE id = $2`, *req.Name, orgID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"id": orgID, "name": req.Name})
}

// DELETE /orgs/:org_id
func (h *OrgHandler) Delete(c *gin.Context) {
	orgID := c.Param("org_id")
	tag, err := h.db.Pool.Exec(c.Request.Context(), `DELETE FROM orgs WHERE id = $1`, orgID)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "org not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// GET /orgs/:org_id/agent-registry-permissions
func (h *OrgHandler) GetAgentPermissions(c *gin.Context) {
	orgID := c.Param("org_id")
	rows, err := h.db.Pool.Query(c.Request.Context(),
		`SELECT agent_id, allowed_roles FROM agent_registry_permissions WHERE org_id = $1`, orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer rows.Close()

	perms := make([]map[string]interface{}, 0)
	for rows.Next() {
		var agentID string
		var roles []string
		if err := rows.Scan(&agentID, &roles); err != nil {
			continue
		}
		perms = append(perms, map[string]interface{}{"agent_id": agentID, "allowed_roles": roles})
	}
	c.JSON(http.StatusOK, perms)
}

// PUT /orgs/:org_id/agent-registry-permissions
func (h *OrgHandler) UpdateAgentPermissions(c *gin.Context) {
	orgID := c.Param("org_id")
	var req struct {
		AgentID      string   `json:"agent_id"`
		AllowedRoles []string `json:"allowed_roles"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err := h.db.Pool.Exec(c.Request.Context(), `
		INSERT INTO agent_registry_permissions (org_id, agent_id, allowed_roles)
		VALUES ($1, $2, $3)
		ON CONFLICT (org_id, agent_id) DO UPDATE SET allowed_roles = EXCLUDED.allowed_roles
	`, orgID, req.AgentID, req.AllowedRoles)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}
