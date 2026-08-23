"""FastAPI route handlers for triggering and retrieving candidate evaluations."""

import asyncio
import json
import logging
import os
import tempfile

from fastapi import APIRouter, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from crew.interruption_engine import process_transcript_chunk
from crew.interview_crew import run_final_judge
from models.session_manager import SessionManager
from services.github_service import get_github_footprint
from services.resume_parser import parse_resume
from services.speech_service import analyze_speech

logger = logging.getLogger(__name__)

router = APIRouter()
session_manager = SessionManager()

SCORECARD_FIELDS = [
    "reality_vs_resume",
    "technical_integrity",
    "communication",
    "domain_strategy",
    "overall_assessment",
    "biggest_red_flags",
    "mandatory_repair_steps",
]


class SessionStartRequest(BaseModel):
    candidate_name: str
    github_username: str | None = None


def _build_scorecard(judge_output) -> dict:
    source = judge_output if isinstance(judge_output, dict) else {}
    scorecard = {}
    parse_warning = False

    for field in SCORECARD_FIELDS:
        if field in source:
            scorecard[field] = source[field]
        else:
            scorecard[field] = None
            parse_warning = True

    scorecard["parse_warning"] = parse_warning
    return scorecard


@router.get("/github/{username}")
def get_github(username: str):
    return get_github_footprint(username)


@router.post("/session/start")
def start_session(payload: SessionStartRequest):
    context = session_manager.create_session()
    context.candidate_name = payload.candidate_name
    context.github_username = payload.github_username

    if payload.github_username:
        context.github_data = get_github_footprint(payload.github_username)

    return {"session_id": context.session_id, "github_data": context.github_data}


@router.post("/session/{session_id}/end")
def end_session(session_id: str):
    context = session_manager.get_session(session_id)
    if context is None:
        raise HTTPException(status_code=404, detail="session_not_found")

    judge_run_result = run_final_judge(context)
    judge_output = judge_run_result.get("judge") if isinstance(judge_run_result, dict) else None

    scorecard = _build_scorecard(judge_output)
    context.final_scorecard = scorecard

    response = {
        "session_id": session_id,
        "scorecard": scorecard,
        "summary": context.to_summary_dict(),
    }

    # This really is the end of the interview, per the phase 9 ordering.
    session_manager.delete_session(session_id)

    return response


@router.post("/resume/upload")
async def upload_resume(session_id: str, file: UploadFile):
    context = session_manager.get_session(session_id)
    if context is None:
        raise HTTPException(status_code=404, detail="session_not_found")

    suffix = os.path.splitext(file.filename or "")[1] or ".pdf"

    fd, temp_path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as temp_file:
            temp_file.write(await file.read())

        resume_text = parse_resume(temp_path)
    finally:
        try:
            os.remove(temp_path)
        except OSError as exc:
            logger.warning("Failed to remove temp file %s: %s", temp_path, exc)

    context.resume_text = resume_text

    return {"resume_text": resume_text}


@router.post("/speech/analyze")
async def analyze_speech_route(file: UploadFile):
    suffix = os.path.splitext(file.filename or "")[1] or ".wav"

    fd, temp_path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as temp_file:
            temp_file.write(await file.read())

        result = analyze_speech(temp_path)
    finally:
        try:
            os.remove(temp_path)
        except OSError as exc:
            logger.warning("Failed to remove temp file %s: %s", temp_path, exc)

    return result


@router.websocket("/ws/{session_id}")
async def websocket_session(websocket: WebSocket, session_id: str):
    context = session_manager.get_session(session_id)
    if context is None:
        await websocket.close(code=4404, reason="session_not_found")
        return

    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()

            try:
                data = json.loads(raw)
                if not isinstance(data, dict) or data.get("type") != "transcript_chunk":
                    raise ValueError(f"unsupported message: {raw!r}")

                text = data.get("text")
                if not isinstance(text, str):
                    raise ValueError("'text' field must be a string")

                await websocket.send_json({"type": "transcript_ack", "text": text})

                # process_transcript_chunk adds the chunk to context itself, so it's
                # the single source of truth here -- it also runs (possibly slow,
                # LLM-backed) agent analysis, hence the thread offload to avoid
                # blocking the event loop for other connections.
                event = await asyncio.to_thread(process_transcript_chunk, context, text)
                await websocket.send_json(event)
            except WebSocketDisconnect:
                raise
            except Exception as exc:
                logger.warning(
                    "Error processing WS message for session %s: %s", session_id, exc
                )
                await websocket.send_json({"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for session %s", session_id)
