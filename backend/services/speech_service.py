"""Transcribes and analyzes candidate speech/interview audio via the Groq API."""

import json
import logging
import os

import httpx

logger = logging.getLogger(__name__)

GROQ_API_BASE = "https://api.groq.com/openai/v1"
WHISPER_MODEL = "whisper-large-v3-turbo"
ANALYSIS_MODEL = "llama-3.3-70b-versatile"
REQUEST_TIMEOUT = 60.0

ANALYSIS_SYSTEM_PROMPT = (
    "You are an interview speech analyst. Given a candidate's spoken-answer "
    "transcript, evaluate it and respond with ONLY a JSON object with these keys: "
    '"clarity_score" (integer 1-10), "confidence_score" (integer 1-10), '
    '"filler_word_count" (integer, count of words like \'um\', \'uh\', \'like\', \'you know\'), '
    '"corporate_speak_flags" (array of vague buzzphrases used, empty if none), '
    '"summary" (one or two sentence assessment).'
)


def _empty_result(error: str, duration_seconds=None) -> dict:
    return {
        "transcript": "",
        "word_count": 0,
        "duration_seconds": duration_seconds,
        "analysis": None,
        "error": error,
    }


def _analyze_transcript(client: httpx.Client, transcript: str) -> dict | None:
    try:
        response = client.post(
            f"{GROQ_API_BASE}/chat/completions",
            json={
                "model": ANALYSIS_MODEL,
                "messages": [
                    {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
                    {"role": "user", "content": transcript},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0,
            },
        )
    except httpx.RequestError as exc:
        logger.warning("Network error while analyzing transcript: %s", exc)
        return None

    if response.status_code != 200:
        logger.warning("Groq analysis request failed: HTTP %s", response.status_code)
        return None

    try:
        content = response.json()["choices"][0]["message"]["content"]
        return json.loads(content)
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        logger.warning("Failed to parse Groq analysis response: %s", exc)
        return None


def analyze_speech(file_path: str) -> dict:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        logger.warning("GROQ_API_KEY is not set; cannot analyze speech")
        return _empty_result("missing_api_key")

    if not os.path.isfile(file_path):
        logger.warning("Audio file not found: %s", file_path)
        return _empty_result("file_not_found")

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT,
            headers={"Authorization": f"Bearer {api_key}"},
        ) as client:
            with open(file_path, "rb") as audio_file:
                transcription_response = client.post(
                    f"{GROQ_API_BASE}/audio/transcriptions",
                    files={"file": (os.path.basename(file_path), audio_file)},
                    data={"model": WHISPER_MODEL, "response_format": "verbose_json"},
                )

            if transcription_response.status_code == 429:
                logger.warning("Groq rate limit hit while transcribing %s", file_path)
                return _empty_result("rate_limited")

            if transcription_response.status_code != 200:
                logger.warning(
                    "Groq transcription failed for %s: HTTP %s",
                    file_path,
                    transcription_response.status_code,
                )
                return _empty_result("transcription_failed")

            transcription = transcription_response.json()
            transcript = (transcription.get("text") or "").strip()
            duration = transcription.get("duration")

            if not transcript:
                logger.warning("Empty transcript for %s", file_path)
                return _empty_result("empty_transcript", duration_seconds=duration)

            analysis = _analyze_transcript(client, transcript)

            return {
                "transcript": transcript,
                "word_count": len(transcript.split()),
                "duration_seconds": duration,
                "analysis": analysis,
                "error": None if analysis is not None else "analysis_failed",
            }

    except httpx.TimeoutException:
        logger.warning("Network timeout while analyzing speech for %s", file_path)
        return _empty_result("network_error")
    except httpx.RequestError as exc:
        logger.warning("Network error while analyzing speech for %s: %s", file_path, exc)
        return _empty_result("network_error")
    except Exception:
        logger.exception("Unexpected failure analyzing speech for %s", file_path)
        return _empty_result("unknown_error")
