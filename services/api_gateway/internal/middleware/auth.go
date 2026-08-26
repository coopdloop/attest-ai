package middleware

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type AuthMiddleware struct {
	authServiceURL string
}

func NewAuth(authServiceURL string) *AuthMiddleware {
	return &AuthMiddleware{authServiceURL: authServiceURL}
}

// RequireAuth validates the Bearer token or API key against auth_service.
func (a *AuthMiddleware) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authorization required"})
			return
		}

		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization header"})
			return
		}

		token := parts[1]
		claims, err := a.introspect(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}

		c.Set("user_id", claims["user_id"])
		c.Set("org_id", claims["org_id"])
		c.Set("roles", claims["roles"])
		c.Next()
	}
}

func (a *AuthMiddleware) introspect(token string) (map[string]interface{}, error) {
	body, _ := json.Marshal(map[string]string{"token": token})
	resp, err := http.Post(
		fmt.Sprintf("%s/tokens/introspect", a.authServiceURL),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("auth_service unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token rejected: %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var claims map[string]interface{}
	if err := json.Unmarshal(data, &claims); err != nil {
		return nil, err
	}
	if active, ok := claims["active"].(bool); !ok || !active {
		return nil, fmt.Errorf("token inactive")
	}
	return claims, nil
}
