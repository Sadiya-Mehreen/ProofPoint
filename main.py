"""ProofPoint FastAPI application."""

import json
import logging

from dotenv import load_dotenv

load_dotenv()

# ------------------------------------------------------------------
# LiteLLM -> Groq compatibility patch
# ------------------------------------------------------------------

import litellm

_original_completion = litellm.completion


def _remove_cache_breakpoints(messages):
    """Remove CrewAI cache_breakpoint fields recursively."""
    if not isinstance(messages, list):
        return messages

    cleaned = []

    for message in messages:
        if isinstance(message, dict):
            message = dict(message)
            message.pop("cache_breakpoint", None)

            content = message.get("content")

            if isinstance(content, list):
                new_content = []

                for block in content:
                    if isinstance(block, dict):
                        block = dict(block)
                        block.pop("cache_breakpoint", None)
                    new_content.append(block)

                message["content"] = new_content

            cleaned.append(message)
        else:
            cleaned.append(message)

    return cleaned


def _patched_completion(*args, **kwargs):
    if "messages" in kwargs:
        kwargs["messages"] = _remove_cache_breakpoints(
            kwargs["messages"]
        )

    # CrewAI/LiteLLM caching isn't required for ProofPoint.
    kwargs["caching"] = False

    return _original_completion(*args, **kwargs)


litellm.completion = _patched_completion


# ------------------------------------------------------------------
# FastAPI
# ------------------------------------------------------------------

from fastapi import FastAPI

from api.routes import router


logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="ProofPoint",
    description="Live AI interview integrity analysis.",
)

app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
