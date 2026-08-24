import litellm
from dotenv import load_dotenv

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


# Patch CrewAI's cache marker itself.
import crewai.llms.cache as crewai_cache

crewai_cache.mark_cache_breakpoint = _remove_cache_breakpoint


# Patch the two CrewAI executors that import/use the cache marker.
try:
    import crewai.agents.crew_agent_executor as crew_agent_executor

    if hasattr(crew_agent_executor, "mark_cache_breakpoint"):
        crew_agent_executor.mark_cache_breakpoint = _remove_cache_breakpoint
except Exception:
    pass


try:
    import crewai.experimental.agent_executor as experimental_agent_executor

    if hasattr(experimental_agent_executor, "mark_cache_breakpoint"):
        experimental_agent_executor.mark_cache_breakpoint = _remove_cache_breakpoint
except Exception:
    pass


# ============================================================
# FIX: Final safety net before LiteLLM sends the request to Groq
# ============================================================

_real_completion = litellm.completion


def _completion_without_cache_breakpoint(*args, **kwargs):
    messages = kwargs.get("messages")

    if isinstance(messages, list):
        for message in messages:
            _remove_cache_breakpoint(message)

    # Also remove any cache-related parameter that might be passed.
    kwargs.pop("cache_breakpoint", None)

    # CrewAI/LiteLLM caching is not needed for ProofPoint.
    kwargs["caching"] = False

    return _real_completion(*args, **kwargs)


litellm.completion = _completion_without_cache_breakpoint


# ============================================================
# FastAPI application
# ============================================================

from fastapi import FastAPI

import sys
import os

# Add the backend directory to Python's import path.
# This allows backend/api/routes.py to continue using imports
# such as: from crew..., from models..., from services...
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from api.routes import router


app = FastAPI(
    title="ProofPoint",
    description="AI-powered interview integrity platform",
    version="1.0.0",
)

app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
