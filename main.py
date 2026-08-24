import os
import sys

import litellm
from dotenv import load_dotenv

# ============================================================
# ENVIRONMENT
# ============================================================

load_dotenv()

# ============================================================
# BACKEND IMPORT PATH
# ============================================================
# The actual API code is inside:
# backend/api/routes.py
#
# routes.py internally imports:
# crew, models, services
# so we also add backend/ to sys.path.

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

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

try:
    import crewai.llms.cache as crewai_cache

    crewai_cache.mark_cache_breakpoint = _remove_cache_breakpoint
except Exception:
    pass


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
# PATCH EXPERIMENTAL AGENT EXECUTOR
# ============================================================

try:
    import crewai.experimental.agent_executor as experimental_agent_executor

    if hasattr(experimental_agent_executor, "mark_cache_breakpoint"):
        experimental_agent_executor.mark_cache_breakpoint = _remove_cache_breakpoint
except Exception:
    pass


# ============================================================
# FINAL LITELLM SAFETY NET
# ============================================================

_real_completion = litellm.completion


def _completion_without_cache_breakpoint(*args, **kwargs):
    """Remove unsupported CrewAI cache fields before Groq requests."""

    messages = kwargs.get("messages")

    if isinstance(messages, list):
        for message in messages:
            _remove_cache_breakpoint(message)

    # Remove cache-related parameter if present.
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
# The actual routes.py is located at:
# backend/api/routes.py
#
# backend/ is already added to sys.path above, so the imports
# inside routes.py such as "from crew..." continue to work.

from backend.api.routes import router


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
