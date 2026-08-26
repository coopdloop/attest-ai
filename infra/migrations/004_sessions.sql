-- 004_sessions.sql
-- Agent sessions — one session per human conversation or machine invoke

CREATE TYPE session_mode AS ENUM ('human', 'machine');
CREATE TYPE session_status AS ENUM ('active', 'completed', 'failed', 'aborted');

CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    api_key_id      UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    agent_id        UUID NOT NULL,              -- references agent_configs.id
    harness_id      UUID,                       -- references harnesses.id snapshot
    mode            session_mode NOT NULL DEFAULT 'human',
    status          session_status NOT NULL DEFAULT 'active',
    model_id        TEXT,                       -- LiteLLM model alias used
    attestation_id  UUID,                       -- set on completion; references attestation bundle
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_org_id ON sessions (org_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions (agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions (started_at DESC);
