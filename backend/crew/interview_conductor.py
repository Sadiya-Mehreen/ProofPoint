"""LLM-driven conversational interview conductor.

Unlike agents/*.py (integrity-critique agents that react to keyword-routed
transcript chunks after the fact -- see crew/interruption_engine.py), this
module actively drives the interview conversation itself: who speaks next,
what they ask, and -- once the candidate has answered -- what a stronger
answer would have looked like. It reuses the same three names (Sarah, Alex,
Dave) as the existing critique agents, deliberately: each interviewer
persona's live question-asking focus lines up with what their background
critique agent already checks (Sarah/HR <-> corporate-speech auditing,
Alex/Technical <-> GitHub authenticity, Dave/Projects <-> technical-answer
integrity), so the same name means the same "specialty" whether it's asking
a question live or flagging a finding in the background. Marcus and Judge
keep their existing roles unchanged (background business-pitch critique and
end-of-session synthesis respectively) rather than becoming live questioners.

Uses a direct litellm call (same pattern as services/speech_service.py's
Groq analysis call) rather than a CrewAI Agent/Task/Crew, since each of these
is a single structured-JSON decision made from a lot of combined context, not
a multi-step agent workflow.
"""

import json
import logging
import time

import litellm

from models.candidate_context import CandidateContext

logger = logging.getLogger(__name__)

MODEL = "groq/openai/gpt-oss-120b"
MAX_TURNS = 9  # hard safety cap -- force "complete" once reached, regardless of the model
MIN_TURNS = 5  # floor -- don't honor the model's own "complete" before this many exchanges
LLM_RETRY_ATTEMPTS = 3
LLM_RETRY_DELAY_SECONDS = 1.5

# A handful of generic-but-reasonable fallbacks, keyed by interviewer, used
# only if every retry of the real (grounded, dynamic) LLM call fails --
# e.g. a transient Groq rate limit or network blip. This keeps a live
# interview moving instead of ending it early over an infrastructure hiccup;
# it is not the primary question-generation path.
_FALLBACK_QUESTIONS = {
    "sarah": "Tell me about a time you disagreed with a teammate. How did you handle it?",
    "alex": "Walk me through how you'd debug a production issue you'd never seen before.",
    "dave": "What's a project you'd do differently if you started it again today, and why?",
}


def _call_llm_json(system_prompt: str, user_prompt: str, temperature: float) -> dict:
    """litellm.completion with a couple of retries -- Groq's free-tier rate
    limits are easy to hit when several calls (integrity findings, next-turn,
    recommended-answer) can all fire per candidate utterance, and a transient
    429 shouldn't be treated the same as "the model has nothing left to say"."""
    last_exc: Exception | None = None
    for attempt in range(1, LLM_RETRY_ATTEMPTS + 1):
        try:
            response = litellm.completion(
                model=MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=temperature,
            )
            return _safe_json(response.choices[0].message.content)
        except Exception as exc:  # noqa: BLE001 -- deliberately broad, see retry loop below
            last_exc = exc
            if attempt < LLM_RETRY_ATTEMPTS:
                time.sleep(LLM_RETRY_DELAY_SECONDS * attempt)

    logger.exception("LLM call failed after %d attempts", LLM_RETRY_ATTEMPTS, exc_info=last_exc)
    return {}


INTERVIEWERS = {
    "sarah": {
        "role": "HR",
        "focus": "behavioral and communication skills",
        "intro": "Hi, I'm Sarah. I'll be focusing on your behavioral and communication skills.",
    },
    "alex": {
        "role": "Technical",
        "focus": "technical knowledge and problem-solving",
        "intro": "Hi, I'm Alex. I'll focus on your technical knowledge and problem-solving.",
    },
    "dave": {
        "role": "Projects",
        "focus": "projects and practical experience",
        "intro": "Hi, I'm Dave. I'll be asking about your projects and practical experience.",
    },
}

KICKOFF_QUESTION = "Thanks for joining us. Could you start by telling us about yourself?"


def build_introduction_turns() -> list[dict]:
    """Scripted panel introductions + the opening question. These are fixed
    role descriptions, not personalized content, so there's no need for an
    LLM call -- everything from the candidate's self-introduction onward
    (generate_next_turn) is dynamically generated."""
    turns = [
        {
            "type": "interviewer_turn",
            "speaker": name,
            "role": info["role"],
            "text": info["intro"],
            "topic": None,
            "difficulty": None,
            "state": "introductions",
        }
        for name, info in INTERVIEWERS.items()
    ]
    turns.append(
        {
            "type": "interviewer_turn",
            "speaker": "sarah",
            "role": INTERVIEWERS["sarah"]["role"],
            "text": KICKOFF_QUESTION,
            "topic": "introduction",
            "difficulty": None,
            "state": "interviewing",
        }
    )
    return turns


def _condense_github(github_data: dict) -> str:
    repos = github_data.get("repositories") or []
    if not repos:
        return "(no public GitHub repositories available)"

    lines = []
    for repo in repos[:8]:
        languages = ", ".join(repo.get("languages") or []) or "unknown language"
        description = repo.get("description") or "no description"
        lines.append(
            f"- {repo.get('name')}: {description} [{languages}, "
            f"{repo.get('commit_count', 0)} commits, {repo.get('stars', 0)} stars]"
        )
    return "\n".join(lines)


def _format_conversation(context: CandidateContext) -> str:
    lines = []
    for entry in context.conversation_history:
        if entry.get("role") == "interviewer":
            lines.append(f"[{entry.get('speaker')}] {entry.get('text')}")
        else:
            lines.append(f"[candidate] {entry.get('text')}")
    return "\n".join(lines) if lines else "(conversation just started)"


def _interviewer_turn_counts(context: CandidateContext) -> dict:
    counts = {name: 0 for name in INTERVIEWERS}
    for entry in context.conversation_history:
        if entry.get("role") == "interviewer" and entry.get("speaker") in counts:
            counts[entry["speaker"]] += 1
    return counts


def _recent_findings(context: CandidateContext, limit: int = 4) -> str:
    if not context.agent_findings:
        return "(no integrity findings yet)"
    recent = context.agent_findings[-limit:]
    return "\n".join(
        f"- [{f.get('agent')}] ({f.get('severity')}) {f.get('finding')}" for f in recent
    )


def _safe_json(raw: str) -> dict:
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        logger.warning("Conductor call returned non-JSON output: %r", raw)
        return {}


CONDUCTOR_SYSTEM_PROMPT = """You are the turn-taking director for a live, three-person mock interview \
panel: Sarah (HR -- behavioral and communication), Alex (Technical -- problem-solving and technical \
depth), and Dave (Projects -- practical experience). You decide who speaks next and craft exactly one \
natural, conversational question or follow-up for them to ask.

Rules:
- Ground questions in the candidate's ACTUAL resume text and GitHub data given below. Reference real \
repo names, languages, employers, or projects when relevant. NEVER invent a company, project, metric, \
or technology the candidate hasn't actually mentioned and that isn't in their resume/GitHub.
- Prefer following up on what the candidate JUST said over jumping to a new unrelated topic. Dig into \
specifics ("why did you choose X over Y", "how did you measure that") rather than asking generic \
definitional questions.
- Adapt difficulty: if the candidate's last answer was detailed and confident, go deeper (tradeoffs, \
architecture, edge cases, scale). If it was vague, short, or uncertain, ask a simpler clarifying \
question or pivot toward fundamentals so they have a chance to demonstrate understanding.
- Balance turns across the three interviewers over the course of the interview -- don't let one \
dominate -- but pick whichever interviewer's specialty is most relevant to what the candidate just said. \
Only one interviewer speaks at a time.
- Do not repeat a question already asked this session or in the candidate's previous interviews \
(listed below) verbatim -- if revisiting a topic, go deeper than before rather than repeating it.
- Vary topic order and phrasing between interviews -- do not default to the same fixed sequence.
- After a reasonable, well-rounded conversation (roughly 6-9 exchanges covering behavioral, technical, \
and project ground), set "state" to "complete" instead of asking another question.

Respond with ONLY a JSON object with exactly these keys: "speaker" (one of "sarah", "alex", "dave"), \
"question" (string -- the exact words the interviewer should say; empty string if state is "complete"), \
"topic" (short string label for what this question is about), "difficulty" (one of "easy", "medium", \
"hard"), and "state" (either "interviewing" or "complete")."""


def generate_next_turn(context: CandidateContext) -> dict:
    if context.turns_taken >= MAX_TURNS:
        speaker = (context.last_question or {}).get("speaker", "sarah")
        return {
            "speaker": speaker,
            "role": INTERVIEWERS[speaker]["role"],
            "text": "",
            "topic": None,
            "difficulty": None,
            "state": "complete",
        }

    turn_counts = _interviewer_turn_counts(context)

    user_prompt = f"""
CANDIDATE: {context.candidate_name or "Unknown"}
TARGET ROLE: {context.target_role or "not specified"}

RESUME:
{context.resume_text or "(no resume provided)"}

GITHUB REPOSITORIES:
{_condense_github(context.github_data)}

CONVERSATION SO FAR THIS SESSION:
{_format_conversation(context)}

RECENT INTEGRITY-PANEL FINDINGS (separate agents cross-checking claims against evidence in the \
background -- use these as a source of probing follow-ups if relevant):
{_recent_findings(context)}

TOPICS ALREADY COVERED THIS SESSION: {", ".join(context.topics_covered) or "none yet"}
TOPICS COVERED IN THE CANDIDATE'S PREVIOUS INTERVIEWS (avoid repeating these): \
{", ".join(context.previous_topics) or "none"}
QUESTIONS ASKED SO FAR BY EACH INTERVIEWER THIS SESSION: {json.dumps(turn_counts)}
TOTAL EXCHANGES SO FAR: {context.turns_taken} (do not set state to "complete" before this reaches {MIN_TURNS})
""".strip()

    parsed = _call_llm_json(CONDUCTOR_SYSTEM_PROMPT, user_prompt, temperature=0.85)
    llm_call_failed = not parsed

    speaker = parsed.get("speaker") if parsed.get("speaker") in INTERVIEWERS else "sarah"
    state = parsed.get("state") if parsed.get("state") in ("interviewing", "complete") else "interviewing"
    question = parsed.get("question") or ""

    if context.turns_taken < MIN_TURNS:
        # Don't honor an early "complete" -- from the model's own judgment or
        # from a failed call being misread as "nothing left to ask".
        state = "interviewing"

    if not question and state != "complete":
        # A transient failure (e.g. a rate limit) shouldn't end someone's
        # interview early -- fall back to a generic, still-relevant question
        # from whichever interviewer has spoken least, and keep going.
        speaker = min(_interviewer_turn_counts(context), key=_interviewer_turn_counts(context).get)
        question = _FALLBACK_QUESTIONS[speaker]
        if not llm_call_failed:
            # The model itself returned an empty question without saying
            # "complete" -- still worth logging, distinct from an API failure.
            logger.warning("Conductor returned an empty question for session %s", context.session_id)

    return {
        "speaker": speaker,
        "role": INTERVIEWERS[speaker]["role"],
        # "text" (not "question") to match the field name build_introduction_turns
        # uses -- every interviewer_turn event has the same shape regardless of
        # whether it's scripted or LLM-generated.
        "text": question,
        "topic": parsed.get("topic"),
        "difficulty": parsed.get("difficulty"),
        "state": state,
    }


RECOMMENDED_ANSWER_SYSTEM_PROMPT = """You give a candidate private, constructive feedback on how they \
could have answered an interview question more effectively -- shown to them only after they've already \
answered, never before. Ground every suggestion strictly in their ACTUAL resume and GitHub data given \
below. If the resume/GitHub doesn't support a stronger detail (a specific technology, project, or \
metric), do not invent one -- keep the suggestion general instead ("quantify the impact if you can" \
rather than fabricating a number).

Respond with ONLY a JSON object with exactly these keys: "summary" (one or two sentence overview of how \
to strengthen the answer), "key_points" (array of 2-5 short strings, concrete things a stronger answer \
would cover), and "sample_answer" (a short example of an improved answer, grounded only in the \
candidate's real background -- if there isn't enough real detail to ground a sample answer, use an \
empty string instead of inventing one)."""


def generate_recommended_answer(context: CandidateContext, question: dict, candidate_answer: str) -> dict:
    user_prompt = f"""
CANDIDATE: {context.candidate_name or "Unknown"}
TARGET ROLE: {context.target_role or "not specified"}

RESUME:
{context.resume_text or "(no resume provided)"}

GITHUB REPOSITORIES:
{_condense_github(context.github_data)}

QUESTION ASKED (by {(question or {}).get("speaker", "the panel")}): {(question or {}).get("question", "")}

CANDIDATE'S ANSWER:
{candidate_answer}
""".strip()

    parsed = _call_llm_json(RECOMMENDED_ANSWER_SYSTEM_PROMPT, user_prompt, temperature=0.4)
    key_points = parsed.get("key_points")

    return {
        "summary": parsed.get("summary") or "",
        "key_points": key_points if isinstance(key_points, list) else [],
        "sample_answer": parsed.get("sample_answer") or "",
    }
