import json
import os
import unittest
from unittest.mock import MagicMock, patch

import httpx

from services.speech_service import analyze_speech


def _make_response(status_code, json_body):
    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    response.json.return_value = json_body
    return response


class AnalyzeSpeechTests(unittest.TestCase):
    def setUp(self):
        self.audio_path = "test_sample_audio.wav"
        with open(self.audio_path, "wb") as f:
            f.write(b"RIFF\x00\x00\x00\x00WAVEfmt ")

    def tearDown(self):
        if os.path.exists(self.audio_path):
            os.remove(self.audio_path)

    @patch.dict(os.environ, {}, clear=False)
    def test_missing_api_key_returns_error(self):
        os.environ.pop("GROQ_API_KEY", None)
        result = analyze_speech(self.audio_path)
        self.assertEqual(result["error"], "missing_api_key")
        self.assertEqual(result["transcript"], "")

    @patch.dict(os.environ, {"GROQ_API_KEY": "test-key"})
    def test_file_not_found_returns_error(self):
        result = analyze_speech("this_audio_file_does_not_exist.wav")
        self.assertEqual(result["error"], "file_not_found")

    @patch.dict(os.environ, {"GROQ_API_KEY": "test-key"})
    @patch("httpx.Client.post")
    def test_successful_transcription_and_analysis(self, mock_post):
        def side_effect(url, **kwargs):
            if "transcriptions" in url:
                return _make_response(
                    200, {"text": "This is a test transcript.", "duration": 4.2}
                )
            if "chat/completions" in url:
                content = json.dumps(
                    {
                        "clarity_score": 8,
                        "confidence_score": 7,
                        "filler_word_count": 1,
                        "corporate_speak_flags": [],
                        "summary": "Clear and confident answer.",
                    }
                )
                return _make_response(
                    200, {"choices": [{"message": {"content": content}}]}
                )
            raise AssertionError(f"unexpected url {url}")

        mock_post.side_effect = side_effect

        result = analyze_speech(self.audio_path)

        self.assertIsNone(result["error"])
        self.assertEqual(result["transcript"], "This is a test transcript.")
        self.assertEqual(result["word_count"], 5)
        self.assertEqual(result["duration_seconds"], 4.2)
        self.assertEqual(result["analysis"]["clarity_score"], 8)

    @patch.dict(os.environ, {"GROQ_API_KEY": "test-key"})
    @patch("httpx.Client.post", side_effect=httpx.TimeoutException("timed out"))
    def test_network_failure_returns_network_error(self, mock_post):
        result = analyze_speech(self.audio_path)
        self.assertEqual(result["error"], "network_error")
        self.assertEqual(result["transcript"], "")


if __name__ == "__main__":
    unittest.main()
