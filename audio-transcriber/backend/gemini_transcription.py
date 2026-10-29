"""
gemini_transcription.py - audio transcription via the Gemini API.

Much faster than local CPU Whisper inference since the heavy lifting
happens on Google's servers. Requires GEMINI_API_KEY in the environment
(loaded from .env by main.py at startup).
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_MIME_TYPES = {
    ".mp3": "audio/mp3",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".webm": "audio/webm",
}

_client = None


def _get_client():
    global _client
    if _client is None:
        from google import genai  # type: ignore

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Add it to backend/.env and restart the server."
            )
        _client = genai.Client(api_key=api_key)
    return _client


_TRANSLATE_MODEL = "gemini-3.5-flash"


def _translate_text(client, text: str, target_language: str) -> str:
    """Translate transcript text into target_language using a general model."""
    prompt = (
        f"Translate the following transcript into {target_language}. "
        "Output only the translated text, with no commentary, preserving "
        "line breaks and paragraph structure:\n\n" + text
    )
    response = client.models.generate_content(
        model=_TRANSLATE_MODEL,
        contents=[prompt],
    )
    translated = (response.text or "").strip()
    if not translated:
        logger.warning("Translation to '%s' returned empty; keeping original transcript.", target_language)
        return text
    return translated


@dataclass
class GeminiTranscriptionResult:
    transcript: str
    detected_language: str
    duration_seconds: float


def run_gemini_transcription(
    audio_path: Path,
    *,
    language: Optional[str] = None,
    model_name: str = "gemini-2.5-flash",
    include_timestamps: bool = False,
    progress_callback=None,
) -> GeminiTranscriptionResult:
    """Transcribe audio_path using the Gemini API."""
    client = _get_client()

    if progress_callback is not None:
        progress_callback(5)

    mime_type = _MIME_TYPES.get(audio_path.suffix.lower(), "audio/mpeg")
    logger.info("Uploading '%s' (%s) to Gemini…", audio_path.name, mime_type)
    uploaded = client.files.upload(file=str(audio_path), config={"mime_type": mime_type})

    # Wait for the file to finish server-side processing before using it.
    poll_start = time.time()
    while uploaded.state and uploaded.state.name == "PROCESSING":
        if time.time() - poll_start > 120:
            raise RuntimeError("Gemini file upload timed out while processing.")
        time.sleep(1)
        uploaded = client.files.get(name=uploaded.name)

    if uploaded.state and uploaded.state.name == "FAILED":
        raise RuntimeError(f"Gemini file upload failed: {uploaded.error}")

    if progress_callback is not None:
        progress_callback(25)

    ts_hint = (
        " Prefix each line with its [MM:SS] start timestamp."
        if include_timestamps
        else ""
    )
    prompt = (
        "Transcribe this audio verbatim, in the language it was spoken in. "
        "Output only the spoken words as plain text, no extra commentary, "
        f"no speaker labels unless multiple speakers are clearly distinguishable.{ts_hint}"
    )

    if progress_callback is not None:
        progress_callback(40)

    t0 = time.time()
    response = client.models.generate_content(
        model=model_name,
        contents=[uploaded, prompt],
    )
    elapsed = time.time() - t0
    logger.info("Gemini transcription finished in %.1fs", elapsed)

    if progress_callback is not None:
        progress_callback(95)

    transcript = (response.text or "").strip()

    if not transcript:
        # Fall back to manually walking the response parts — `.text` can come
        # back empty even on a successful STOP if the SDK's quick accessor
        # doesn't recognize the part shape.
        parts_text = []
        for c in getattr(response, "candidates", None) or []:
            content = getattr(c, "content", None)
            for p in getattr(content, "parts", None) or []:
                t = getattr(p, "text", None)
                if t:
                    parts_text.append(t)
                    continue
                audio_transcription = getattr(p, "audio_transcription", None)
                at_text = getattr(audio_transcription, "text", None)
                if at_text:
                    parts_text.append(at_text)
        transcript = "\n".join(parts_text).strip()

    if not transcript:
        candidates = getattr(response, "candidates", None) or []
        details = []
        for c in candidates:
            details.append(
                f"finish_reason={getattr(c, 'finish_reason', None)} "
                f"safety_ratings={getattr(c, 'safety_ratings', None)}"
            )
        prompt_feedback = getattr(response, "prompt_feedback", None)
        raw = repr(response)[:2000]
        logger.error(
            "Gemini returned empty transcript. prompt_feedback=%s candidates=%s raw=%s",
            prompt_feedback, details, raw,
        )
        raise RuntimeError(
            f"Gemini returned an empty transcript. prompt_feedback={prompt_feedback} "
            f"candidates={details} raw={raw}"
        )

    try:
        client.files.delete(name=uploaded.name)
    except Exception:
        pass

    if language and language.lower() != "auto":
        if progress_callback is not None:
            progress_callback(97)
        transcript = _translate_text(client, transcript, language)

    if progress_callback is not None:
        progress_callback(100)

    return GeminiTranscriptionResult(
        transcript=transcript,
        detected_language=language if (language and language.lower() != "auto") else "auto",
        duration_seconds=0.0,
    )
