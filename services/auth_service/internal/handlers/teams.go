package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/attest-ai/auth_service/internal/db"
	"github.com/attest-ai/auth_service/internal/models"
)

type TeamHandler struct {
	db *db.DB
}

func NewTeamHandler(database *db.DB) *TeamHandler {
	return &TeamHandler{db: database}
}

// GET /orgs/:org_id/teams
func (h *TeamHandler) List(c *gin.Context) {
	orgID := c.Param("org_id")
	rows, err := h.db.Pool.Query(c.Request.Context(),
		`SELECT id, name FROM teams WHERE org_id = $1 ORDER BY name`, orgID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed"})
		return
	}
	defer rows.Close()

	var teams []map[string]interface{}
	for rows.Next() {
		var t models.Team
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			continue
		}
		teams = append(teams, map[string]interface{}{"id": t.ID, "name": t.Name})
	}
	c.JSON(http.StatusOK, teams)
}

// POST /orgs/:org_id/teams
func (h *TeamHandler) Create(c *gin.Context) {
	orgID := c.Param("org_id")
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id := uuid.New().String()
	_, err := h.db.Pool.Exec(c.Request.Context(),
		`INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)`, id, orgID, req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "team name already taken in org"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "name": req.Name})
}

// GET /orgs/:org_id/teams/:team_id
func (h *TeamHandler) Get(c *gin.Context) {
	orgID, teamID := c.Param("org_id"), c.Param("team_id")
	var t models.Team
	err := h.db.Pool.QueryRow(c.Request.Context(),
		`SELECT id, name FROM teams WHERE id = $1 AND org_id = $2`, teamID, orgID).
		Scan(&t.ID, &t.Name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "team not found"})
		return
	}

	// Fetch members
	rows, _ := h.db.Pool.Query(c.Request.Context(),
		`SELECT user_id FROM team_members WHERE team_id = $1`, teamID)
	defer rows.Close()
	var members []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err == nil {
			members = append(members, uid)
		}
	}
	c.JSON(http.StatusOK, gin.H{"id": t.ID, "name": t.Name, "members": members})
}

// PUT /orgs/:org_id/teams/:team_id
func (h *TeamHandler) Update(c *gin.Context) {
	orgID, teamID := c.Param("org_id"), c.Param("team_id")
	var req struct {
		Name *string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name != nil {
		_, err := h.db.Pool.Exec(c.Request.Context(),
			`UPDATE teams SET name = $1 WHERE id = $2 AND org_id = $3`, *req.Name, teamID, orgID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "team not found"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"id": teamID, "name": req.Name})
}

// DELETE /orgs/:org_id/teams/:team_id
func (h *TeamHandler) Delete(c *gin.Context) {
	orgID, teamID := c.Param("org_id"), c.Param("team_id")
	tag, err := h.db.Pool.Exec(c.Request.Context(),
		`DELETE FROM teams WHERE id = $1 AND org_id = $2`, teamID, orgID)
	if err != nil || tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "team not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
