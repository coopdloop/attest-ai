-- 008_agent_configs.sql
-- Agent registry: named agent configurations exposed via the gateway

CREATE TABLE IF NOT EXISTS agent_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    harness_id      UUID REFERENCES harnesses(id) ON DELETE SET NULL,
    default_model   TEXT NOT NULL,              -- LiteLLM model alias
    allowed_roles   TEXT[] NOT NULL DEFAULT '{}',   -- empty = all org roles
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_org_id ON agent_configs (org_id);
CREATE INDEX IF NOT EXISTS idx_agent_configs_harness_id ON agent_configs (harness_id);

-- Per-org agent registry permissions (from auth_service spec)
CREATE TABLE IF NOT EXISTS agent_registry_permissions (
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    agent_id    UUID NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
    allowed_roles TEXT[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (org_id, agent_id)
);

CREATE TRIGGER agent_configs_updated_at
    BEFORE UPDATE ON agent_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
