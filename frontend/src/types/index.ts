// Core domain types matching attest-ai API schemas

export interface MessageMeta {
  session_id: string
  model: string
  latency_ms: number
  cost_usd: number | null
  iterations: number
  attestation_ids: string[]
  reasoning: string | null
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  attestation_bundle?: AttestationBundle
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_call_id?: string
  name?: string
  meta?: MessageMeta
}

export interface Session {
  session_id: string
  agent_id: string
  mode: 'human' | 'machine'
  status: 'active' | 'completed' | 'failed' | 'aborted'
  started_at: string
  completed_at?: string
  attestation_id?: string
}

export interface TraceEvent {
  id: string
  seq: number
  event_type: TraceEventType
  payload_hash: string
  chain_hash: string
  prev_hash: string
  created_at: string
  payload?: Record<string, unknown>
}

export type TraceEventType =
  | 'reasoning_step'
  | 'tool_call'
  | 'tool_response'
  | 'model_swap'
  | 'retry'
  | 'completion'
  | 'error'
  | 'policy_violation'

export interface AttestationBundle {
  session_id: string
  org_id: string
  root_hash: string
  event_count: number
  model_id?: string
  policy_version?: string
  signature: string
  signing_key_id: string
  rekor_log_id?: string
  created_at: string
  signature_valid?: boolean
}

export interface Agent {
  id: string
  name: string
  description?: string
  harness_slug?: string
  default_model: string
}

export interface HarnessDefinition {
  name: string
  slug: string
  description?: string
  version: string
  is_built_in: boolean
  system_context: string
  roe_scope: Record<string, unknown>
  guardrails: Guardrail[]
  tool_bindings: ToolBinding[]
  model_bindings: ModelBinding
  attestation_policy: AttestationPolicy
}

export interface Guardrail {
  id: string
  description: string
  action: 'block' | 'warn' | 'throttle' | 'require' | 'require_log'
}

export interface ToolBinding {
  server: string
  tools: string[]
}

export interface ModelBinding {
  primary: string
  fallback?: string
}

export interface AttestationPolicy {
  sign_fields: string[]
  retain_fields: string[]
  redact_fields: string[]
}

export interface User {
  id: string
  email: string
  role: 'admin' | 'member' | 'viewer' | 'auditor'
}

export interface Org {
  id: string
  name: string
  slug: string
  sso_config: Record<string, unknown>
}
