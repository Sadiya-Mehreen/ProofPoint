"""
ProofPoint FastAPI application.

CrewAI + Groq compatibility patch:
prevents CrewAI from sending cache_breakpoint
to Groq, which currently rejects that property.
"""

from dotenv import load_dotenv

load_dotenv()


# ============================================================
# CREWAI + GROQ CACHE BREAKPOINT PATCH
# ============================================================

import crewai.llms.cache as crewai_cache


def _disable_cache_breakpoint(message):
    return message


# Patch the original cache module.
crewai_cache.mark_cache_breakpoint = _disable_cache_breakpoint


# CrewAI may import the function directly into another module.
# Patch those references too.
try:
    import crewai.experimental.agent_executor as agent_executor

    if hasattr(agent_executor, "mark_cache_breakpoint"):
        agent_executor.mark_cache_breakpoint = _disable_cache_breakpoint

except ImportError:
    pass


try:
    import crewai.agent.core as agent_core

    if hasattr(agent_core, "mark_cache_breakpoint"):
        agent_core.mark_cache_breakpoint = _disable_cache_breakpoint

except ImportError:
    pass


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
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():
    return {"status": "ok"}
