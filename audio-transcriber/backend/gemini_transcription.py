"""
gemini_transcription.py - audio transcription via the Gemini API.

Much faster than local CPU Whisper inference since the heavy lifting
happens on Google's servers. Requires GEMINI_API_KEY in the environment
(loaded from .env by main.py at startup).

Pipeline:
  1. Transcribe verbatim, in the spoken language, with word-level timestamps.
  2. Group words into timestamped segments (audio-synced, for annotation use).
  3. If a target language was requested, translate segment-by-segment so the
     translated output keeps the same start/end timing as the original.
"""

from __future__ import annotations

import json
import logging
import os
import re
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

# Sentence-ending punctuation used to break the running word stream into segments.
_SENTENCE_END_RE = re.compile(r"[.!?…]+$")
_MAX_SEGMENT_WORDS = 20


@dataclass
class Word:
    text: str
    start: float
    end: float


@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class GeminiTranscriptionResult:
    transcript: str                 # primary output (translated, if requested)
    original_transcript: str        # verbatim transcript in the spoken language
    segments: list[dict]            # timestamped, audio-synced; text matches `transcript`
    detected_language: str
    duration_seconds: float


def _parse_offset(raw) -> float:
    """Parse a Gemini offset like '12.340s' (or a bare float) into seconds."""
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    if s.endswith("s"):
        s = s[:-1]
    try:
        return float(s)
    except ValueError:
        return 0.0


def _extract_words(response) -> list[Word]:
    words: list[Word] = []
    for c in getattr(response, "candidates", None) or []:
        content = getattr(c, "content", None)
        for p in getattr(content, "parts", None) or []:
            at = getattr(p, "audio_transcription", None)
            if at is None:
                continue
            for w in getattr(at, "words", None) or []:
                text = getattr(w, "word", "") or ""
                if not text.strip():
                    continue
                words.append(Word(
                    text=text,
                    start=_parse_offset(getattr(w, "start_offset", None)),
                    end=_parse_offset(getattr(w, "end_offset", None)),
                ))
    return words


def _extract_plain_text(response) -> str:
    """Fallback extraction when word timestamps aren't present in the response."""
    parts_text = []
    for c in getattr(response, "candidates", None) or []:
        content = getattr(c, "content", None)
        for p in getattr(content, "parts", None) or []:
            t = getattr(p, "text", None)
            if t:
                parts_text.append(t)
                continue
            at = getattr(p, "audio_transcription", None)
            at_text = getattr(at, "text", None)
            if at_text:
                parts_text.append(at_text)
    return "\n".join(parts_text).strip()


def _words_to_segments(words: list[Word]) -> list[Segment]:
    """Group a flat word stream into sentence-ish, timestamped segments."""
    segments: list[Segment] = []
    current: list[Word] = []

    def flush():
        if not current:
            return
        text = " ".join(w.text for w in current).strip()
        if text:
            segments.append(Segment(start=current[0].start, end=current[-1].end, text=text))
        current.clear()

    for w in words:
        current.append(w)
        if _SENTENCE_END_RE.search(w.text) or len(current) >= _MAX_SEGMENT_WORDS:
            flush()
    flush()
    return segments


def _fmt_ts(secs: float) -> str:
    m = int(secs // 60)
    s = int(secs % 60)
    return f"{m:02d}:{s:02d}"


def _render_transcript(segments: list[Segment], include_timestamps: bool) -> str:
    if include_timestamps:
        return "\n".join(f"[{_fmt_ts(s.start)} → {_fmt_ts(s.end)}] {s.text}" for s in segments)
    return "\n".join(s.text for s in segments)


def _translate_segments(client, segments: list[Segment], target_language: str) -> list[Segment]:
    """Translate each segment's text into target_language, preserving timing."""
    if not segments:
        return []

    payload = [{"i": i, "text": s.text} for i, s in enumerate(segments)]
    prompt = (
        f"Translate the \"text\" field of each item below into {target_language}. "
        "Return ONLY a JSON array with the same objects, same \"i\" values, same "
        "order, with \"text\" replaced by the translation. No commentary, no markdown "
        "fences.\n\n" + json.dumps(payload, ensure_ascii=False)
    )
    response = client.models.generate_content(model=_TRANSLATE_MODEL, contents=[prompt])
    raw = (response.text or "").strip()
    raw = re.sub(r"^```[a-zA-Z]*\n?|```$", "", raw.strip()).strip()

    try:
        items = json.loads(raw)
        by_index = {int(item["i"]): item["text"] for item in items}
        translated = []
        for i, s in enumerate(segments):
            text = by_index.get(i, s.text)
            translated.append(Segment(start=s.start, end=s.end, text=text))
        return translated
    except Exception:
        logger.warning("Segment translation to '%s' failed to parse; falling back to whole-text translation.", target_language)
        whole = " ".join(s.text for s in segments)
        fallback_prompt = (
            f"Translate the following into {target_language}. Output only the "
            f"translation, no commentary:\n\n{whole}"
        )
        fb_response = client.models.generate_content(model=_TRANSLATE_MODEL, contents=[fallback_prompt])
        fb_text = (fb_response.text or "").strip() or whole
        # Can't realign word-for-word; keep original timing split evenly across the text.
        return [Segment(start=segments[0].start, end=segments[-1].end, text=fb_text)]


def run_gemini_transcription(
    audio_path: Path,
    *,
    language: Optional[str] = None,
    model_name: str = "gemini-3.5-transcribe",
    include_timestamps: bool = False,
    progress_callback=None,
) -> GeminiTranscriptionResult:
    """Transcribe audio_path using the Gemini API, with audio-synced timestamps."""
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

    prompt = (
        "Transcribe this audio verbatim, in the language it was spoken in. "
        "Output only the spoken words, no extra commentary, no speaker labels "
        "unless multiple speakers are clearly distinguishable."
    )

    if progress_callback is not None:
        progress_callback(40)

    t0 = time.time()
    try:
        from google.genai import types  # type: ignore
        response = client.models.generate_content(
            model=model_name,
            contents=[uploaded, prompt],
            config=types.GenerateContentConfig(
                audio_transcription_config=types.AudioTranscriptionConfig(
                    word_timestamp=True,
                )
            ),
        )
    except Exception as exc:
        logger.warning("Word-timestamp request failed (%s); retrying without timestamps.", exc)
        response = client.models.generate_content(
            model=model_name,
            contents=[uploaded, prompt],
        )
    elapsed = time.time() - t0
    logger.info("Gemini transcription finished in %.1fs", elapsed)

    if progress_callback is not None:
        progress_callback(90)

    words = _extract_words(response)
    segments = _words_to_segments(words)

    if not segments:
        # No word-level data available — fall back to a single, untimed segment.
        plain = _extract_plain_text(response)
        if not plain:
            candidates = getattr(response, "candidates", None) or []
            details = [
                f"finish_reason={getattr(c, 'finish_reason', None)} "
                f"safety_ratings={getattr(c, 'safety_ratings', None)}"
                for c in candidates
            ]
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
        segments = [Segment(start=0.0, end=0.0, text=plain)]

    try:
        client.files.delete(name=uploaded.name)
    except Exception:
        pass

    original_transcript = _render_transcript(segments, include_timestamps)

    out_segments = segments
    detected_language = "auto"
    transcript = original_transcript

    if language and language.lower() != "auto":
        if progress_callback is not None:
            progress_callback(96)
        translated_segments = _translate_segments(client, segments, language)
        if translated_segments:
            out_segments = translated_segments
            transcript = _render_transcript(translated_segments, include_timestamps)
            detected_language = language

    if progress_callback is not None:
        progress_callback(100)

    duration_seconds = segments[-1].end if segments else 0.0

    return GeminiTranscriptionResult(
        transcript=transcript,
        original_transcript=original_transcript,
        segments=[{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text} for s in out_segments],
        detected_language=detected_language,
        duration_seconds=round(duration_seconds, 2),
    )
