"""Pydantic model representing a candidate's aggregated context, passed to the crew and judge."""

from collections import Counter
from datetime import datetime, timezone

from pydantic import BaseModel, Field

RECENT_TRANSCRIPT_LINES = 5


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CandidateContext(BaseModel):
    session_id: str
    candidate_name: str | None = None
    target_role: str | None = None
    resume_text: str = ""
    github_username: str | None = None
    github_data: dict = Field(default_factory=dict)
    current_transcript: str = ""
    conversation_history: list[dict] = Field(default_factory=list)
    detected_claims: list[dict] = Field(default_factory=list)
    agent_findings: list[dict] = Field(default_factory=list)
    final_scorecard: dict = Field(default_factory=dict)
    created_at: str = Field(default_factory=_now_iso)

   # Live conversational-interview state
   # Possible states:
   # - introductions
   # - waiting_for_answer
   # - processing_answer
   # - completed
   interview_state: str = "introductions"

   turns_taken: int = 0

   topics_covered: list[str] = Field(default_factory=list)

   previous_topics: list[str] = Field(default_factory=list)

   last_question: dict | None = None

   # Prevent multiple speech-recognition chunks from advancing
   # the same interview turn.
   answer_in_progress: bool = False

   # Stores the last candidate answer that was processed.
   last_processed_answer: str = ""

    def add_transcript_chunk(self, text: str) -> None:
        self.conversation_history.append(
            {"role": "candidate", "text": text, "timestamp": _now_iso()}
        )
        self.current_transcript = text

    def add_interviewer_turn(
        self, speaker: str, text: str, topic: str | None, difficulty: str | None
    ) -> None:
        self.conversation_history.append(
            {
                "role": "interviewer",
                "speaker": speaker,
                "text": text,
                "topic": topic,
                "difficulty": difficulty,
                "timestamp": _now_iso(),
            }
        )

    def add_agent_finding(self, agent: str, finding: str, severity: str) -> None:
        self.agent_findings.append(
            {
                "agent": agent,
                "finding": finding,
                "severity": severity,
                "timestamp": _now_iso(),
            }
        )

    def to_summary_dict(self) -> dict:
        severity_counts = Counter(entry["severity"] for entry in self.agent_findings)
        recent_transcript = [
            entry["text"] for entry in self.conversation_history[-RECENT_TRANSCRIPT_LINES:]
        ]

        return {
            "candidate_name": self.candidate_name,
            "github_username": self.github_username,
            "total_findings": len(self.agent_findings),
            "findings_by_severity": dict(severity_counts),
            "recent_transcript": recent_transcript,
        }
