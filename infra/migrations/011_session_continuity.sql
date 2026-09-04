-- 011_session_continuity.sql
-- Link related /chat/completions calls into one continuous session.
--
-- Why: OpenAI-compatible clients (pi included) have no native conversation id
-- — they resend the full, growing message history on every call instead. The
-- orchestrator used to mint a brand-new session per HTTP call regardless, so
-- a single multi-step task fragmented into many disconnected single-turn
-- sessions, each with its own isolated attestation hash chain. Storing a hash
-- of each session's transcript after every turn lets the next call detect
-- "this message history is a continuation of session X" and append a turn
-- there instead of starting over.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS transcript_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_continuity
    ON sessions (org_id, agent_id, transcript_hash)
    WHERE transcript_hash IS NOT NULL;
