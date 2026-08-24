import os
import sys

import litellm
from dotenv import load_dotenv

# ============================================================
# PATH SETUP
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Load environment variables before importing the application.
load_dotenv()


# ============================================================
# FIX: CrewAI adds "cache_breakpoint" to messages.
# Groq rejects this property.
# ============================================================

def _remove_cache_breakpoint(message):
    """Remove CrewAI's unsupported cache_breakpoint field."""
    if isinstance(message, dict):
        message.pop("cache_breakpoint", None)

        content = message.get("content")

        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    block.pop("cache_breakpoint", None)

    return message


# ============================================================
# PATCH CREWAI CACHE MARKER
# ============================================================

import crewai.llms.cache as crewai_cache

crewai_cache.mark_cache_breakpoint = _remove_cache_breakpoint


# ============================================================
# PATCH CREWAI AGENT EXECUTOR
# ============================================================

try:
    import crewai.agents.crew_agent_executor as crew_agent_executor

    if hasattr(crew_agent_executor, "mark_cache_breakpoint"):
        crew_agent_executor.mark_cache_breakpoint = _remove_cache_breakpoint

except Exception:
    pass


# ============================================================
# PATCH CREWAI EXPERIMENTAL EXECUTOR
# ============================================================

try:
    import crewai.experimental.agent_executor as experimental_agent_executor

    if hasattr(experimental_agent_executor, "mark_cache_breakpoint"):
        experimental_agent_executor.mark_cache_breakpoint = _remove_cache_breakpoint

except Exception:
    pass


# ============================================================
# LITELLM SAFETY NET
# ============================================================

_real_completion = litellm.completion


def _completion_without_cache_breakpoint(*args, **kwargs):

    messages = kwargs.get("messages")

    if isinstance(messages, list):
        for message in messages:
            _remove_cache_breakpoint(message)

    # Remove unsupported cache parameter.
    kwargs.pop("cache_breakpoint", None)

    # ProofPoint does not need LiteLLM caching.
    kwargs["caching"] = False

    return _real_completion(*args, **kwargs)


litellm.completion = _completion_without_cache_breakpoint


# ============================================================
# FASTAPI APPLICATION
# ============================================================

from fastapi import FastAPI

# IMPORTANT:
# backend is already added to sys.path above.
# Therefore these imports resolve to:
# backend/api
# backend/crew
# backend/models
# backend/services

from api.routes import router


app = FastAPI(
    title="ProofPoint",
    description="AI-powered interview integrity platform",
    version="1.0.0",
)

app.include_router(router)


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():
    return {"status": "ok"}
