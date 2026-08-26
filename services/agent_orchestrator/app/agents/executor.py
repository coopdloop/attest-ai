"""
AgentExecutor — runs a harness-defined agent using LiteLLM + MCP tools.

The execution loop:
  1. Load harness from context_library
  2. Build system prompt from harness.system_context
  3. Run LangGraph ReAct loop (reason → select tool → call tool → reason again)
  4. Emit a TraceEvent to attestation_service after EVERY step
  5. Return final completion + list of attestation entry IDs
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any, AsyncGenerator, AsyncIterator

import os
import httpx
import litellm

from app.mcp.client import MCPClient
from app.models.session import TraceEvent


class AgentExecutor:
    def __init__(
        self,
        attestation_url: str,
        context_library_url: str,
        mcp_client: MCPClient,
        litellm_config_path: str,
    ) -> None:
        self._attestation_url = attestation_url
        self._context_library_url = context_library_url
        self._mcp = mcp_client
        litellm.drop_params = True
        self._openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
        self._router = None  # Reserved for future Router use

    async def run(
        self,
        session_id: str,
        org_id: str,
        agent_id: str,
        harness_slug: str,
        model: str,
        messages: list[dict[str, str]],
        max_iterations: int = 10,
    ) -> tuple[str, list[str], dict]:
        """
        Execute the agent loop.
        Returns (final_response_text, attestation_entry_ids, meta).
        meta includes: usage, cost_usd, latency_ms, model, reasoning.
        """
        import time as _time
        run_start = _time.monotonic()

        # Fetch harness definition
        harness = await self._fetch_harness(org_id, harness_slug)
        system_context = harness.get("definition", {}).get("system_context", "")
        tool_bindings = harness.get("definition", {}).get("tool_bindings", [])

        tools = self._build_tool_definitions(tool_bindings)
        full_messages = [{"role": "system", "content": system_context}] + list(messages) if system_context else list(messages)

        attestation_ids: list[str] = []
        iteration = 0
        meta: dict = {"usage": {}, "cost_usd": None, "latency_ms": 0, "model": model, "reasoning": None, "iterations": 0}

        while iteration < max_iterations:
            iteration += 1
            meta["iterations"] = iteration

            await self._emit_trace(session_id, org_id, "reasoning_step", {
                "iteration": iteration,
                "message_count": len(full_messages),
            }, attestation_ids)

            llm_start = _time.monotonic()
            try:
                kwargs: dict = dict(
                    model=model,
                    messages=full_messages,
                    tools=tools if tools else None,
                    tool_choice="auto" if tools else None,
                )
                if model.startswith("openrouter/") and self._openrouter_key:
                    kwargs["api_key"] = self._openrouter_key
                    kwargs["api_base"] = "https://openrouter.ai/api/v1"
                response = await litellm.acompletion(**kwargs)
            except Exception as e:
                await self._emit_trace(session_id, org_id, "error", {"error": str(e)}, attestation_ids)
                meta["latency_ms"] = round((_time.monotonic() - run_start) * 1000)
                return f"Agent error: {e}", attestation_ids, meta

            llm_ms = round((_time.monotonic() - llm_start) * 1000)

            # Capture usage + cost
            if response.usage:
                meta["usage"] = {
                    "prompt_tokens":     response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens":      response.usage.total_tokens,
                }
            try:
                meta["cost_usd"] = litellm.completion_cost(completion_response=response)
            except Exception:
                meta["cost_usd"] = None

            # Capture reasoning content (o1, deepseek-r1, etc.)
            choice = response.choices[0]
            message = choice.message
            reasoning = getattr(message, "reasoning_content", None) or getattr(message, "thinking", None)
            if reasoning:
                meta["reasoning"] = reasoning

            # If no tool calls, we have the final answer
            if not getattr(message, "tool_calls", None):
                final_text = message.content or ""
                meta["latency_ms"] = round((_time.monotonic() - run_start) * 1000)
                await self._emit_trace(session_id, org_id, "completion", {
                    "response": final_text,
                    "model": model,
                    "usage": meta["usage"],
                    "cost_usd": meta["cost_usd"],
                    "latency_ms": llm_ms,
                }, attestation_ids)
                return final_text, attestation_ids, meta

            # Process tool calls
            full_messages.append(message.model_dump())

            for tool_call in message.tool_calls:
                fn_name = tool_call.function.name
                fn_args = json.loads(tool_call.function.arguments or "{}")

                # Resolve which MCP server owns this tool
                server, tool = self._resolve_tool(fn_name, tool_bindings)

                # Emit tool_call trace event
                await self._emit_trace(session_id, org_id, "tool_call", {
                    "tool": fn_name,
                    "server": server,
                    "args": fn_args,
                }, attestation_ids)

                # Call the tool
                tool_result = await self._mcp.call_tool(server, tool, fn_args)

                # Emit tool_response trace event
                await self._emit_trace(session_id, org_id, "tool_response", {
                    "tool": fn_name,
                    "result": tool_result,
                }, attestation_ids)

                # Append tool result to messages
                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": fn_name,
                    "content": json.dumps(tool_result),
                })

        # Hit max iterations
        await self._emit_trace(session_id, org_id, "error", {
            "error": "max_iterations_reached",
            "iterations": max_iterations,
        }, attestation_ids)
        meta["latency_ms"] = round((_time.monotonic() - run_start) * 1000)
        return "Agent reached max iterations without completing.", attestation_ids, meta

    async def run_streaming(
        self,
        session_id: str,
        org_id: str,
        agent_id: str,
        harness_slug: str,
        model: str,
        messages: list[dict[str, str]],
        max_iterations: int = 10,
    ) -> AsyncIterator[str]:
        """
        Async generator that yields SSE strings.
        Text chunks:  data: {...}\n\n
        Meta event:   event: meta\ndata: {...}\n\n
        Done:         data: [DONE]\n\n
        """
        import time as _time

        run_start = _time.monotonic()
        harness = await self._fetch_harness(org_id, harness_slug)
        system_context = harness.get("definition", {}).get("system_context", "")
        tool_bindings  = harness.get("definition", {}).get("tool_bindings", [])
        tools = self._build_tool_definitions(tool_bindings)
        full_messages = (
            [{"role": "system", "content": system_context}] + list(messages)
            if system_context else list(messages)
        )

        attestation_ids: list[str] = []
        meta: dict = {
            "usage": {},
            "cost_usd": None,
            "latency_ms": 0,
            "model": model,
            "reasoning": None,
            "iterations": 0,
            "attestation_ids": attestation_ids,
        }
        chatcmpl_id = f"chatcmpl-{session_id}"
        full_text   = ""

        try:
            iteration = 0
            while iteration < max_iterations:
                iteration += 1
                meta["iterations"] = iteration

                await self._emit_trace(session_id, org_id, "reasoning_step", {
                    "iteration": iteration,
                    "message_count": len(full_messages),
                }, attestation_ids)

                kwargs: dict = dict(
                    model=model,
                    messages=full_messages,
                    tools=tools if tools else None,
                    tool_choice="auto" if tools else None,
                    stream=True,
                    stream_options={"include_usage": True},
                )
                if model.startswith("openrouter/") and self._openrouter_key:
                    kwargs["api_key"]  = self._openrouter_key
                    kwargs["api_base"] = "https://openrouter.ai/api/v1"

                try:
                    response_stream = await litellm.acompletion(**kwargs)
                except Exception as e:
                    await self._emit_trace(session_id, org_id, "error", {"error": str(e)}, attestation_ids)
                    err_chunk = {
                        "id": chatcmpl_id, "object": "chat.completion.chunk",
                        "choices": [{"index": 0, "delta": {"content": f"Agent error: {e}"}, "finish_reason": "stop"}],
                    }
                    yield f"data: {json.dumps(err_chunk)}\n\n"
                    break

                chunks: list = []
                is_tool_call_turn = False

                async for chunk in response_stream:
                    chunks.append(chunk)

                    # Grab usage whenever it appears — some providers embed it in
                    # the final content chunk, others send a dedicated usage-only chunk.
                    usage = getattr(chunk, "usage", None)
                    if usage and getattr(usage, "total_tokens", 0):
                        meta["usage"] = {
                            "prompt_tokens":     usage.prompt_tokens or 0,
                            "completion_tokens": usage.completion_tokens or 0,
                            "total_tokens":      usage.total_tokens or 0,
                        }

                    choices = getattr(chunk, "choices", None)
                    if not choices:
                        continue

                    choice = choices[0]
                    delta  = choice.delta

                    if getattr(delta, "tool_calls", None):
                        is_tool_call_turn = True

                    if not is_tool_call_turn:
                        content = getattr(delta, "content", None) or ""
                        if content:
                            full_text += content
                            sse = {
                                "id": chatcmpl_id,
                                "object": "chat.completion.chunk",
                                "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}],
                            }
                            yield f"data: {json.dumps(sse)}\n\n"

                    reasoning = getattr(delta, "reasoning_content", None) or getattr(delta, "thinking", None)
                    if reasoning:
                        meta["reasoning"] = (meta["reasoning"] or "") + reasoning

                if not is_tool_call_turn:
                    # Use stream_chunk_builder to reconstruct usage + cost.
                    # This is the most reliable path — it uses tiktoken as a fallback
                    # when the provider didn't include usage in the stream.
                    try:
                        built = litellm.stream_chunk_builder(chunks)
                        if built and built.usage:
                            u = built.usage
                            if not meta["usage"].get("total_tokens"):
                                meta["usage"] = {
                                    "prompt_tokens":     u.prompt_tokens or 0,
                                    "completion_tokens": u.completion_tokens or 0,
                                    "total_tokens":      u.total_tokens or 0,
                                }
                        meta["cost_usd"] = litellm.completion_cost(completion_response=built)
                    except Exception:
                        meta["cost_usd"] = None

                    await self._emit_trace(session_id, org_id, "completion", {
                        "response": full_text,
                        "model": model,
                        "usage": meta["usage"],
                        "cost_usd": meta["cost_usd"],
                    }, attestation_ids)
                    break

                # Reconstruct tool-call message and process tools
                try:
                    built = litellm.stream_chunk_builder(chunks)
                    message = built.choices[0].message
                except Exception:
                    break

                full_messages.append(message.model_dump())

                for tool_call in (getattr(message, "tool_calls", None) or []):
                    fn_name = tool_call.function.name
                    fn_args = json.loads(tool_call.function.arguments or "{}")
                    server, tool = self._resolve_tool(fn_name, tool_bindings)

                    await self._emit_trace(session_id, org_id, "tool_call",
                                           {"tool": fn_name, "server": server, "args": fn_args}, attestation_ids)
                    tool_result = await self._mcp.call_tool(server, tool, fn_args)
                    await self._emit_trace(session_id, org_id, "tool_response",
                                           {"tool": fn_name, "result": tool_result}, attestation_ids)

                    full_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": fn_name,
                        "content": json.dumps(tool_result),
                    })

        except Exception as e:
            err_chunk = {
                "id": chatcmpl_id, "object": "chat.completion.chunk",
                "choices": [{"index": 0, "delta": {"content": f"\n\n[Stream error: {e}]"}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(err_chunk)}\n\n"

        meta["latency_ms"]      = round((_time.monotonic() - run_start) * 1000)
        meta["attestation_ids"] = attestation_ids

        # Terminal stop chunk — required by OpenAI streaming spec before [DONE]
        stop_chunk = {
            "id": chatcmpl_id,
            "object": "chat.completion.chunk",
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(stop_chunk)}\n\n"
        yield f"event: meta\ndata: {json.dumps(meta)}\n\n"
        yield "data: [DONE]\n\n"

    async def _fetch_harness(self, org_id: str, harness_slug: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f"{self._context_library_url}/harnesses",
                    params={"org_id": org_id},
                )
                resp.raise_for_status()
                harnesses = resp.json()
                for h in harnesses:
                    if h.get("slug") == harness_slug:
                        # Fetch full definition
                        detail_resp = await client.get(
                            f"{self._context_library_url}/harnesses/{h['id']}",
                            params={"org_id": org_id},
                        )
                        return detail_resp.json()
        except Exception:
            pass
        return {}

    def _build_tool_definitions(self, tool_bindings: list[dict]) -> list[dict]:
        """Build LiteLLM-compatible tool definitions from harness tool_bindings."""
        tools = []
        for binding in tool_bindings:
            server = binding.get("server", "")
            for tool_name in binding.get("tools", []):
                tools.append({
                    "type": "function",
                    "function": {
                        "name": f"{server}__{tool_name}",
                        "description": f"Call {tool_name} on the {server} MCP server",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "params": {
                                    "type": "object",
                                    "description": "Tool parameters (varies by tool)",
                                }
                            },
                        },
                    },
                })
        return tools

    def _resolve_tool(self, fn_name: str, tool_bindings: list[dict]) -> tuple[str, str]:
        """Resolve a LLM-named function (server__tool) back to (server, tool)."""
        if "__" in fn_name:
            parts = fn_name.split("__", 1)
            return parts[0], parts[1]
        # Fall back: search bindings
        for binding in tool_bindings:
            if fn_name in binding.get("tools", []):
                return binding["server"], fn_name
        return "unknown", fn_name

    async def _emit_trace(
        self,
        session_id: str,
        org_id: str,
        event_type: str,
        payload: dict[str, Any],
        attestation_ids: list[str],
    ) -> None:
        """POST a trace event to attestation_service and collect the entry ID."""
        event = TraceEvent(
            session_id=session_id,
            org_id=org_id,
            event_type=event_type,
            payload=payload,
        )
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.post(
                    f"{self._attestation_url}/sessions/{session_id}/events",
                    json=event.model_dump(mode="json"),
                )
                if resp.status_code == 201:
                    attestation_ids.append(resp.json().get("entry_id", ""))
        except Exception:
            pass  # Attestation failure is non-blocking; agent continues
