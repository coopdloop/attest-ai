package chain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// EventType enumerates all trace event types.
type EventType string

const (
	EventReasoningStep EventType = "reasoning_step"
	EventToolCall      EventType = "tool_call"
	EventToolResponse  EventType = "tool_response"
	EventModelSwap     EventType = "model_swap"
	EventRetry         EventType = "retry"
	EventCompletion    EventType = "completion"
	EventError         EventType = "error"
)

const genesisHash = "0000000000000000000000000000000000000000000000000000000000000000"

// TraceEvent is the envelope received from the orchestrator.
type TraceEvent struct {
	SessionID string          `json:"session_id"`
	OrgID     string          `json:"org_id"`
	EventType EventType       `json:"event_type"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp time.Time       `json:"timestamp"`
}

// ChainEntry is a single link in the hash chain, stored to postgres + MinIO.
type ChainEntry struct {
	ID          string    `json:"id"`
	SessionID   string    `json:"session_id"`
	OrgID       string    `json:"org_id"`
	Seq         int64     `json:"seq"`
	EventType   EventType `json:"event_type"`
	PayloadHash string    `json:"payload_hash"`
	ChainHash   string    `json:"chain_hash"`
	PrevHash    string    `json:"prev_hash"`
	BlobKey     string    `json:"blob_key,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// AttestationBundle is the final signed bundle for a completed session.
type AttestationBundle struct {
	SessionID     string    `json:"session_id"`
	OrgID         string    `json:"org_id"`
	RootHash      string    `json:"root_hash"`
	EventCount    int       `json:"event_count"`
	ModelID       string    `json:"model_id,omitempty"`
	PolicyVersion string    `json:"policy_version,omitempty"`
	Signature     string    `json:"signature"`
	SigningKeyID  string    `json:"signing_key_id"`
	RekorLogID    string    `json:"rekor_log_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// HashPayload returns SHA-256 of the JSON-serialised payload.
func HashPayload(payload json.RawMessage) string {
	h := sha256.Sum256(payload)
	return hex.EncodeToString(h[:])
}

// HashChain computes the Merkle-style chain hash: SHA-256(prevHash || payloadHash).
func HashChain(prevHash, payloadHash string) string {
	combined := fmt.Sprintf("%s%s", prevHash, payloadHash)
	h := sha256.Sum256([]byte(combined))
	return hex.EncodeToString(h[:])
}

// GenesisHash returns the sentinel prev_hash used for the first event in a session.
func GenesisHash() string {
	return genesisHash
}

// VerifyChain validates the entire chain of entries for integrity.
// Returns the index of the first tampered entry, or -1 if valid.
func VerifyChain(entries []ChainEntry) int {
	prevHash := genesisHash
	for i, e := range entries {
		expectedChain := HashChain(prevHash, e.PayloadHash)
		if e.ChainHash != expectedChain {
			return i
		}
		if i > 0 && e.PrevHash != entries[i-1].ChainHash {
			return i
		}
		prevHash = e.ChainHash
	}
	return -1
}
