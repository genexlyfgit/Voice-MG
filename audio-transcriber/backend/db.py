"""
db.py – Supabase (Postgres) persistence for completed transcription jobs.

Connection parameters are read individually from the environment (rather than
a single DSN string) and assembled with SQLAlchemy's URL.create, which
percent-encodes the username/password for us — safe even when the Supabase
password contains characters like %, &, or + that are special in a URI.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any, Optional

from sqlalchemy import (
    create_engine, text, Table, Column, MetaData,
    String, Float, DateTime, JSON, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.engine import URL

logger = logging.getLogger("voicescribe.db")

_DB_HOST = os.getenv("SUPABASE_DB_HOST")
_DB_PORT = int(os.getenv("SUPABASE_DB_PORT", "5432"))
_DB_NAME = os.getenv("SUPABASE_DB_NAME", "postgres")
_DB_USER = os.getenv("SUPABASE_DB_USER", "postgres")
_DB_PASSWORD = os.getenv("SUPABASE_DB_PASSWORD")

_engine = None
metadata = MetaData()

transcriptions = Table(
    "transcriptions",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("filename", String),
    Column("status", String),
    Column("language", String),
    Column("detected_language", String),
    Column("transcript", String),
    Column("original_transcript", String),
    Column("english_transcript", String),
    Column("comparison", JSON),
    Column("segments", JSON),
    Column("duration_seconds", Float),
    Column("processing_seconds", Float),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)


def _build_engine():
    if not _DB_HOST or not _DB_PASSWORD:
        logger.warning("Supabase DB env vars not set — persistence disabled.")
        return None

    url = URL.create(
        drivername="postgresql+psycopg2",
        username=_DB_USER,
        password=_DB_PASSWORD,
        host=_DB_HOST,
        port=_DB_PORT,
        database=_DB_NAME,
    )
    engine = create_engine(url, pool_pre_ping=True, pool_size=2, max_overflow=2)
    return engine


def _migrate(engine) -> None:
    """create_all only creates missing tables — add any columns introduced later."""
    new_columns = {
        "original_transcript": "TEXT",
        "english_transcript": "TEXT",
        "comparison": "JSON",
        "segments": "JSON",
    }
    with engine.begin() as conn:
        for col, col_type in new_columns.items():
            conn.execute(text(f"ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS {col} {col_type}"))


def init_db() -> bool:
    """Create the engine and table if missing. Returns True if DB is usable."""
    global _engine
    try:
        _engine = _build_engine()
        if _engine is None:
            return False
        metadata.create_all(_engine)
        _migrate(_engine)
        logger.info("Connected to Supabase Postgres and ensured schema.")
        return True
    except Exception:
        logger.exception("Failed to connect to Supabase Postgres — persistence disabled.")
        _engine = None
        return False


def is_enabled() -> bool:
    return _engine is not None


def save_job(
    job_id: str,
    filename: Optional[str],
    status: str,
    language: Optional[str],
    detected_language: Optional[str],
    transcript: Optional[str],
    duration_seconds: Optional[float],
    processing_seconds: Optional[float],
    original_transcript: Optional[str] = None,
    english_transcript: Optional[str] = None,
    comparison: Optional[list] = None,
    segments: Optional[list] = None,
) -> None:
    if _engine is None:
        return
    try:
        with _engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO transcriptions
                        (id, filename, status, language, detected_language, transcript,
                         original_transcript, english_transcript, comparison, segments,
                         duration_seconds, processing_seconds)
                    VALUES
                        (:id, :filename, :status, :language, :detected_language, :transcript,
                         :original_transcript, :english_transcript, :comparison, :segments,
                         :duration_seconds, :processing_seconds)
                    ON CONFLICT (id) DO UPDATE SET
                        status = EXCLUDED.status,
                        detected_language = EXCLUDED.detected_language,
                        transcript = EXCLUDED.transcript,
                        original_transcript = EXCLUDED.original_transcript,
                        english_transcript = EXCLUDED.english_transcript,
                        comparison = EXCLUDED.comparison,
                        segments = EXCLUDED.segments,
                        duration_seconds = EXCLUDED.duration_seconds,
                        processing_seconds = EXCLUDED.processing_seconds
                """),
                {
                    "id": job_id,
                    "filename": filename,
                    "status": status,
                    "language": language,
                    "detected_language": detected_language,
                    "transcript": transcript,
                    "original_transcript": original_transcript,
                    "english_transcript": english_transcript,
                    "comparison": json.dumps(comparison) if comparison is not None else None,
                    "segments": json.dumps(segments) if segments is not None else None,
                    "duration_seconds": duration_seconds,
                    "processing_seconds": processing_seconds,
                },
            )
    except Exception:
        logger.exception("Failed to save job %s to Supabase.", job_id)


def list_recent(limit: int = 50) -> list[dict[str, Any]]:
    """Lightweight list for the History page — excludes large transcript/JSON columns."""
    if _engine is None:
        return []
    try:
        with _engine.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT id, filename, status, language, detected_language,
                           duration_seconds, processing_seconds, created_at
                    FROM transcriptions
                    ORDER BY created_at DESC
                    LIMIT :limit
                """),
                {"limit": limit},
            ).mappings().all()
            return [dict(r) for r in rows]
    except Exception:
        logger.exception("Failed to list recent jobs from Supabase.")
        return []


def get_by_id(job_id: str) -> Optional[dict[str, Any]]:
    """Full record for one job — includes transcript text/comparison/segments for download."""
    if _engine is None:
        return None
    try:
        with _engine.connect() as conn:
            row = conn.execute(
                text("""
                    SELECT id, filename, status, language, detected_language,
                           transcript, original_transcript, english_transcript,
                           comparison, segments, duration_seconds, processing_seconds, created_at
                    FROM transcriptions
                    WHERE id = :id
                """),
                {"id": job_id},
            ).mappings().first()
            return dict(row) if row else None
    except Exception:
        logger.exception("Failed to fetch job %s from Supabase.", job_id)
        return None
