"""Builds and runs the CrewAI panel for a subset of agents against a CandidateContext."""

import crewai.llms.cache as _crewai_cache

_crewai_cache.mark_cache_breakpoint = lambda msg: msg

import json
import logging

from crewai import Crew, Process
from crew.tasks import AGENTS, TASK_BUILDERS, build_final_judge_task, build_judge_task
from models.candidate_context import CandidateContext

logger = logging.getLogger(__name__)


def _parse_task_output(raw: str) -> dict:
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"raw": raw}


def _run_agents(context: CandidateContext, agent_names: list[str]) -> dict:
    tasks = [TASK_BUILDERS[name](context) for name in agent_names]
    agents = [AGENTS[name] for name in agent_names]

    crew = Crew(agents=agents, tasks=tasks, process=Process.sequential)
    crew_output = crew.kickoff()

    results = {}
    for name, task_output in zip(agent_names, crew_output.tasks_output):
        raw = task_output.raw
        parsed = _parse_task_output(raw)
        results[name] = parsed

        if isinstance(parsed, dict):
            finding_text = parsed.get("finding", raw)
            severity = parsed.get("severity", "unknown")
        else:
            finding_text = raw
            severity = "unknown"

        context.add_agent_finding(name, finding_text, severity)

    return results


def _run_judge(context: CandidateContext) -> dict:
    task = build_judge_task(context, context.agent_findings)
    crew = Crew(agents=[AGENTS["judge"]], tasks=[task], process=Process.sequential)
    crew_output = crew.kickoff()
    return _parse_task_output(crew_output.tasks_output[0].raw)


def run_interview_analysis(context: CandidateContext, agents_to_run: list[str]) -> dict:
    try:
        results = {}

        non_judge_agents = [
            name for name in agents_to_run if name != "judge" and name in TASK_BUILDERS
        ]
        unknown = [name for name in agents_to_run if name not in AGENTS]
        if unknown:
            logger.warning("Ignoring unknown agent name(s) in agents_to_run: %s", unknown)

        if non_judge_agents:
            results.update(_run_agents(context, non_judge_agents))

        if "judge" in agents_to_run:
            # _run_agents (if it ran above) already wrote fresh findings into
            # context.agent_findings, so _run_judge picking that up covers both
            # "judge alongside others" and "judge alone" in one code path.
            results["judge"] = _run_judge(context)

        return results

    except Exception as exc:
        logger.exception("Crew execution failed for session %s", context.session_id)
        return {"error": "crew_execution_failed", "detail": str(exc)}


def run_final_judge(context: CandidateContext) -> dict:
    """Session-end scorecard run -- uses build_final_judge_task's 7-field shape,
    not the lightweight {finding, severity, reasoning} live-interrupt path above."""
    try:
        task = build_final_judge_task(context)
        crew = Crew(agents=[AGENTS["judge"]], tasks=[task], process=Process.sequential)
        crew_output = crew.kickoff()
        return {"judge": _parse_task_output(crew_output.tasks_output[0].raw)}
    except Exception as exc:
        logger.exception("Final judge execution failed for session %s", context.session_id)
        return {"error": "crew_execution_failed", "detail": str(exc)}
