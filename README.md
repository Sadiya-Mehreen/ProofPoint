# ProofPoint
Sync your profile, Speak your mind, Prove your skills....

ProofPoint is a live voice interview prep tool. A candidate uploads a resume, links a
GitHub profile, and does a spoken mock interview over a WebSocket connection. A panel
of five CrewAI agents listens in real time and fact-checks what's actually said against
what the resume and GitHub history actually show -- catching the gap between "I built a
production FastAPI backend" and a two-commit tutorial clone -- and a Judge agent
synthesizes everything into a final scorecard at the end of the session.

## Architecture

```
Resume (PDF)  ─┐
GitHub profile ─┼─▶ CandidateContext ─▶ 5 CrewAI agents ─▶ Judge ─▶ WebSocket ─▶ Frontend
Speech/transcript ┘        │                  │
                            │                  └─ Alex (GitHub authenticity), Dave (technical
                            │                     integrity), Sarah (corporate speech),
                            │                     Marcus (domain pitch) -- inline-defined
                            │                     (role/goal/backstory), running on Groq via
                            │                     litellm, routed per transcript chunk by a
                            │                     keyword-based interruption engine (no LLM
                            │                     call for routing itself)
                            └─ in-memory session store (SessionManager), one CandidateContext
                               per interview session
```

- **Resume** (`services/resume_parser.py`) -- `pypdf`-based PDF text extraction.
- **GitHub** (`services/github_service.py`) -- unauthenticated GitHub REST API, normalized
  into a per-repo breakdown (languages, commit counts, stars, forks, size).
- **Speech** (`services/speech_service.py`) -- Groq Whisper transcription + Groq LLM analysis.
- **CandidateContext** (`models/candidate_context.py`) -- the Pydantic model that aggregates
  resume text, GitHub data, transcript history, and agent findings for one session.
- **Agents** (`agents/`) -- five CrewAI `Agent`s (Alex, Dave, Sarah, Marcus, Judge), each with
  an inline `role`/`goal`/`backstory` and `llm="groq/llama-3.3-70b-versatile"`.
- **Crew orchestration** (`crew/`) -- `tasks.py` builds per-agent CrewAI `Task`s from a
  `CandidateContext`; `interview_crew.py` runs a subset of agents (and, separately, the
  Judge) via `Crew(process=Process.sequential).kickoff()`; `interruption_engine.py` decides
  *which* agents should react to a given transcript chunk using cheap keyword/pattern
  heuristics, so a real LLM call only happens when something's actually worth checking.
- **API** (`api/routes.py`, `main.py`) -- FastAPI routes for session lifecycle, resume
  upload, GitHub lookup, and the live `WS /ws/{session_id}` transcript stream, plus the
  final `/session/{id}/end` scorecard.

## Setup

```
py -3.12 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Requires Python 3.12 -- `crewai` does not support 3.14+.

### `litellm`

`requirements.txt` includes `litellm`, which isn't obviously required by anything above --
it's there because CrewAI's `llm=` parameter only recognizes a fixed list of "native"
providers (OpenAI, Anthropic, Azure, Google, Bedrock, Ollama, OpenRouter, Cerebras, ...),
and **Groq is not on that list**. Without `litellm` installed, constructing any of the five
agents raises an `ImportError` at import time, before a single request is made. `litellm` is
what actually resolves `"groq/llama-3.3-70b-versatile"` into a working client at call time.

## Environment

```
copy .env.example .env
```

Then add your own key:

```
GROQ_API_KEY=your_groq_api_key_here
```

`.env` is git-ignored -- never commit a real key.

## Run

```
uvicorn main:app --reload
```

Then check `GET /health`, or `POST /session/start` to begin a session.
