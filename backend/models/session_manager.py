"""In-memory session store for CandidateContext objects.

MVP only — the dict below can be swapped for Redis/a database later if sessions
need to survive a restart or be shared across processes.
"""

import uuid

from models.candidate_context import CandidateContext


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, CandidateContext] = {}

    def create_session(self) -> CandidateContext:
        session = CandidateContext(session_id=str(uuid.uuid4()))
        self._sessions[session.session_id] = session
        return session

    def get_session(self, session_id: str) -> CandidateContext | None:
        return self._sessions.get(session_id)

    def delete_session(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None
