-- 006_hash_chain.sql
-- Attestation: hash chain entries, bundles, and signing audit log

CREATE TYPE trace_event_type AS ENUM (
    'reasoning_step',
    'tool_call',
    'tool_response',
    'model_swap',
    'retry',
    'completion',
    'error'
);

-- One row per trace event appended to the chain
CREATE TABLE IF NOT EXISTS hash_chain_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    seq             BIGINT NOT NULL,            -- monotonically increasing within session
    event_type      trace_event_type NOT NULL,
    payload_hash    TEXT NOT NULL,              -- SHA-256 of event payload JSON
    chain_hash      TEXT NOT NULL,              -- SHA-256(prev_chain_hash || payload_hash)
    prev_hash       TEXT NOT NULL,              -- chain_hash of (seq-1), "genesis" for seq=0
    blob_key        TEXT,                       -- MinIO object key for full payload blob
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_hash_chain_session_id ON hash_chain_entries (session_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_hash_chain_org_id ON hash_chain_entries (org_id);

-- Completed attestation bundles (one per session)
CREATE TABLE IF NOT EXISTS attestation_bundles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    root_hash       TEXT NOT NULL,              -- final chain_hash of last entry
    event_count     INTEGER NOT NULL,
    model_id        TEXT,
    policy_version  TEXT,
    signature       TEXT NOT NULL,              -- Ed25519 signature of root_hash (base64)
    signing_key_id  TEXT NOT NULL,              -- key ID used for signature
    rekor_log_id    TEXT,                       -- Sigstore Rekor entry ID (if anchored)
    bundle_blob_key TEXT NOT NULL,              -- MinIO key for the full bundle JSON
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attestation_bundles_org_id ON attestation_bundles (org_id);
CREATE INDEX IF NOT EXISTS idx_attestation_bundles_session_id ON attestation_bundles (session_id);

-- Every signing operation is audit-logged (in signing_service)
CREATE TABLE IF NOT EXISTS signing_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID,                       -- may be null if org lookup fails
    key_id          TEXT NOT NULL,
    digest          TEXT NOT NULL,              -- the payload that was signed
    signature       TEXT NOT NULL,
    caller_service  TEXT NOT NULL,              -- e.g. "attestation_service"
    signed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signing_audit_log_org_id ON signing_audit_log (org_id);
CREATE INDEX IF NOT EXISTS idx_signing_audit_log_key_id ON signing_audit_log (key_id);
CREATE INDEX IF NOT EXISTS idx_signing_audit_log_signed_at ON signing_audit_log (signed_at DESC);
