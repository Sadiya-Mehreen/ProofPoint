"""CrewAI Task definitions for each agent in the interview panel, built dynamically from a CandidateContext."""

import json

from crewai import Task

from agents.alex import alex
from agents.dave import dave
from agents.judge import judge
from agents.marcus import marcus
from agents.sarah import sarah
from models.candidate_context import CandidateContext

FINDING_EXPECTED_OUTPUT = (
    'A JSON object with keys: "finding" (string, the specific issue or confirmation '
    'found), "severity" (one of "low", "medium", "high"), and "reasoning" (string, '
    "why this severity was assigned, citing specific evidence). Respond with only the "
    "JSON object, no surrounding text."
)

FINAL_SCORECARD_EXPECTED_OUTPUT = (
    "A JSON object with exactly these keys: "
    '"reality_vs_resume" (string, how well GitHub/technical evidence matches resume '
    'claims), "technical_integrity" (string, whether technical answers held up under '
    'scrutiny), "communication" (string, clarity vs. corporate-speak/filler), '
    '"domain_strategy" (string, how plausible and domain-appropriate the pitch was), '
    '"overall_assessment" (string, holistic verdict on credibility), '
    '"biggest_red_flags" (array of strings, the most serious specific issues found, '
    'empty array if none), "mandatory_repair_steps" (array of strings, concrete '
    "things the candidate would need to address or clarify, empty array if none), "
    '"overall_score" (integer 0-100, holistic score across the whole interview), '
    '"technical_score" (integer 0-100), "problem_solving_score" (integer 0-100), '
    '"communication_score" (integer 0-100), "project_knowledge_score" (integer 0-100), '
    '"behavioral_score" (integer 0-100), "practical_experience_score" (integer 0-100), '
    '"confidence_score" (integer 0-100), "strengths" (array of short strings, concrete '
    'things the candidate did well, grounded in what they actually said), "weaknesses" '
    '(array of short strings, concrete gaps, empty array if none), "areas_to_improve" '
    '(array of short strings, actionable suggestions), and "final_recommendation" '
    "(one or two sentence hiring-style recommendation). Base every score and claim on "
    "the actual conversation and findings below -- do not invent specifics that were "
    "never said. Respond with only the JSON object, no surrounding text."
)


def _format_findings(findings: list[dict]) -> str:
    if not findings:
        return "No findings have been reported by the panel yet."
    lines = [
        f"- [{entry.get('agent', 'unknown')}] ({entry.get('severity', 'unknown')}) "
        f"{entry.get('finding', '')}"
        for entry in findings
    ]
    return "\n".join(lines)


def build_alex_task(context: CandidateContext) -> Task:
    summary = context.to_summary_dict()
    description = f"""
You are auditing candidate {summary['candidate_name'] or 'Unknown'}'s GitHub footprint
for authenticity against their resume claims.

RESUME TEXT (candidate's own claims):
{context.resume_text or '(no resume text provided)'}

RAW GITHUB DATA (ground truth evidence, username: {summary['github_username'] or 'unknown'}):
{json.dumps(context.github_data, indent=2)}

RECENT INTERVIEW TRANSCRIPT:
{context.current_transcript or '(no transcript yet)'}

Compare the resume's technical claims against what the GitHub data actually shows
(commit history, repo activity, languages, size, freshness). Flag any claim the
GitHub evidence does not support or directly contradicts.
""".strip()
    return Task(description=description, expected_output=FINDING_EXPECTED_OUTPUT, agent=alex)


def build_dave_task(context: CandidateContext) -> Task:
    summary = context.to_summary_dict()
    description = f"""
You are stress-testing the technical integrity of candidate {summary['candidate_name'] or 'Unknown'}'s
spoken answers during a live interview.

CANDIDATE SUMMARY:
{json.dumps(summary, indent=2)}

LATEST TRANSCRIPT CHUNK:
{context.current_transcript or '(no transcript yet)'}

Assess whether the candidate's technical claims in this transcript hold up to scrutiny.
Flag vague, evasive, or implausible technical statements.
""".strip()
    return Task(description=description, expected_output=FINDING_EXPECTED_OUTPUT, agent=dave)


def build_sarah_task(context: CandidateContext) -> Task:
    summary = context.to_summary_dict()
    description = f"""
You are auditing candidate {summary['candidate_name'] or 'Unknown'}'s spoken answers
for corporate-speak: vague buzzwords and jargon standing in for real substance.

CANDIDATE SUMMARY:
{json.dumps(summary, indent=2)}

LATEST TRANSCRIPT CHUNK:
{context.current_transcript or '(no transcript yet)'}

Flag any answer that leans on empty corporate phrasing rather than concrete detail.
""".strip()
    return Task(description=description, expected_output=FINDING_EXPECTED_OUTPUT, agent=sarah)


def build_marcus_task(context: CandidateContext) -> Task:
    summary = context.to_summary_dict()
    description = f"""
You are evaluating how well candidate {summary['candidate_name'] or 'Unknown'}'s pitch
holds up against real industry/domain expectations for the role they're describing.

CANDIDATE SUMMARY:
{json.dumps(summary, indent=2)}

LATEST TRANSCRIPT CHUNK:
{context.current_transcript or '(no transcript yet)'}

Assess whether the candidate's framing of their experience is plausible and
domain-appropriate, or oversold relative to what a practitioner would say.
""".strip()
    return Task(description=description, expected_output=FINDING_EXPECTED_OUTPUT, agent=marcus)


def build_judge_task(context: CandidateContext, findings: list[dict]) -> Task:
    summary = context.to_summary_dict()
    description = f"""
You are the presiding judge of an interview integrity panel evaluating candidate
{summary['candidate_name'] or 'Unknown'}.

PANEL FINDINGS SO FAR:
{_format_findings(findings)}

Weigh the panel's findings and render a final verdict on the candidate's credibility.
""".strip()
    return Task(description=description, expected_output=FINDING_EXPECTED_OUTPUT, agent=judge)


def _format_conversation(context: CandidateContext) -> str:
    if not context.conversation_history:
        return "(no conversation recorded)"
    lines = []
    for entry in context.conversation_history:
        if entry.get("role") == "interviewer":
            lines.append(f"[{entry.get('speaker')}] {entry.get('text')}")
        else:
            lines.append(f"[candidate] {entry.get('text')}")
    return "\n".join(lines)


def build_final_judge_task(context: CandidateContext) -> Task:
    """Session-end scorecard task -- distinct from build_judge_task's live-interrupt shape."""
    summary = context.to_summary_dict()
    description = f"""
You are the presiding judge delivering the FINAL scorecard for candidate
{summary['candidate_name'] or 'Unknown'} (target role: {context.target_role or 'not specified'})
at the end of the interview.

FULL INTERVIEW CONVERSATION (interviewer questions and candidate answers, in order):
{_format_conversation(context)}

ALL ACCUMULATED INTEGRITY-PANEL FINDINGS FROM THE FULL SESSION:
{_format_findings(context.agent_findings)}

Synthesize the whole interview -- not just isolated answers -- into a final scorecard
covering both the narrative fields (reality_vs_resume, technical_integrity,
communication, domain_strategy, overall_assessment, biggest_red_flags,
mandatory_repair_steps) and the numeric/structured fields (overall_score and the
per-dimension scores, strengths, weaknesses, areas_to_improve, final_recommendation)
described in the expected output. Base every score and claim on what the candidate
actually said in the conversation above -- never invent a specific detail, metric, or
achievement that wasn't part of it.
""".strip()
    return Task(
        description=description, expected_output=FINAL_SCORECARD_EXPECTED_OUTPUT, agent=judge
    )


AGENTS = {
    "alex": alex,
    "dave": dave,
    "sarah": sarah,
    "marcus": marcus,
    "judge": judge,
}

TASK_BUILDERS = {
    "alex": build_alex_task,
    "dave": build_dave_task,
    "sarah": build_sarah_task,
    "marcus": build_marcus_task,
}
