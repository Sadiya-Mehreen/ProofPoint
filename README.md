# ProofPoint
Sync your profile, Speak your mind, Prove your skills....

ProofPoint is a live voice interview prep tool. A candidate uploads a resume, links a
GitHub profile, and does a spoken mock interview. A panel of five CrewAI agents listens
in real time and fact-checks what's actually said against what the resume and GitHub
history actually show -- catching the gap between "I built a production FastAPI backend"
and a two-commit tutorial clone -- and a Judge agent synthesizes everything into a final
scorecard at the end of the session.

## Live

- **App**: https://auracheck-taupe.vercel.app
- **API** (Railway, Node auth/session layer -- not meant to be browsed directly): https://api-server-production-582a.up.railway.app

Frontend is hosted on Vercel; both backend services (the Node api-server above, and the
Python/CrewAI engine it talks to privately) run on Railway.

## Structure

- [backend/](backend/) -- the FastAPI backend: resume/GitHub/speech services, the
  CrewAI agent panel, session management, and the WebSocket interview stream. See
  [backend/README.md](backend/README.md) for setup, architecture, and how to run it.
- [frontend/](frontend/) -- the client. See [frontend/README.md](frontend/README.md).
