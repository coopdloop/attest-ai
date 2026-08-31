-- 009_seed.sql
-- Seed a default org, a built-in "general" harness, and one default agent.
--
-- Why: POST /v1/chat/completions (agent_orchestrator/app/routers/chat.py) maps
-- every request to a row in agent_configs. It matches on default_model, then
-- falls back to the FIRST agent row when nothing matches. The model actually
-- sent upstream is still the caller's req.model, so a single default agent makes
-- ALL OpenRouter models in the /v1/models catalog usable — no row per model.
--
-- Idempotent: safe to re-run and safe on an already-populated DB.

-- Fixed UUIDs so re-runs and cross-service references stay stable.
INSERT INTO orgs (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'default', 'default')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO harnesses (id, org_id, name, slug, description, is_built_in, config_path)
VALUES (
    '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000a1',
    'General',
    'general',
    'Default general-purpose harness (no tools).',
    true,
    'harnesses/general'
)
ON CONFLICT (org_id, slug) DO NOTHING;

INSERT INTO agent_configs (id, org_id, name, description, harness_id, default_model)
VALUES (
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000a1',
    'default',
    'Fallback agent: routes any selected model through the general harness.',
    '00000000-0000-0000-0000-0000000000b1',
    'openrouter/nvidia/nemotron-3-super-120b-a12b:free'
)
ON CONFLICT (org_id, name) DO NOTHING;
