"""
ProofPoint FastAPI application entry point.

Disables CrewAI/LiteLLM cache-breakpoint handling because the current
Groq API rejects the `cache_breakpoint` message property.
"""

from dotenv import load_dotenv

# Load environment variables before importing CrewAI agents/routes.
load_dotenv()

# ---------------------------------------------------------------------------
# LiteLLM compatibility patch
# ---------------------------------------------------------------------------
#
# CrewAI -> LiteLLM -> Groq can send `cache_breakpoint` in system messages.
# Groq rejects that property with:
#
#   property 'cache_breakpoint' is unsupported
#
# Remove it before LiteLLM sends the request to Groq.
#

import litellm

_real_completion = litellm.completion


def _completion_without_cache_breakpoint(*args, **kwargs):
    messages = kwargs.get("messages", [])

    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, dict):
                continue

            # Remove cache_breakpoint from the message itself.
            message.pop("cache_breakpoint", None)

            # Also remove it from content blocks, if content is structured.
            content = message.get("content")

            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        block.pop("cache_breakpoint", None)

    # Explicitly disable LiteLLM caching for these requests.
    kwargs["caching"] = False

    return _real_completion(*args, **kwargs)


litellm.completion = _completion_without_cache_breakpoint


# ---------------------------------------------------------------------------
# CrewAI cache-breakpoint compatibility patch
# ---------------------------------------------------------------------------
#
# CrewAI may mark messages with cache breakpoints before LiteLLM receives them.
# Returning the message unchanged prevents that behavior.
#

try:
    import crewai.llms.cache as _crewai_cache

    _crewai_cache.mark_cache_breakpoint = lambda msg: msg

except ImportError:
    # If this CrewAI version does not expose the cache module,
    # the LiteLLM patch above is still applied.
    pass


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

from fastapi import FastAPI

from api.routes import router


app = FastAPI(
    title="ProofPoint",
    description=(
        "Live voice interview integrity analysis using "
        "CrewAI agents, GitHub evidence, resume data, and speech analysis."
    ),
    version="1.0.0",
)

app.include_router(router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}
