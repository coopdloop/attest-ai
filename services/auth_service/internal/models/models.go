package models

import (
	"time"
)

type Org struct {
	ID        string                 `json:"id" db:"id"`
	Name      string                 `json:"name" db:"name"`
	Slug      string                 `json:"slug" db:"slug"`
	SSOConfig map[string]interface{} `json:"sso_config" db:"sso_config"`
	CreatedAt time.Time              `json:"created_at" db:"created_at"`
	UpdatedAt time.Time              `json:"updated_at" db:"updated_at"`
}

type UserRole string

const (
	RoleAdmin   UserRole = "admin"
	RoleMember  UserRole = "member"
	RoleViewer  UserRole = "viewer"
	RoleAuditor UserRole = "auditor"
)

type User struct {
	ID           string     `json:"id" db:"id"`
	OrgID        string     `json:"org_id" db:"org_id"`
	Email        string     `json:"email" db:"email"`
	PasswordHash *string    `json:"-" db:"password_hash"`
	Role         UserRole   `json:"role" db:"role"`
	OIDCSubject  *string    `json:"-" db:"oidc_subject"`
	SAMLNameID   *string    `json:"-" db:"saml_name_id"`
	IsActive     bool       `json:"is_active" db:"is_active"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty" db:"last_login_at"`
	CreatedAt    time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at" db:"updated_at"`
}

type Team struct {
	ID        string    `json:"id" db:"id"`
	OrgID     string    `json:"org_id" db:"org_id"`
	Name      string    `json:"name" db:"name"`
	Members   []string  `json:"members,omitempty"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type APIKey struct {
	ID         string     `json:"id" db:"id"`
	OrgID      string     `json:"org_id" db:"org_id"`
	CreatedBy  *string    `json:"created_by,omitempty" db:"created_by"`
	Name       string     `json:"name" db:"name"`
	KeyHash    string     `json:"-" db:"key_hash"`
	KeyPrefix  string     `json:"key_prefix" db:"key_prefix"`
	Scopes     []string   `json:"scopes" db:"scopes"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty" db:"last_used_at"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty" db:"expires_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty" db:"revoked_at"`
	CreatedAt  time.Time  `json:"created_at" db:"created_at"`
}

type TokenClaims struct {
	UserID string   `json:"user_id"`
	OrgID  string   `json:"org_id"`
	Roles  []string `json:"roles"`
}
