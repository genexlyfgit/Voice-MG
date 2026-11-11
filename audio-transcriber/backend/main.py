"""
main.py – FastAPI backend for VoiceScribe.

Endpoints
---------
GET  /api/health              – health check
GET  /api/languages           – list supported languages
POST /api/transcribe          – submit a new transcription job
GET  /api/transcribe/{job_id} – poll job status / fetch transcript
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from dotenv import load_dotenv

load_dotenv()

from transcription import get_device_info, run_transcription
from gemini_transcription import run_gemini_transcription
import db

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("voicescribe")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="VoiceScribe API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    db.init_db()

# ---------------------------------------------------------------------------
# In-memory job registry
# ---------------------------------------------------------------------------

# job_id -> dict with keys: status, message, transcript, segments,
#            detected_language, duration_seconds, processing_seconds, filename
_jobs: dict[str, dict[str, Any]] = {}

# One worker at a time – avoids loading multiple large models
_executor = ThreadPoolExecutor(max_workers=1)

# Mirrors the frontend's client-side cap — enforced here too since the client
# check is trivially bypassable (e.g. direct API calls).
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB

# ---------------------------------------------------------------------------
# Supported languages (Whisper large-v3 supports ~99 languages)
# ---------------------------------------------------------------------------

LANGUAGES = [
    {"code": "auto", "name": "Auto-detect",   "nativeName": "Auto"},
    {"code": "en",   "name": "English",        "nativeName": "English"},
    {"code": "ta",   "name": "Tamil",          "nativeName": "தமிழ்"},
    {"code": "hi",   "name": "Hindi",          "nativeName": "हिन्दी"},
    {"code": "te",   "name": "Telugu",         "nativeName": "తెలుగు"},
    {"code": "ml",   "name": "Malayalam",      "nativeName": "മലയാളം"},
    {"code": "kn",   "name": "Kannada",        "nativeName": "ಕನ್ನಡ"},
    {"code": "bn",   "name": "Bengali",        "nativeName": "বাংলা"},
    {"code": "mr",   "name": "Marathi",        "nativeName": "मराठी"},
    {"code": "ur",   "name": "Urdu",           "nativeName": "اردو"},
    {"code": "ar",   "name": "Arabic",         "nativeName": "العربية"},
    {"code": "fr",   "name": "French",         "nativeName": "Français"},
    {"code": "de",   "name": "German",         "nativeName": "Deutsch"},
    {"code": "es",   "name": "Spanish",        "nativeName": "Español"},
    {"code": "pt",   "name": "Portuguese",     "nativeName": "Português"},
    {"code": "zh",   "name": "Chinese",        "nativeName": "中文"},
    {"code": "ja",   "name": "Japanese",       "nativeName": "日本語"},
    {"code": "ko",   "name": "Korean",         "nativeName": "한국어"},
    {"code": "ru",   "name": "Russian",        "nativeName": "Русский"},
    {"code": "it",   "name": "Italian",        "nativeName": "Italiano"},
    {"code": "nl",   "name": "Dutch",          "nativeName": "Nederlands"},
    {"code": "pl",   "name": "Polish",         "nativeName": "Polski"},
    {"code": "tr",   "name": "Turkish",        "nativeName": "Türkçe"},
    {"code": "vi",   "name": "Vietnamese",     "nativeName": "Tiếng Việt"},
    {"code": "id",   "name": "Indonesian",     "nativeName": "Bahasa Indonesia"},
    {"code": "th",   "name": "Thai",           "nativeName": "ภาษาไทย"},
    {"code": "fa",   "name": "Persian",        "nativeName": "فارسی"},
    {"code": "uk",   "name": "Ukrainian",      "nativeName": "Українська"},
    {"code": "cs",   "name": "Czech",          "nativeName": "Čeština"},
    {"code": "sv",   "name": "Swedish",        "nativeName": "Svenska"},
    {"code": "ro",   "name": "Romanian",       "nativeName": "Română"},
    {"code": "hu",   "name": "Hungarian",      "nativeName": "Magyar"},
    {"code": "fi",   "name": "Finnish",        "nativeName": "Suomi"},
    {"code": "da",   "name": "Danish",         "nativeName": "Dansk"},
    {"code": "no",   "name": "Norwegian",      "nativeName": "Norsk"},
    {"code": "sk",   "name": "Slovak",         "nativeName": "Slovenčina"},
    {"code": "el",   "name": "Greek",          "nativeName": "Ελληνικά"},
    {"code": "he",   "name": "Hebrew",         "nativeName": "עברית"},
    {"code": "ms",   "name": "Malay",          "nativeName": "Bahasa Melayu"},
    {"code": "ca",   "name": "Catalan",        "nativeName": "Català"},
    {"code": "hr",   "name": "Croatian",       "nativeName": "Hrvatski"},
    {"code": "lt",   "name": "Lithuanian",     "nativeName": "Lietuvių"},
    {"code": "lv",   "name": "Latvian",        "nativeName": "Latviešu"},
    {"code": "sl",   "name": "Slovenian",      "nativeName": "Slovenščina"},
    {"code": "sr",   "name": "Serbian",        "nativeName": "Српски"},
    {"code": "bg",   "name": "Bulgarian",      "nativeName": "Български"},
    {"code": "mk",   "name": "Macedonian",     "nativeName": "Македонски"},
    {"code": "af",   "name": "Afrikaans",      "nativeName": "Afrikaans"},
    {"code": "sw",   "name": "Swahili",        "nativeName": "Kiswahili"},
    {"code": "pa",   "name": "Punjabi",        "nativeName": "ਪੰਜਾਬੀ"},
    {"code": "gu",   "name": "Gujarati",       "nativeName": "ગુજરાતી"},
    {"code": "ne",   "name": "Nepali",         "nativeName": "नेपाली"},
    {"code": "si",   "name": "Sinhala",        "nativeName": "සිංහල"},
    {"code": "my",   "name": "Burmese",        "nativeName": "မြန်မာဘာသာ"},
    {"code": "km",   "name": "Khmer",          "nativeName": "ភាសាខ្មែរ"},
    {"code": "lo",   "name": "Lao",            "nativeName": "ພາສາລາວ"},
    {"code": "am",   "name": "Amharic",        "nativeName": "አማርኛ"},
    {"code": "az",   "name": "Azerbaijani",    "nativeName": "Azərbaycan"},
    {"code": "be",   "name": "Belarusian",     "nativeName": "Беларуская"},
    {"code": "bs",   "name": "Bosnian",        "nativeName": "Bosanski"},
    {"code": "cy",   "name": "Welsh",          "nativeName": "Cymraeg"},
    {"code": "et",   "name": "Estonian",       "nativeName": "Eesti"},
    {"code": "gl",   "name": "Galician",       "nativeName": "Galego"},
    {"code": "hy",   "name": "Armenian",       "nativeName": "Հայերեն"},
    {"code": "is",   "name": "Icelandic",      "nativeName": "Íslenska"},
    {"code": "ka",   "name": "Georgian",       "nativeName": "ქართული"},
    {"code": "kk",   "name": "Kazakh",         "nativeName": "Қазақша"},
    {"code": "lb",   "name": "Luxembourgish",  "nativeName": "Lëtzebuergesch"},
    {"code": "mn",   "name": "Mongolian",      "nativeName": "Монгол"},
    {"code": "mt",   "name": "Maltese",        "nativeName": "Malti"},
    {"code": "sq",   "name": "Albanian",       "nativeName": "Shqip"},
    {"code": "uz",   "name": "Uzbek",          "nativeName": "Oʻzbek"},
    {"code": "yo",   "name": "Yoruba",         "nativeName": "Yorùbá"},
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cleanup_file(path: str) -> None:
    try:
        if os.path.exists(path):
            os.unlink(path)
    except Exception:
        pass


def _transcribe_task(
    job_id: str,
    audio_path: str,
    original_filename: str,
    language: Optional[str],
    model_size: str,
    compute_type: str,
    beam_size: int,
    vad_filter: bool,
    include_timestamps: bool,
) -> None:
    """Worker function executed in the thread pool."""
    job = _jobs[job_id]
    job["status"] = "processing"
    job["progress"] = 0
    job["message"] = f"Loading model '{model_size}' and transcribing…"
    t0 = time.time()

    def on_progress(pct: int):
        job["progress"] = max(job.get("progress", 0), pct)
        if pct < 100:
            job["message"] = f"Transcribing audio… {pct}%"
        else:
            job["message"] = "Finalizing transcript…"

    try:
        if model_size.startswith("gemini"):
            lang_name = None
            if language:
                lang_name = next(
                    (l["name"] for l in LANGUAGES if l["code"] == language),
                    language,
                )
            gresult = run_gemini_transcription(
                Path(audio_path),
                language=lang_name,
                model_name=model_size,
                include_timestamps=include_timestamps,
                progress_callback=on_progress,
            )
            elapsed = time.time() - t0
            job["status"] = "done"
            job["progress"] = 100
            job["message"] = "Transcription complete."
            job["transcript"] = gresult.transcript
            job["original_transcript"] = gresult.original_transcript
            job["english_transcript"] = gresult.english_transcript
            job["comparison"] = gresult.comparison
            job["segments"] = gresult.segments
            job["detected_language"] = gresult.detected_language
            job["duration_seconds"] = gresult.duration_seconds
            job["processing_seconds"] = round(elapsed, 1)
        else:
            result = run_transcription(
                Path(audio_path),
                language=language,
                model_size=model_size,
                compute_type=compute_type,
                device="cpu",  # change to "cuda" for GPU
                beam_size=beam_size,
                vad_filter=vad_filter,
                include_timestamps=include_timestamps,
                progress_callback=on_progress,
            )

            elapsed = time.time() - t0
            job["status"] = "done"
            job["progress"] = 100
            job["message"] = "Transcription complete."
            job["transcript"] = result.transcript
            job["original_transcript"] = result.transcript
            job["english_transcript"] = result.transcript
            job["comparison"] = None
            job["segments"] = result.segments
            job["detected_language"] = result.detected_language
            job["duration_seconds"] = result.duration_seconds
            job["processing_seconds"] = round(elapsed, 1)

    except Exception as exc:
        elapsed = time.time() - t0
        logger.error("Job %s failed after %.1fs:\n%s", job_id, elapsed, traceback.format_exc())
        job["status"] = "error"
        job["message"] = str(exc)

    finally:
        _cleanup_file(audio_path)
        logger.info("Job %s finished with status '%s'.", job_id, job["status"])
        db.save_job(
            job_id=job_id,
            filename=original_filename,
            status=job["status"],
            language=language,
            detected_language=job.get("detected_language"),
            transcript=job.get("transcript"),
            original_transcript=job.get("original_transcript"),
            english_transcript=job.get("english_transcript"),
            comparison=job.get("comparison"),
            segments=job.get("segments"),
            duration_seconds=job.get("duration_seconds"),
            processing_seconds=job.get("processing_seconds"),
        )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict:
    dev = get_device_info()
    return {
        "status": "ok",
        "model_loaded": bool(_jobs),   # rough proxy
        "device": dev["device"],
    }


@app.get("/api/languages")
async def languages() -> dict:
    # Return all except the "auto" sentinel so frontend can handle it separately
    langs = [l for l in LANGUAGES if l["code"] != "auto"]
    return {"languages": langs}


@app.post("/api/transcribe")
async def create_transcription_job(
    file: UploadFile = File(...),
    options: str = Form(...),
) -> dict:
    # Parse options
    try:
        opts = json.loads(options)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"Invalid options JSON: {e}")

    language: Optional[str] = opts.get("language") or None   # None → auto
    model_size: str = opts.get("model", "gemini-3.5-transcribe")
    compute_type: str = opts.get("compute_type", "int8")
    beam_size: int = int(opts.get("beam_size", 1))
    vad_filter: bool = bool(opts.get("vad_filter", True))
    include_timestamps: bool = bool(opts.get("include_timestamps", False))

    # Save upload to a temporary file, streaming in chunks so we never hold the
    # whole file in memory and can reject an oversized upload mid-stream.
    suffix = Path(file.filename or "audio.bin").suffix or ".bin"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    total_bytes = 0
    try:
        while chunk := await file.read(8 * 1024 * 1024):
            total_bytes += len(chunk)
            if total_bytes > MAX_UPLOAD_BYTES:
                tmp.close()
                _cleanup_file(tmp.name)
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024**3)} GB upload limit.",
                )
            tmp.write(chunk)
        tmp.flush()
    finally:
        if not tmp.closed:
            tmp.close()

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "queued",
        "progress": 0,
        "message": "Job queued — waiting for the transcription worker…",
        "transcript": None,
        "original_transcript": None,
        "english_transcript": None,
        "comparison": None,
        "segments": None,
        "detected_language": None,
        "duration_seconds": None,
        "processing_seconds": None,
        "filename": file.filename,
    }

    _executor.submit(
        _transcribe_task,
        job_id,
        tmp.name,
        file.filename or "audio",
        language,
        model_size,
        compute_type,
        beam_size,
        vad_filter,
        include_timestamps,
    )

    logger.info(
        "Job %s created: file=%s, lang=%s, model=%s",
        job_id, file.filename, language or "auto", model_size,
    )
    return {"job_id": job_id, "status": "queued", "progress": 0, "message": "Job queued."}


@app.get("/api/transcribe/{job_id}")
async def get_transcription_status(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {
        "job_id": job_id,
        "status": job["status"],
        "progress": job.get("progress", 0),
        "message": job["message"],
        "transcript": job.get("transcript"),
        "original_transcript": job.get("original_transcript"),
        "english_transcript": job.get("english_transcript"),
        "comparison": job.get("comparison"),
        "segments": job.get("segments"),
        "detected_language": job.get("detected_language"),
        "duration_seconds": job.get("duration_seconds"),
        "processing_seconds": job.get("processing_seconds"),
        "filename": job.get("filename"),
    }


@app.get("/api/history")
async def get_history(limit: int = 50) -> dict:
    if not db.is_enabled():
        return {"enabled": False, "jobs": []}
    return {"enabled": True, "jobs": db.list_recent(limit)}


@app.get("/api/history/{job_id}")
async def get_history_detail(job_id: str) -> dict:
    if not db.is_enabled():
        raise HTTPException(status_code=503, detail="History database is not available.")
    record = db.get_by_id(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="History entry not found.")
    return record
