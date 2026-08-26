"""Tests for /session/start and WS /ws/{session_id} in api/routes.py.

api/routes.py now imports from crew.interruption_engine / crew.interview_crew /
crew.interview_conductor, which transitively require crewai. Runs against the
real crewai package when it's importable; falls back to an in-memory stand-in
otherwise (see test_interview_crew.py). Individual tests then mock
crew.interruption_engine.run_interview_analysis directly where a chunk is
expected to route to real agent analysis, and api.routes.generate_next_turn /
api.routes.generate_recommended_answer (interview_conductor's LLM calls) where
the live conversational panel is expected to produce a next question / answer
feedback -- consistent with test_interruption_engine.py's approach of mocking
at the LLM boundary rather than simulating Crew.kickoff() or the raw litellm
call.
"""

import sys
import types
import unittest
from unittest.mock import patch

try:
    import crewai  # noqa: F401
except ImportError:

    class _FakeAgent:
        def __init__(self, *args, **kwargs):
            self.kwargs = kwargs

    class _FakeTask:
        def __init__(self, description, expected_output, agent, **kwargs):
            self.description = description
            self.expected_output = expected_output
            self.agent = agent

    class _FakeProcess:
        sequential = "sequential"

    class _FakeCrew:
        def __init__(self, agents, tasks, process=None, **kwargs):
            self.agents = agents
            self.tasks = tasks
            self.process = process

        def kickoff(self):
            raise RuntimeError("Crew.kickoff() is not used by these tests -- mock run_interview_analysis instead")

    _fake_crewai = types.ModuleType("crewai")
    _fake_crewai.Agent = _FakeAgent
    _fake_crewai.Task = _FakeTask
    _fake_crewai.Crew = _FakeCrew
    _fake_crewai.Process = _FakeProcess
    sys.modules["crewai"] = _fake_crewai

from fastapi import WebSocketDisconnect  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from api.routes import session_manager  # noqa: E402
from main import app  # noqa: E402

client = TestClient(app)

NO_ACTION_TEXT = "The weather today is nice and sunny outside."
ANOTHER_NO_ACTION_TEXT = "Everything continues working normally after that error."

NEXT_TURN_STUB = {
    "speaker": "alex",
    "role": "Technical",
    "text": "What was the trickiest bug you ran into there?",
    "topic": "debugging",
    "difficulty": "medium",
    "state": "interviewing",
}
RECOMMENDATION_STUB = {"summary": "", "key_points": [], "sample_answer": ""}


def _drain_introductions(ws):
    """Every new WS connection immediately pushes the panel introductions +
    opening question (see api.routes._kick_off_conversation) before the
    candidate has said anything at all -- drain those 4 events first so
    individual tests can focus on one candidate message at a time."""
    events = [ws.receive_json() for _ in range(4)]
    assert [e["speaker"] for e in events[:3]] == ["sarah", "alex", "dave"]
    assert all(e["state"] == "introductions" for e in events[:3])
    assert events[3]["state"] == "interviewing"
    return events


class SessionStartTests(unittest.TestCase):
    def test_start_session_returns_session_id(self):
        response = client.post("/session/start", json={"candidate_name": "Jamie Candidate"})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["session_id"])
        self.assertEqual(body["github_data"], {})

        session = session_manager.get_session(body["session_id"])
        self.assertIsNotNone(session)
        self.assertEqual(session.candidate_name, "Jamie Candidate")

    @patch("api.routes.get_github_footprint")
    def test_start_session_with_github_username_calls_github_service(self, mock_footprint):
        mock_footprint.return_value = {
            "username": "octocat",
            "repositories": [],
            "total_repositories": 0,
            "total_commits": 0,
            "languages": [],
            "error": None,
        }

        response = client.post(
            "/session/start",
            json={"candidate_name": "Jamie Candidate", "github_username": "octocat"},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        mock_footprint.assert_called_once_with("octocat")
        self.assertEqual(body["github_data"]["username"], "octocat")

        session = session_manager.get_session(body["session_id"])
        self.assertEqual(session.github_data["username"], "octocat")

    def test_start_session_stores_target_role_and_previous_topics(self):
        response = client.post(
            "/session/start",
            json={
                "candidate_name": "Jamie Candidate",
                "target_role": "Backend Engineer",
                "previous_topics": ["caching strategy", "team conflict"],
            },
        )

        session = session_manager.get_session(response.json()["session_id"])
        self.assertEqual(session.target_role, "Backend Engineer")
        self.assertEqual(session.previous_topics, ["caching strategy", "team conflict"])


class WebSocketIntroductionTests(unittest.TestCase):
    def setUp(self):
        self.session = session_manager.create_session()

    def test_connecting_pushes_panel_introductions_then_opening_question(self):
        with client.websocket_connect(f"/ws/{self.session.session_id}") as ws:
            events = _drain_introductions(ws)

        self.assertEqual(events[0]["text"], "Hi, I'm Sarah. I'll be focusing on your behavioral and communication skills.")
        self.assertEqual(events[1]["speaker"], "alex")
        self.assertEqual(events[2]["speaker"], "dave")
        self.assertEqual(events[3]["speaker"], "sarah")
        self.assertIn("about yourself", events[3]["text"].lower())

        self.assertEqual(self.session.interview_state, "interviewing")
        self.assertEqual(self.session.turns_taken, 1)
        self.assertEqual(self.session.topics_covered, ["introduction"])
        self.assertEqual(self.session.last_question["speaker"], "sarah")
        self.assertEqual(len(self.session.conversation_history), 1)
        self.assertEqual(self.session.conversation_history[0]["role"], "interviewer")


class WebSocketSessionTests(unittest.TestCase):
    def setUp(self):
        self.session = session_manager.create_session()

    @patch("api.routes.generate_next_turn")
    @patch("api.routes.generate_recommended_answer")
    def test_no_action_chunk_gets_ack_then_no_action_event(self, mock_recommend, mock_next_turn):
        mock_recommend.return_value = RECOMMENDATION_STUB
        mock_next_turn.return_value = NEXT_TURN_STUB

        with client.websocket_connect(f"/ws/{self.session.session_id}") as ws:
            _drain_introductions(ws)
            ws.send_json({"type": "transcript_chunk", "text": NO_ACTION_TEXT})
            ack = ws.receive_json()
            event = ws.receive_json()
            recommendation = ws.receive_json()
            next_turn = ws.receive_json()

        self.assertEqual(ack, {"type": "transcript_ack", "text": NO_ACTION_TEXT})
        self.assertEqual(
            event,
            {
                "type": "no_action",
                "agents_run": [],
                "findings": {},
                "judge_triggered": False,
                "judge_result": None,
            },
        )
        self.assertEqual(recommendation["type"], "recommended_answer")
        mock_recommend.assert_called_once()
        self.assertEqual(next_turn, {"type": "interviewer_turn", **NEXT_TURN_STUB})

        # candidate's answer to the kickoff question, plus the new question --
        # on top of the kickoff question itself from the introduction sequence.
        self.assertEqual(len(self.session.conversation_history), 3)
        self.assertEqual(self.session.turns_taken, 2)
        self.assertIn("debugging", self.session.topics_covered)

    @patch("api.routes.generate_next_turn")
    @patch("api.routes.generate_recommended_answer")
    @patch("crew.interruption_engine.run_interview_analysis")
    def test_routed_chunk_gets_ack_then_agent_interrupt_event(
        self, mock_run, mock_recommend, mock_next_turn
    ):
        mock_run.return_value = {
            "alex": {"finding": "Claims check out against GitHub history.", "severity": "low"},
            "dave": {"finding": "Answer holds up.", "severity": "low"},
        }
        mock_recommend.return_value = RECOMMENDATION_STUB
        mock_next_turn.return_value = NEXT_TURN_STUB

        text = "I built a FastAPI service with Redis caching."
        with client.websocket_connect(f"/ws/{self.session.session_id}") as ws:
            _drain_introductions(ws)
            ws.send_json({"type": "transcript_chunk", "text": text})
            ack = ws.receive_json()
            event = ws.receive_json()
            ws.receive_json()  # recommended_answer
            ws.receive_json()  # interviewer_turn

        self.assertEqual(ack, {"type": "transcript_ack", "text": text})
        self.assertEqual(event["type"], "agent_interrupt")
        self.assertEqual(event["agents_run"], ["alex", "dave"])
        self.assertEqual(event["findings"], mock_run.return_value)
        self.assertFalse(event["judge_triggered"])
        mock_run.assert_called_once_with(self.session, ["alex", "dave"])

    @patch("api.routes.generate_next_turn")
    @patch("api.routes.generate_recommended_answer")
    def test_conductor_signaling_complete_sends_interview_complete_event(
        self, mock_recommend, mock_next_turn
    ):
        mock_recommend.return_value = RECOMMENDATION_STUB
        mock_next_turn.return_value = {
            "speaker": "dave",
            "role": "Projects",
            "text": "",
            "topic": None,
            "difficulty": None,
            "state": "complete",
        }

        with client.websocket_connect(f"/ws/{self.session.session_id}") as ws:
            _drain_introductions(ws)
            ws.send_json({"type": "transcript_chunk", "text": NO_ACTION_TEXT})
            ws.receive_json()  # ack
            ws.receive_json()  # no_action
            ws.receive_json()  # recommended_answer
            complete_event = ws.receive_json()

        self.assertEqual(complete_event["type"], "interview_complete")
        self.assertEqual(self.session.interview_state, "complete")
        self.assertIsNone(self.session.last_question)

        # A further chunk after completion still gets integrity-checked, but
        # the conductor should not be asked for (or push) another question.
        mock_next_turn.reset_mock()
        with client.websocket_connect(f"/ws/{self.session.session_id}") as ws2:
            # Reconnecting mid/post-interview must not replay the intro sequence.
            ws2.send_json({"type": "transcript_chunk", "text": ANOTHER_NO_ACTION_TEXT})
            ws2.receive_json()  # ack
            ws2.receive_json()  # no_action
        mock_next_turn.assert_not_called()

    def test_invalid_session_id_rejected(self):
        with self.assertRaises(WebSocketDisconnect):
            with client.websocket_connect("/ws/does-not-exist"):
                pass

    @patch("api.routes.generate_next_turn")
    @patch("api.routes.generate_recommended_answer")
    def test_malformed_message_returns_error_and_stays_open(self, mock_recommend, mock_next_turn):
        mock_recommend.return_value = RECOMMENDATION_STUB
        mock_next_turn.return_value = NEXT_TURN_STUB

        with client.websocket_connect(f"/ws/{self.session.session_id}") as ws:
            _drain_introductions(ws)
            ws.send_text("not json at all")
            error_event = ws.receive_json()
            self.assertEqual(error_event["type"], "error")

            ws.send_json({"type": "transcript_chunk", "text": ANOTHER_NO_ACTION_TEXT})
            ack = ws.receive_json()
            event = ws.receive_json()
            self.assertEqual(ack, {"type": "transcript_ack", "text": ANOTHER_NO_ACTION_TEXT})
            self.assertEqual(event["type"], "no_action")


if __name__ == "__main__":
    unittest.main()
