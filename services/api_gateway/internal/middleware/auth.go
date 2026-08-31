package middleware

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// cachedClaims holds an introspection result and its expiry.
type cachedClaims struct {
	claims    map[string]interface{}
	expiresAt time.Time
}

type AuthMiddleware struct {
	authServiceURL string
	httpClient     *http.Client
	mu             sync.RWMutex
	cache          map[string]cachedClaims
	cacheTTL       time.Duration
}

func NewAuth(authServiceURL string) *AuthMiddleware {
	return &AuthMiddleware{
		authServiceURL: authServiceURL,
		httpClient:     &http.Client{Timeout: 10 * time.Second},
		cache:          make(map[string]cachedClaims),
		cacheTTL:       30 * time.Second,
	}
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
		c.Set("token_type", claims["token_type"])
		c.Next()
	}
}

func (a *AuthMiddleware) introspect(token string) (map[string]interface{}, error) {
	cacheKey := hashToken(token)
	a.mu.RLock()
	if entry, ok := a.cache[cacheKey]; ok && time.Now().Before(entry.expiresAt) {
		a.mu.RUnlock()
		return entry.claims, nil
	}
	a.mu.RUnlock()

	body, _ := json.Marshal(map[string]string{"token": token})
	resp, err := a.httpClient.Post(
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

	a.mu.Lock()
	a.cache[cacheKey] = cachedClaims{claims: claims, expiresAt: time.Now().Add(a.cacheTTL)}
	a.mu.Unlock()

	return claims, nil
}

// hashToken derives a stable cache key without storing the raw secret.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
