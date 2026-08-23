"""Tests for crew/tasks.py and crew/interview_crew.py.

Runs against the real `crewai` package when it's importable (it needs Python <3.14
and a real install -- see the D:\\proofpoint_venv verification pass). If it isn't
importable in a given environment, a minimal in-memory stand-in is registered into
sys.modules BEFORE any project code is imported instead, providing just enough of
crewai's public surface (Agent/Task/Process/Crew) for agents/*.py, crew/tasks.py,
and crew/interview_crew.py to import and run unmodified.

Either way, Crew.kickoff() is patched per-test to return canned outputs (via the
TaskOutput/CrewOutput doubles below, which are duck-typed and don't care whether
Crew itself is real or stubbed) -- this is the "mock at the Crew.kickoff() level"
these tests are meant to provide.

This verifies orchestration logic (agent selection, judge sequencing, data
injection into task descriptions) with real code execution. It does NOT make any
real LLM/API call and does NOT verify real LLM output quality.
"""

import json
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
            raise RuntimeError("Crew.kickoff() must be patched in tests")

    _fake_crewai = types.ModuleType("crewai")
    _fake_crewai.Agent = _FakeAgent
    _fake_crewai.Task = _FakeTask
    _fake_crewai.Crew = _FakeCrew
    _fake_crewai.Process = _FakeProcess
    sys.modules["crewai"] = _fake_crewai

from agents.alex import alex  # noqa: E402
from agents.judge import judge  # noqa: E402
from crew.interview_crew import run_interview_analysis  # noqa: E402
from crew.tasks import build_alex_task  # noqa: E402
from models.candidate_context import CandidateContext  # noqa: E402


class _TaskOutputDouble:
    """Duck-typed stand-in for crewai's TaskOutput -- only .raw is consumed."""

    def __init__(self, raw):
        self.raw = raw


class _CrewOutputDouble:
    """Duck-typed stand-in for crewai's CrewOutput -- only .tasks_output is consumed."""

    def __init__(self, tasks_output):
        self.tasks_output = tasks_output


ALEX_FINDING = (
    "Resume claims a production FastAPI backend, but the linked GitHub repo is a "
    "bare tutorial clone with 2 commits and no tests."
)
JUDGE_FINDING = "Panel confirms the discrepancy Alex flagged between resume and GitHub evidence."


def _make_context() -> CandidateContext:
    return CandidateContext(
        session_id="test-session",
        candidate_name="Jamie Candidate",
        resume_text=(
            "Senior Backend Engineer. Built and led development of a production "
            "FastAPI backend serving 10k+ requests/day with full test coverage."
        ),
        github_username="jamie-candidate",
        github_data={
            "username": "jamie-candidate",
            "repositories": [
                {
                    "name": "fastapi-tutorial-clone",
                    "description": "Following the FastAPI tutorial",
                    "languages": ["Python"],
                    "commit_count": 2,
                    "stars": 0,
                    "forks": 0,
                    "size_kb": 12,
                    "updated_at": "2026-01-15T00:00:00Z",
                }
            ],
            "total_repositories": 1,
            "total_commits": 2,
            "languages": ["Python"],
            "error": None,
        },
        current_transcript="I designed and shipped the production backend end to end myself.",
    )


class TaskDescriptionInjectionTests(unittest.TestCase):
    def test_alex_task_description_has_real_data_injected(self):
        context = _make_context()
        task = build_alex_task(context)

        self.assertIn("production FastAPI backend", task.description)
        self.assertIn("fastapi-tutorial-clone", task.description)
        self.assertIn("jamie-candidate", task.description)
        self.assertIn("shipped the production backend", task.description)
        self.assertIs(task.agent, alex)


class RunInterviewAnalysisTests(unittest.TestCase):
    """Patches Crew.kickoff (real or stubbed, whichever is in play) so no real LLM call happens."""

    def setUp(self):
        self.calls = []

        def fake_kickoff(crew_self):
            self.calls.append(crew_self)
            task_agent = crew_self.tasks[0].agent

            if task_agent is alex:
                payload = {
                    "finding": ALEX_FINDING,
                    "severity": "high",
                    "reasoning": "Commit count and repo structure don't match the claim.",
                }
            elif task_agent is judge:
                payload = {
                    "finding": JUDGE_FINDING,
                    "severity": "high",
                    "reasoning": "Synthesized from panel findings.",
                }
            else:
                raise AssertionError(f"unexpected agent in fake kickoff: {task_agent}")

            return _CrewOutputDouble([_TaskOutputDouble(json.dumps(payload))])

        self.fake_kickoff = fake_kickoff

    def test_alex_only_returns_non_empty_finding(self):
        context = _make_context()

        crew_cls = sys.modules["crewai"].Crew
        with patch.object(crew_cls, "kickoff", self.fake_kickoff, create=True):
            result = run_interview_analysis(context, ["alex"])

        self.assertNotIn("error", result)
        self.assertIn("alex", result)
        self.assertTrue(result["alex"].get("finding"))
        self.assertEqual(result["alex"]["finding"], ALEX_FINDING)

        self.assertEqual(len(context.agent_findings), 1)
        self.assertEqual(context.agent_findings[0]["agent"], "alex")
        self.assertEqual(context.agent_findings[0]["finding"], ALEX_FINDING)

    def test_alex_then_judge_runs_sequentially_with_alex_output_fed_in(self):
        context = _make_context()

        crew_cls = sys.modules["crewai"].Crew
        with patch.object(crew_cls, "kickoff", self.fake_kickoff, create=True):
            result = run_interview_analysis(context, ["alex", "judge"])

        self.assertNotIn("error", result)
        self.assertIn("alex", result)
        self.assertIn("judge", result)
        self.assertEqual(result["judge"]["finding"], JUDGE_FINDING)

        # two separate kickoffs: alex's crew, then judge's crew -- not one combined run
        self.assertEqual(len(self.calls), 2)
        alex_crew, judge_crew = self.calls
        self.assertIs(alex_crew.tasks[0].agent, alex)
        self.assertIs(judge_crew.tasks[0].agent, judge)

        # judge's task must have been built from alex's actual finding text
        self.assertIn(ALEX_FINDING, judge_crew.tasks[0].description)


if __name__ == "__main__":
    unittest.main()
