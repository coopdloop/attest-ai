-- 010_analytics.sql
-- Analytics + governance columns.
--
-- Why: per-turn cost/latency/model are computed by the orchestrator but were
-- never persisted, so spend and usage could not be aggregated. Adds queryable
-- columns for the Command Center dashboard and per-key budgets for the
-- Governance Console.

-- Per-turn economics (were previously streamed to the browser and discarded).
ALTER TABLE turns ADD COLUMN IF NOT EXISTS cost_usd    DOUBLE PRECISION;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS latency_ms  INTEGER;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS model_id    TEXT;

-- Denormalized model + economics onto sessions for fast dashboard grouping.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_cost_usd    DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_tokens      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_latency_ms  INTEGER NOT NULL DEFAULT 0;

-- Attribute machine sessions to the key that drove them (already nullable FK).
-- Governance: per-key spend budget + monthly request quota.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS budget_usd     DOUBLE PRECISION;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS monthly_quota  INTEGER;

-- Indexes for time-bucketed and grouped analytics queries.
CREATE INDEX IF NOT EXISTS idx_sessions_org_started ON sessions (org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_model       ON sessions (org_id, model_id);
CREATE INDEX IF NOT EXISTS idx_sessions_api_key     ON sessions (api_key_id) WHERE api_key_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_turns_org_completed  ON turns (org_id, completed_at DESC);

-- Guardrail / ROE trip events feed (Governance alerts). Populated by the
-- orchestrator when a harness guardrail blocks or warns.
CREATE TABLE IF NOT EXISTS guardrail_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    session_id   UUID REFERENCES sessions(id) ON DELETE SET NULL,
    api_key_id   UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    guardrail_id TEXT NOT NULL,
    action       TEXT NOT NULL,          -- block | warn | throttle | require | require_log
    detail       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardrail_events_org ON guardrail_events (org_id, created_at DESC);

-- Allow guardrail trips to also be recorded in the signed hash chain.
-- ADD VALUE IF NOT EXISTS is idempotent; wrapped so re-runs never error.
DO $$
BEGIN
    ALTER TYPE trace_event_type ADD VALUE IF NOT EXISTS 'policy_violation';
EXCEPTION WHEN others THEN
    NULL;
END $$;
