-- 005_turns.sql
-- Session turns — each human message + agent response cycle

CREATE TYPE turn_status AS ENUM ('pending', 'streaming', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS turns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    turn_index      INTEGER NOT NULL,           -- 0-based turn number within session
    user_message    TEXT NOT NULL,
    agent_response  TEXT,
    status          turn_status NOT NULL DEFAULT 'pending',
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}',
    UNIQUE (session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns (session_id);
CREATE INDEX IF NOT EXISTS idx_turns_org_id ON turns (org_id);
