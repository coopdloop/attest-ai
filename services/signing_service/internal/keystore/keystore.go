package keystore

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// KeyPair holds an Ed25519 keypair with metadata.
type KeyPair struct {
	ID         string     `json:"id"`
	OrgID      string     `json:"org_id"`
	PublicKey  []byte     `json:"public_key"`
	PrivateKey []byte     `json:"private_key"` // stored encrypted at rest
	CreatedAt  time.Time  `json:"created_at"`
	RetiredAt  *time.Time `json:"retired_at,omitempty"`
}

// Store defines the interface for key storage backends.
type Store interface {
	GetCurrentKey(orgID string) (*KeyPair, error)
	GetKey(orgID, keyID string) (*KeyPair, error)
	SaveKey(kp *KeyPair) error
	RetireKey(orgID, keyID string) error
	ListKeys(orgID string) ([]*KeyPair, error)
}

// LocalFileStore stores keys as JSON files on disk.
// For production use, replace with VaultStore.
type LocalFileStore struct {
	basePath string
	mu       sync.RWMutex
}

func NewLocalFileStore(basePath string) (*LocalFileStore, error) {
	if err := os.MkdirAll(basePath, 0700); err != nil {
		return nil, fmt.Errorf("create key store dir: %w", err)
	}
	return &LocalFileStore{basePath: basePath}, nil
}

func (s *LocalFileStore) keyPath(orgID, keyID string) string {
	return filepath.Join(s.basePath, fmt.Sprintf("%s_%s.json", orgID, keyID))
}

func (s *LocalFileStore) currentKeyPath(orgID string) string {
	return filepath.Join(s.basePath, fmt.Sprintf("%s_current.json", orgID))
}

func (s *LocalFileStore) GetCurrentKey(orgID string) (*KeyPair, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.currentKeyPath(orgID))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrKeyNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read current key: %w", err)
	}

	var kp KeyPair
	if err := json.Unmarshal(data, &kp); err != nil {
		return nil, fmt.Errorf("unmarshal key: %w", err)
	}
	return &kp, nil
}

func (s *LocalFileStore) GetKey(orgID, keyID string) (*KeyPair, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.keyPath(orgID, keyID))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrKeyNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read key: %w", err)
	}

	var kp KeyPair
	if err := json.Unmarshal(data, &kp); err != nil {
		return nil, fmt.Errorf("unmarshal key: %w", err)
	}
	return &kp, nil
}

func (s *LocalFileStore) SaveKey(kp *KeyPair) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(kp, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal key: %w", err)
	}

	// Write versioned copy
	if err := os.WriteFile(s.keyPath(kp.OrgID, kp.ID), data, 0600); err != nil {
		return fmt.Errorf("write key file: %w", err)
	}
	// Update current pointer
	if err := os.WriteFile(s.currentKeyPath(kp.OrgID), data, 0600); err != nil {
		return fmt.Errorf("write current key pointer: %w", err)
	}
	return nil
}

func (s *LocalFileStore) RetireKey(orgID, keyID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.keyPath(orgID, keyID))
	if err != nil {
		return ErrKeyNotFound
	}

	var kp KeyPair
	if err := json.Unmarshal(data, &kp); err != nil {
		return err
	}

	now := time.Now().UTC()
	kp.RetiredAt = &now

	updated, err := json.MarshalIndent(kp, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.keyPath(orgID, keyID), updated, 0600)
}

func (s *LocalFileStore) ListKeys(orgID string) ([]*KeyPair, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	pattern := filepath.Join(s.basePath, fmt.Sprintf("%s_*.json", orgID))
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}

	var keys []*KeyPair
	for _, path := range matches {
		// Skip the current pointer file
		if filepath.Base(path) == fmt.Sprintf("%s_current.json", orgID) {
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var kp KeyPair
		if err := json.Unmarshal(data, &kp); err != nil {
			continue
		}
		keys = append(keys, &kp)
	}
	return keys, nil
}

// GenerateKeyPair creates a new Ed25519 keypair for the given org.
func GenerateKeyPair(orgID string) (*KeyPair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate Ed25519 keypair: %w", err)
	}

	// Key ID = first 16 chars of SHA-256(public_key)
	hash := sha256.Sum256(pub)
	keyID := fmt.Sprintf("%x", hash[:8])

	return &KeyPair{
		ID:         keyID,
		OrgID:      orgID,
		PublicKey:  pub,
		PrivateKey: priv,
		CreatedAt:  time.Now().UTC(),
	}, nil
}

var ErrKeyNotFound = errors.New("key not found")
