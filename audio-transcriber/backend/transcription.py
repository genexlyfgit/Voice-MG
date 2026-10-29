"""
transcription.py – faster-whisper transcription logic.

Loads the model once (lazy, on first use) and reuses it for all subsequent jobs.
Exposes a single public function: run_transcription().
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Ensure FFmpeg is on PATH (winget installs to a non-standard location on
# some systems; inject it here so subprocess calls always work).
# ---------------------------------------------------------------------------

_FFMPEG_SEARCH_DIRS = [
    # WinGet default install location (Gyan build)
    os.path.expandvars(
        r"%LOCALAPPDATA%\Microsoft\WinGet\Packages"
        r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
        r"\ffmpeg-9.0.2-full_build\bin"
    ),
    # Chocolatey
    r"C:\ProgramData\chocolatey\bin",
    # Manual install
    r"C:\ffmpeg\bin",
    r"C:\Program Files\ffmpeg\bin",
]

def _ensure_ffmpeg_on_path() -> None:
    """Prepend known FFmpeg bin dirs to os.environ PATH at startup."""
    path_dirs = os.environ.get("PATH", "").split(os.pathsep)
    injected = False
    for d in _FFMPEG_SEARCH_DIRS:
        if os.path.isdir(d) and os.path.isfile(os.path.join(d, "ffmpeg.exe")):
            if d not in path_dirs:
                os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
                injected = True
                logger.info("Injected FFmpeg path: %s", d)
            else:
                logger.info("FFmpeg already on PATH via: %s", d)
            break
    if not injected and shutil.which("ffmpeg") is None:
        logger.warning(
            "FFmpeg not found in any known location. "
            "Please install FFmpeg and ensure it is on PATH."
        )

_ensure_ffmpeg_on_path()

# ---------------------------------------------------------------------------
# PyAV compatibility patch:
# Newer PyAV (v14+) removed the 'metadata_errors' parameter from av.open().
# faster-whisper passes metadata_errors="ignore", causing:
# TypeError: open() got an unexpected keyword argument 'metadata_errors'
# Patch av.open to filter out 'metadata_errors' if unsupported.
# ---------------------------------------------------------------------------
try:
    import av
    _real_av_open = av.open

    def _compat_av_open(*args, **kwargs):
        try:
            return _real_av_open(*args, **kwargs)
        except TypeError as err:
            if "metadata_errors" in str(err) and "metadata_errors" in kwargs:
                kwargs.pop("metadata_errors", None)
                return _real_av_open(*args, **kwargs)
            raise

    av.open = _compat_av_open
except Exception as _e:
    logger.debug("PyAV patch skipped: %s", _e)

# ---------------------------------------------------------------------------
# Model cache – one global instance reused across jobs
# ---------------------------------------------------------------------------

_model_cache: dict[str, object] = {}   # key: "<model>|<compute_type>|<device>"


def _get_model(model_size: str, compute_type: str, device: str):
    """Return a cached WhisperModel, loading it on first call."""
    from faster_whisper import WhisperModel  # type: ignore

    key = f"{model_size}|{compute_type}|{device}"
    if key not in _model_cache:
        logger.info(
            "Loading faster-whisper model '%s' (compute=%s, device=%s)…",
            model_size, compute_type, device,
        )
        # device_index=0 works for single-GPU setups
        _model_cache[key] = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type,
            device_index=0,
        )
        logger.info("Model '%s' loaded and cached.", model_size)
    return _model_cache[key]


# ---------------------------------------------------------------------------
# FFmpeg helpers
# ---------------------------------------------------------------------------

def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _convert_to_wav(src: Path, dst: Path) -> None:
    """Re-encode audio to mono 16 kHz WAV (Whisper's native format)."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(src),
        "-ar", "16000",
        "-ac", "1",
        "-f", "wav",
        str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(
            f"FFmpeg conversion failed:\n{result.stderr[-2000:]}"
        )


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class TranscriptionResult:
    transcript: str
    segments: list[dict]
    detected_language: str
    duration_seconds: float


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_transcription(
    audio_path: Path,
    *,
    language: Optional[str] = None,        # None → auto-detect
    model_size: str = "small",
    compute_type: str = "int8",
    device: str = "cpu",
    beam_size: int = 1,
    vad_filter: bool = True,
    include_timestamps: bool = False,
    progress_callback=None,                # callable(int: 0-100) or None
) -> TranscriptionResult:
    """
    Transcribe *audio_path* and return the result.

    Works with any format supported by FFmpeg (mp3, m4a, ogg, flac, …).
    The audio is first converted to a temporary 16 kHz mono WAV so that
    faster-whisper gets optimal input regardless of the original format.
    """
    if not _ffmpeg_available():
        raise RuntimeError(
            "FFmpeg is not installed or not on PATH. "
            "Please install FFmpeg and try again."
        )

    # ---- Determine device ----
    actual_device = _resolve_device(device)
    logger.info("Using device: %s", actual_device)

    # ---- Convert to WAV ----
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "input.wav"
        if progress_callback is not None:
            progress_callback(1)
        logger.info("Converting '%s' → WAV…", audio_path.name)
        _convert_to_wav(audio_path, wav_path)

        # ---- Load model ----
        model = _get_model(model_size, compute_type, actual_device)

        # ---- Transcribe ----
        if progress_callback is not None:
            progress_callback(3)
        logger.info(
            "Starting transcription (lang=%s, beam=%d, vad=%s)…",
            language or "auto", beam_size, vad_filter,
        )
        segments_iter, info = model.transcribe(
            str(wav_path),
            language=language,
            beam_size=beam_size,
            vad_filter=vad_filter,
            vad_parameters=dict(min_silence_duration_ms=500) if vad_filter else None,
            word_timestamps=False,
            task="transcribe",   # never translate
        )

        audio_duration = info.duration  # available immediately after transcribe()
        detected_lang = info.language or (language or "unknown")

        # ---- Iterate segments and build transcript live ----
        parts: list[str] = []
        seg_dicts: list[dict] = []
        for seg in segments_iter:
            text = seg.text.strip()
            if text:
                if include_timestamps:
                    ts = f"[{_fmt_ts(seg.start)} → {_fmt_ts(seg.end)}] "
                    parts.append(ts + text)
                else:
                    parts.append(text)
                seg_dicts.append({
                    "start": round(seg.start, 2),
                    "end":   round(seg.end,   2),
                    "text":  seg.text,
                })

            # Fire progress callback based on audio position (3% to 99%)
            if progress_callback is not None and audio_duration and audio_duration > 0:
                pct = min(99, max(3, int(seg.end / audio_duration * 100)))
                progress_callback(pct)

    transcript = "\n".join(parts)

    if progress_callback is not None:
        progress_callback(100)

    logger.info(
        "Transcription complete: %d segments, lang=%s, dur=%.1fs",
        len(seg_dicts), detected_lang, audio_duration,
    )

    return TranscriptionResult(
        transcript=transcript,
        segments=seg_dicts,
        detected_language=detected_lang,
        duration_seconds=round(audio_duration, 2),
    )


def _resolve_device(requested: str) -> str:
    """Return 'cuda' if a GPU is available and requested, otherwise 'cpu'."""
    if requested in ("cuda", "gpu"):
        try:
            import torch  # type: ignore
            if torch.cuda.is_available():
                return "cuda"
            logger.warning("CUDA requested but torch.cuda.is_available() = False. Falling back to cpu.")
        except ImportError:
            logger.warning("CUDA requested but torch is not installed. Falling back to cpu.")
        return "cpu"
    return "cpu"


def _fmt_ts(secs: float) -> str:
    h = int(secs // 3600)
    m = int((secs % 3600) // 60)
    s = int(secs % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def get_device_info() -> dict:
    """Return device info for the health endpoint."""
    device = "cpu"
    try:
        import torch  # type: ignore
        if torch.cuda.is_available():
            device = f"cuda ({torch.cuda.get_device_name(0)})"
    except ImportError:
        pass
    return {"device": device}
