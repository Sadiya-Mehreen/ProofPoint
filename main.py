"""
ProofPoint FastAPI application entry point.

Compatibility patch for CrewAI + Groq:
CrewAI currently injects cache_breakpoint into messages for some
non-Anthropic providers, while Groq rejects that property.
"""

from dotenv import load_dotenv

# Load .env first
load_dotenv()

# ---------------------------------------------------------
# CrewAI + Groq cache_breakpoint workaround
# ---------------------------------------------------------

import crewai.llms.cache as _crewai_cache

# CrewAI's agent executor imports/uses this function.
# Returning the message unchanged prevents CrewAI from
# injecting `cache_breakpoint`.
_crewai_cache.mark_cache_breakpoint = lambda msg: msg


# ---------------------------------------------------------
# FastAPI
# ---------------------------------------------------------

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


@app.get("/health")
def health():
    return {"status": "ok"}
