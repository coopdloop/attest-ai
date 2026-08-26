package signer

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"time"

	"github.com/attest-ai/signing_service/internal/db"
	"github.com/attest-ai/signing_service/internal/keystore"
)

// Service handles signing operations using the key store.
type Service struct {
	store  keystore.Store
	auditDB *db.AuditDB
}

func New(store keystore.Store, auditDB *db.AuditDB) *Service {
	return &Service{store: store, auditDB: auditDB}
}

// EnsureOrgKey creates a keypair for the org if one doesn't exist yet.
func (s *Service) EnsureOrgKey(ctx context.Context, orgID string) error {
	_, err := s.store.GetCurrentKey(orgID)
	if err == keystore.ErrKeyNotFound {
		kp, err := keystore.GenerateKeyPair(orgID)
		if err != nil {
			return fmt.Errorf("generate key for org %s: %w", orgID, err)
		}
		return s.store.SaveKey(kp)
	}
	return err
}

// Sign signs the given digest using the org's current Ed25519 private key.
// Every signing operation is audit-logged to postgres.
func (s *Service) Sign(ctx context.Context, orgID, keyID, caller string, digest []byte) (string, []byte, error) {
	var kp *keystore.KeyPair
	var err error

	if keyID != "" {
		kp, err = s.store.GetKey(orgID, keyID)
	} else {
		kp, err = s.store.GetCurrentKey(orgID)
	}
	if err != nil {
		return "", nil, fmt.Errorf("get key for org %s: %w", orgID, err)
	}

	privKey := ed25519.PrivateKey(kp.PrivateKey)
	sig := ed25519.Sign(privKey, digest)

	// Audit log (non-blocking on failure — signing must succeed even if audit write fails)
	if s.auditDB != nil {
		_ = s.auditDB.LogSigningOp(ctx, db.SigningAuditEntry{
			OrgID:         orgID,
			KeyID:         kp.ID,
			Digest:        fmt.Sprintf("%x", digest),
			Signature:     fmt.Sprintf("%x", sig),
			CallerService: caller,
			SignedAt:      time.Now().UTC(),
		})
	}

	return kp.ID, sig, nil
}

// GetPublicKey returns the public key bytes for the given org.
func (s *Service) GetPublicKey(ctx context.Context, orgID, keyID string) (*keystore.KeyPair, error) {
	if keyID != "" {
		return s.store.GetKey(orgID, keyID)
	}
	return s.store.GetCurrentKey(orgID)
}

// RotateKey generates a new keypair and retires the old one.
func (s *Service) RotateKey(ctx context.Context, orgID, reason string) (newKeyID, oldKeyID string, err error) {
	old, err := s.store.GetCurrentKey(orgID)
	if err != nil && err != keystore.ErrKeyNotFound {
		return "", "", fmt.Errorf("get current key: %w", err)
	}

	newKP, err := keystore.GenerateKeyPair(orgID)
	if err != nil {
		return "", "", fmt.Errorf("generate new keypair: %w", err)
	}

	if err := s.store.SaveKey(newKP); err != nil {
		return "", "", fmt.Errorf("save new key: %w", err)
	}

	if old != nil {
		_ = s.store.RetireKey(orgID, old.ID)
		oldKeyID = old.ID
	}

	return newKP.ID, oldKeyID, nil
}
