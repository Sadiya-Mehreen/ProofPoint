"""
ProofPoint FastAPI application.

CrewAI + Groq compatibility patches.

Groq rejects the `cache_breakpoint` property that CrewAI
1.15.17 adds to messages.
"""

from dotenv import load_dotenv

load_dotenv()


# ============================================================
# CREWAI CACHE PATCH
# ============================================================

import crewai.llms.cache as crewai_cache


def _no_cache_breakpoint(message):
    """Return the message without adding CrewAI's cache flag."""
    if not isinstance(message, dict):
        return message

    cleaned = dict(message)
    cleaned.pop("cache_breakpoint", None)

    content = cleaned.get("content")

    if isinstance(content, list):
        cleaned["content"] = [
            (
                {k: v for k, v in block.items() if k != "cache_breakpoint"}
                if isinstance(block, dict)
                else block
            )
            for block in content
        ]

    return cleaned


crewai_cache.mark_cache_breakpoint = _no_cache_breakpoint


# ============================================================
# LITELLM PATCH
# ============================================================

import litellm

_real_completion = litellm.completion


def _completion_without_cache_breakpoint(*args, **kwargs):
    """Remove cache_breakpoint immediately before the API call."""

    messages = kwargs.get("messages")

    if isinstance(messages, list):
        cleaned_messages = []

        for message in messages:

            if isinstance(message, dict):

                message = dict(message)

                message.pop("cache_breakpoint", None)

                content = message.get("content")

                if isinstance(content, list):
                    cleaned_content = []

                    for block in content:
                        if isinstance(block, dict):
                            block = dict(block)
                            block.pop("cache_breakpoint", None)

                        cleaned_content.append(block)

                    message["content"] = cleaned_content

            cleaned_messages.append(message)

        kwargs["messages"] = cleaned_messages

    # Disable LiteLLM caching.
    kwargs["caching"] = False

    return _real_completion(*args, **kwargs)


litellm.completion = _completion_without_cache_breakpoint


# ============================================================
# FASTAPI
# ============================================================

from fastapi import FastAPI

from api.routes import router


app = FastAPI(
    title="ProofPoint",
    description=(
        "Live voice interview integrity analysis using "
        "CrewAI agents, GitHub evidence, resume data, "
        "and speech analysis."
    ),
    version="1.0.0",
)

app.include_router(router)


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
def health():
    return {"status": "ok"}
