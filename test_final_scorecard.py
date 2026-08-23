"""Tests for the POST /session/{session_id}/end scorecard flow in api/routes.py.

Same crewai import-chain dependency as the other route/crew tests -- see
test_interview_crew.py for the real-vs-stub fallback pattern. run_final_judge
(crew/interview_crew.py, uses the 7-field build_final_judge_task) is mocked
directly at the api.routes level (where it's imported), so no real
Crew.kickoff() is invoked.
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
            raise RuntimeError("Crew.kickoff() is not used by these tests -- mock run_final_judge instead")

    _fake_crewai = types.ModuleType("crewai")
    _fake_crewai.Agent = _FakeAgent
    _fake_crewai.Task = _FakeTask
    _fake_crewai.Crew = _FakeCrew
    _fake_crewai.Process = _FakeProcess
    sys.modules["crewai"] = _fake_crewai

from fastapi.testclient import TestClient  # noqa: E402

from api.routes import session_manager  # noqa: E402
from main import app  # noqa: E402

client = TestClient(app)

FULL_VALID_JUDGE_OUTPUT = {
    "reality_vs_resume": "Resume claims are largely consistent with GitHub evidence.",
    "technical_integrity": "Answers held up under scrutiny.",
    "communication": "Clear, minimal filler.",
    "domain_strategy": "Framing was appropriate for the role.",
    "overall_assessment": "Strong candidate.",
    "biggest_red_flags": [],
    "mandatory_repair_steps": [],
}


class FinalScorecardTests(unittest.TestCase):
    def setUp(self):
        self.session = session_manager.create_session()
        self.session.candidate_name = "Jamie Candidate"
        self.session.add_agent_finding("alex", "some prior finding", "medium")

    @patch("api.routes.run_final_judge")
    def test_valid_judge_output_returns_full_scorecard_and_deletes_session(self, mock_run):
        mock_run.return_value = {"judge": FULL_VALID_JUDGE_OUTPUT}

        response = client.post(f"/session/{self.session.session_id}/end")

        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["session_id"], self.session.session_id)
        self.assertIn("summary", body)
        self.assertEqual(body["summary"]["candidate_name"], "Jamie Candidate")

        scorecard = body["scorecard"]
        for field, value in FULL_VALID_JUDGE_OUTPUT.items():
            self.assertEqual(scorecard[field], value)
        self.assertFalse(scorecard["parse_warning"])

        mock_run.assert_called_once_with(self.session)

        # stored back onto the context object itself, not just returned in the response
        self.assertEqual(self.session.final_scorecard, scorecard)

        # session must be gone -- this is genuinely the end of the interview
        self.assertIsNone(session_manager.get_session(self.session.session_id))

    @patch("api.routes.run_final_judge")
    def test_malformed_judge_output_returns_partial_scorecard_with_warning(self, mock_run):
        # Judge ignoring instructions and reverting to the live-interrupt shape
        # ({finding, severity, reasoning}) instead of the 7 scorecard fields --
        # exercises the fallback path build_final_judge_task's explicit schema
        # request is meant to make rare, not the common case.
        mock_run.return_value = {
            "judge": {
                "finding": "Panel confirms discrepancies.",
                "severity": "high",
                "reasoning": "Synthesis of prior findings.",
            }
        }

        response = client.post(f"/session/{self.session.session_id}/end")

        self.assertEqual(response.status_code, 200)
        scorecard = response.json()["scorecard"]

        self.assertTrue(scorecard["parse_warning"])
        for field in (
            "reality_vs_resume",
            "technical_integrity",
            "communication",
            "domain_strategy",
            "overall_assessment",
            "biggest_red_flags",
            "mandatory_repair_steps",
        ):
            self.assertIsNone(scorecard[field])

        # still deleted -- a bad/partial scorecard doesn't block session cleanup
        self.assertIsNone(session_manager.get_session(self.session.session_id))

    @patch("api.routes.run_final_judge")
    def test_partial_judge_output_fills_only_missing_fields_with_null(self, mock_run):
        partial_output = dict(FULL_VALID_JUDGE_OUTPUT)
        del partial_output["biggest_red_flags"]
        del partial_output["mandatory_repair_steps"]
        mock_run.return_value = {"judge": partial_output}

        response = client.post(f"/session/{self.session.session_id}/end")

        scorecard = response.json()["scorecard"]
        self.assertTrue(scorecard["parse_warning"])
        self.assertEqual(scorecard["reality_vs_resume"], partial_output["reality_vs_resume"])
        self.assertEqual(scorecard["overall_assessment"], partial_output["overall_assessment"])
        self.assertIsNone(scorecard["biggest_red_flags"])
        self.assertIsNone(scorecard["mandatory_repair_steps"])

    @patch("api.routes.run_final_judge")
    def test_total_crew_failure_does_not_crash(self, mock_run):
        mock_run.return_value = {"error": "crew_execution_failed", "detail": "boom"}

        response = client.post(f"/session/{self.session.session_id}/end")

        self.assertEqual(response.status_code, 200)
        scorecard = response.json()["scorecard"]
        self.assertTrue(scorecard["parse_warning"])
        self.assertIsNone(scorecard["overall_assessment"])
        self.assertIsNone(session_manager.get_session(self.session.session_id))

    def test_end_unknown_session_returns_404(self):
        response = client.post("/session/does-not-exist/end")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
