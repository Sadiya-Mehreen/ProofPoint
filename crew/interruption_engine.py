"""Decides which agents (if any) should react to a live transcript chunk.

Routing is pure keyword/pattern heuristics -- no LLM call -- so it stays cheap
enough to run on every chunk. The heavy lifting (actually running agents) is
delegated to crew.interview_crew.run_interview_analysis.
"""

import logging
import re

from crew.interview_crew import run_interview_analysis
from models.candidate_context import CandidateContext

logger = logging.getLogger(__name__)

TECH_CLAIM_PHRASES = [
    "i built",
    "i designed",
    "i implemented",
    "i developed",
    "i architected",
    "i wrote",
    "i created",
]

TECH_STACK_KEYWORDS = [
    "fastapi",
    "redis",
    "docker",
    "kubernetes",
    "react",
    "python",
    "postgres",
    "postgresql",
    "mongodb",
    "aws",
    "gcp",
    "azure",
    "graphql",
    "django",
    "flask",
    "node",
    "nodejs",
    "typescript",
    "javascript",
    "kafka",
    "grpc",
    "microservices",
    "terraform",
    "ci/cd",
]

BUSINESS_KEYWORDS = [
    "users",
    "market",
    "revenue",
    "stakeholders",
    "scale",
    "customers",
    "growth",
    "roi",
    "kpi",
    "kpis",
    "monetization",
    "pricing",
    "go-to-market",
]

FILLER_WORDS = [
    "um",
    "uh",
    "like",
    "basically",
    "kind of",
    "sort of",
    "you know",
    "i guess",
    "i mean",
]

MIN_WORDS_FOR_SUBSTANTIVE_CHUNK = 5

HIGH_SEVERITY_LEVELS = {"high", "critical"}

_AGENT_ORDER = ["alex", "dave", "sarah", "marcus"]


def _contains_any(normalized_text: str, phrases: list[str]) -> bool:
    return any(re.search(rf"\b{re.escape(phrase)}\b", normalized_text) for phrase in phrases)


def detect_routing(text: str) -> list[str]:
    normalized = text.lower()
    word_count = len(text.split())

    routed = set()

    if _contains_any(normalized, TECH_CLAIM_PHRASES) or _contains_any(
        normalized, TECH_STACK_KEYWORDS
    ):
        routed.update(("alex", "dave"))

    if _contains_any(normalized, BUSINESS_KEYWORDS):
        routed.add("marcus")

    if word_count < MIN_WORDS_FOR_SUBSTANTIVE_CHUNK or _contains_any(normalized, FILLER_WORDS):
        routed.add("sarah")

    return [name for name in _AGENT_ORDER if name in routed]


def should_run_judge(context: CandidateContext, new_findings: dict) -> bool:
    for result in new_findings.values():
        if not isinstance(result, dict):
            continue
        if str(result.get("severity", "")).lower() in HIGH_SEVERITY_LEVELS:
            return True
    return False


def process_transcript_chunk(context: CandidateContext, text: str) -> dict:
    context.add_transcript_chunk(text)

    agents_to_run = detect_routing(text)

    if not agents_to_run:
        return {
            "type": "no_action",
            "agents_run": [],
            "findings": {},
            "judge_triggered": False,
            "judge_result": None,
        }

    findings = run_interview_analysis(context, agents_to_run)

    judge_triggered = should_run_judge(context, findings)
    judge_result = None

    if judge_triggered:
        judge_output = run_interview_analysis(context, ["judge"])
        judge_result = judge_output.get("judge")

    return {
        "type": "agent_interrupt",
        "agents_run": agents_to_run,
        "findings": findings,
        "judge_triggered": judge_triggered,
        "judge_result": judge_result,
    }
