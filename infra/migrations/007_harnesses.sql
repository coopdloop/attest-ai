-- 007_harnesses.sql
-- Harness definitions managed by context_library

CREATE TABLE IF NOT EXISTS harnesses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL,
    description     TEXT,
    version         TEXT NOT NULL DEFAULT '0.1.0',
    is_built_in     BOOLEAN NOT NULL DEFAULT false,
    git_sha         TEXT,                       -- git commit hash of config version
    config_path     TEXT NOT NULL,              -- path in git-versioned harness repo
    attestation_policy JSONB NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_harnesses_org_id ON harnesses (org_id);
CREATE INDEX IF NOT EXISTS idx_harnesses_slug ON harnesses (org_id, slug);
CREATE INDEX IF NOT EXISTS idx_harnesses_built_in ON harnesses (is_built_in);

CREATE TRIGGER harnesses_updated_at
    BEFORE UPDATE ON harnesses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
