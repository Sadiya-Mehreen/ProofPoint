"""Tests for /session/start and WS /ws/{session_id} in api/routes.py.

api/routes.py now imports from crew.interruption_engine / crew.interview_crew,
which transitively require crewai. Runs against the real crewai package when
it's importable; falls back to an in-memory stand-in otherwise (see
test_interview_crew.py). Individual
tests then mock crew.interruption_engine.run_interview_analysis directly where
a chunk is expected to route to real agent analysis, rather than simulating
Crew.kickoff() -- consistent with test_interruption_engine.py.
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


class WebSocketSessionTests(unittest.TestCase):
    def setUp(self):
        self.session = session_manager.create_session()

    def test_no_action_chunk_gets_ack_then_no_action_event(self):
        with client.websocket_connect(f"/ws/{self.session.session_id}") as ws:
            ws.send_json({"type": "transcript_chunk", "text": NO_ACTION_TEXT})
            ack = ws.receive_json()
            event = ws.receive_json()

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
        self.assertEqual(self.session.current_transcript, NO_ACTION_TEXT)
        self.assertEqual(len(self.session.conversation_history), 1)

    @patch("crew.interruption_engine.run_interview_analysis")
    def test_routed_chunk_gets_ack_then_agent_interrupt_event(self, mock_run):
        mock_run.return_value = {
            "alex": {"finding": "Claims check out against GitHub history.", "severity": "low"},
            "dave": {"finding": "Answer holds up.", "severity": "low"},
        }

        text = "I built a FastAPI service with Redis caching."
        with client.websocket_connect(f"/ws/{self.session.session_id}") as ws:
            ws.send_json({"type": "transcript_chunk", "text": text})
            ack = ws.receive_json()
            event = ws.receive_json()

        self.assertEqual(ack, {"type": "transcript_ack", "text": text})
        self.assertEqual(event["type"], "agent_interrupt")
        self.assertEqual(event["agents_run"], ["alex", "dave"])
        self.assertEqual(event["findings"], mock_run.return_value)
        self.assertFalse(event["judge_triggered"])
        mock_run.assert_called_once_with(self.session, ["alex", "dave"])

    def test_invalid_session_id_rejected(self):
        with self.assertRaises(WebSocketDisconnect):
            with client.websocket_connect("/ws/does-not-exist"):
                pass

    def test_malformed_message_returns_error_and_stays_open(self):
        with client.websocket_connect(f"/ws/{self.session.session_id}") as ws:
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
