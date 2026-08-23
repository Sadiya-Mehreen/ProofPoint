"""Tests for crew/interruption_engine.py.

Importing crew.interruption_engine transitively imports crewai (via
crew.interview_crew -> crew.tasks -> agents.*). Runs against the real crewai
package when it's importable; falls back to a minimal in-memory stand-in
otherwise (see test_interview_crew.py for the same pattern).

Unlike test_interview_crew.py, these tests don't need to simulate
Crew.kickoff() at all: process_transcript_chunk calls run_interview_analysis
as an already-imported function, so it's mocked directly at that level. This
verifies interruption_engine's own logic (routing heuristics, the judge
threshold, and orchestration flow) independent of run_interview_analysis's
internals, which are already covered in test_interview_crew.py.
"""

import sys
import types
import unittest
from unittest.mock import patch

try:
    import crewai  # noqa: F401

    USING_REAL_CREWAI = True
except ImportError:
    USING_REAL_CREWAI = False

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
            raise RuntimeError("Crew.kickoff() is not used by these tests -- mock at the run_interview_analysis level instead")

    _fake_crewai = types.ModuleType("crewai")
    _fake_crewai.Agent = _FakeAgent
    _fake_crewai.Task = _FakeTask
    _fake_crewai.Crew = _FakeCrew
    _fake_crewai.Process = _FakeProcess
    sys.modules["crewai"] = _fake_crewai

from crew.interruption_engine import (  # noqa: E402
    detect_routing,
    process_transcript_chunk,
    should_run_judge,
)
from models.candidate_context import CandidateContext  # noqa: E402


def _make_context() -> CandidateContext:
    return CandidateContext(session_id="test-session", candidate_name="Jamie Candidate")


class DetectRoutingTests(unittest.TestCase):
    def test_technical_claim_routes_alex_and_dave(self):
        self.assertEqual(detect_routing("I built a FastAPI service with Redis caching."), ["alex", "dave"])

    def test_tech_stack_keyword_alone_routes_alex_and_dave(self):
        self.assertEqual(detect_routing("We used Docker and Kubernetes for deployment there."), ["alex", "dave"])

    def test_business_language_routes_marcus(self):
        self.assertEqual(
            detect_routing("We scaled to millions of users and grew revenue significantly."),
            ["marcus"],
        )

    def test_filler_heavy_routes_sarah(self):
        self.assertEqual(detect_routing("Um, like, I guess it was kind of okay I think so."), ["sarah"])

    def test_short_chunk_routes_sarah(self):
        self.assertEqual(detect_routing("yeah okay sure"), ["sarah"])

    def test_no_match_returns_empty_list(self):
        self.assertEqual(
            detect_routing("The weather today is nice and sunny outside."), []
        )

    def test_word_boundary_avoids_false_positive_on_resume(self):
        # "resume" contains the substring "um" -- must not trigger the "um" filler match
        self.assertEqual(detect_routing("I updated my resume last week for this role."), [])

    def test_multi_agent_routing(self):
        self.assertEqual(
            detect_routing("Um, I think I built the Redis caching layer myself."),
            ["alex", "dave", "sarah"],
        )


class ShouldRunJudgeTests(unittest.TestCase):
    def test_true_on_high_severity(self):
        context = _make_context()
        findings = {"alex": {"finding": "contradiction", "severity": "high"}}
        self.assertTrue(should_run_judge(context, findings))

    def test_true_on_critical_severity(self):
        context = _make_context()
        findings = {"dave": {"finding": "fabrication", "severity": "critical"}}
        self.assertTrue(should_run_judge(context, findings))

    def test_false_on_low_and_medium_only(self):
        context = _make_context()
        findings = {
            "dave": {"finding": "minor issue", "severity": "medium"},
            "sarah": {"finding": "some jargon", "severity": "low"},
        }
        self.assertFalse(should_run_judge(context, findings))

    def test_false_on_error_dict_does_not_crash(self):
        context = _make_context()
        findings = {"error": "crew_execution_failed", "detail": "boom"}
        self.assertFalse(should_run_judge(context, findings))

    def test_false_on_empty(self):
        context = _make_context()
        self.assertFalse(should_run_judge(context, {}))


class ProcessTranscriptChunkTests(unittest.TestCase):
    @patch("crew.interruption_engine.run_interview_analysis")
    def test_no_action_when_nothing_routes(self, mock_run):
        context = _make_context()
        result = process_transcript_chunk(context, "The weather today is nice and sunny outside.")

        self.assertEqual(
            result,
            {
                "type": "no_action",
                "agents_run": [],
                "findings": {},
                "judge_triggered": False,
                "judge_result": None,
            },
        )
        mock_run.assert_not_called()
        self.assertEqual(context.current_transcript, "The weather today is nice and sunny outside.")
        self.assertEqual(len(context.conversation_history), 1)

    @patch("crew.interruption_engine.run_interview_analysis")
    def test_agent_interrupt_without_judge_trigger(self, mock_run):
        mock_run.return_value = {
            "alex": {"finding": "looks fine", "severity": "low"},
            "dave": {"finding": "plausible", "severity": "medium"},
        }

        context = _make_context()
        result = process_transcript_chunk(context, "I built a FastAPI service with Redis caching.")

        self.assertEqual(result["type"], "agent_interrupt")
        self.assertEqual(result["agents_run"], ["alex", "dave"])
        self.assertEqual(result["findings"], mock_run.return_value)
        self.assertFalse(result["judge_triggered"])
        self.assertIsNone(result["judge_result"])
        mock_run.assert_called_once_with(context, ["alex", "dave"])

    @patch("crew.interruption_engine.run_interview_analysis")
    def test_agent_interrupt_triggers_judge_on_high_severity(self, mock_run):
        def fake_run(ctx, agents_to_run):
            if agents_to_run == ["judge"]:
                return {
                    "judge": {
                        "finding": "Panel confirms a serious credibility gap.",
                        "severity": "high",
                        "reasoning": "Based on Alex's contradiction finding.",
                    }
                }
            return {
                "alex": {
                    "finding": "Resume claim contradicted by GitHub evidence.",
                    "severity": "high",
                },
                "dave": {"finding": "Vague under pressure.", "severity": "medium"},
            }

        mock_run.side_effect = fake_run

        context = _make_context()
        result = process_transcript_chunk(context, "I built a FastAPI service with Redis caching.")

        self.assertEqual(result["type"], "agent_interrupt")
        self.assertTrue(result["judge_triggered"])
        self.assertEqual(result["judge_result"]["finding"], "Panel confirms a serious credibility gap.")

        self.assertEqual(mock_run.call_count, 2)
        first_call, second_call = mock_run.call_args_list
        self.assertEqual(first_call.args, (context, ["alex", "dave"]))
        self.assertEqual(second_call.args, (context, ["judge"]))


if __name__ == "__main__":
    unittest.main()
