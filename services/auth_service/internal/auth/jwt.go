package auth

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/attest-ai/auth_service/internal/models"
)

const (
	accessTokenTTL  = 15 * time.Minute
	refreshTokenTTL = 7 * 24 * time.Hour
)

type JWTService struct {
	privateKey *rsa.PrivateKey
	publicKey  *rsa.PublicKey
}

type attestClaims struct {
	jwt.RegisteredClaims
	UserID string   `json:"user_id"`
	OrgID  string   `json:"org_id"`
	Roles  []string `json:"roles"`
}

func NewJWTService(privateKeyPath string) (*JWTService, error) {
	privData, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("read private key: %w", err)
	}
	privKey, err := jwt.ParseRSAPrivateKeyFromPEM(privData)
	if err != nil {
		return nil, fmt.Errorf("parse RSA private key: %w", err)
	}
	return &JWTService{
		privateKey: privKey,
		publicKey:  &privKey.PublicKey,
	}, nil
}

func (j *JWTService) IssueAccessToken(claims models.TokenClaims) (string, error) {
	now := time.Now()
	c := attestClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(accessTokenTTL)),
			Issuer:    "attest-ai/auth_service",
		},
		UserID: claims.UserID,
		OrgID:  claims.OrgID,
		Roles:  claims.Roles,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
	return token.SignedString(j.privateKey)
}

func (j *JWTService) ValidateToken(tokenStr string) (*models.TokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &attestClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return j.publicKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	c, ok := token.Claims.(*attestClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	return &models.TokenClaims{
		UserID: c.UserID,
		OrgID:  c.OrgID,
		Roles:  c.Roles,
	}, nil
}

func (j *JWTService) PublicKeyPEM() ([]byte, error) {
	der, err := x509.MarshalPKIXPublicKey(j.publicKey)
	if err != nil {
		return nil, fmt.Errorf("marshal public key: %w", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}), nil
}
