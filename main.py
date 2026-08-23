"""ProofPoint FastAPI application entry point."""

import os

from dotenv import load_dotenv

# Load environment variables BEFORE importing CrewAI/agents.
load_dotenv()

# ---------------------------------------------------------------------------
# CrewAI + Groq compatibility patch
# ---------------------------------------------------------------------------
#
# CrewAI 1.15.17 adds `cache_breakpoint=True` to messages.
# Groq rejects this field with:
#
#   property 'cache_breakpoint' is unsupported
#
# We patch the function at its source AND the already-imported references
# used by CrewAI's agent executors.
# ---------------------------------------------------------------------------

import crewai.llms.cache as _crewai_cache


def _no_cache_breakpoint(message):
    """Return the message unchanged so Groq receives no cache_breakpoint."""
    return message


# Patch the source function.
_crewai_cache.mark_cache_breakpoint = _no_cache_breakpoint


# Patch modules that imported the function directly.
try:
    import crewai.agents.crew_agent_executor as _crew_agent_executor

    _crew_agent_executor.mark_cache_breakpoint = _no_cache_breakpoint
except (ImportError, AttributeError):
    pass


try:
    import crewai.experimental.agent_executor as _experimental_agent_executor

    _experimental_agent_executor.mark_cache_breakpoint = _no_cache_breakpoint
except (ImportError, AttributeError):
    pass


# ---------------------------------------------------------------------------
# LiteLLM compatibility patch
# ---------------------------------------------------------------------------
#
# Remove cache_breakpoint from any messages that somehow make it through.
# Also disable LiteLLM caching for these requests.
# ---------------------------------------------------------------------------

import litellm

_real_completion = litellm.completion


def _completion_without_cache_breakpoint(*args, **kwargs):
    messages = kwargs.get("messages", [])

    for message in messages:
        if isinstance(message, dict):
            message.pop("cache_breakpoint", None)

            content = message.get("content")

            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        block.pop("cache_breakpoint", None)

    kwargs["caching"] = False

    return _real_completion(*args, **kwargs)


litellm.completion = _completion_without_cache_breakpoint


# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------

from fastapi import FastAPI

from api.routes import router


app = FastAPI(
    title="ProofPoint",
    description="Live AI interview integrity and credibility analysis.",
)


app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
