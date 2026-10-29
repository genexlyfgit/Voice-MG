# VoiceScribe – Offline Audio Transcription

A fully local audio transcription app powered by **faster-whisper** (Whisper large-v3).  
No internet connection or paid API required after setup.

---

## Features

- 🎙 Drag-and-drop audio upload (MP3, WAV, M4A, FLAC, OGG, WebM, AAC, …)
- 🌍 70+ languages with native-script output (Tamil → தமிழ், Hindi → हिन्दी, …)
- 🔍 Automatic language detection or manual selection
- ✏️ Editable transcript before downloading
- 📥 UTF-8 `.txt` download
- ⏱ Optional segment timestamps
- ⚙️ Configurable model size, beam search, VAD, compute type
- 🔒 100% local — audio never leaves your machine

---

## Prerequisites

| Tool | Required version | Download |
|------|-----------------|---------|
| Python | 3.10 – 3.12 | https://www.python.org/downloads/ |
| Node.js | 18 + | https://nodejs.org/ |
| FFmpeg | any recent | https://ffmpeg.org/download.html |

### Install FFmpeg on Windows

**Option A – winget (recommended)**
```powershell
winget install Gyan.FFmpeg
```

**Option B – Chocolatey**
```powershell
choco install ffmpeg
```

**Option C – Manual**
1. Download the *essentials* build from https://www.gyan.dev/ffmpeg/builds/
2. Extract the zip and copy `ffmpeg.exe`, `ffplay.exe`, `ffprobe.exe` into `C:\Windows\System32\` (or any folder on your PATH).

Verify:
```powershell
ffmpeg -version
```

---

## Installation

### 1. Backend (Python)

```powershell
# From the project root
cd audio-transcriber\backend

# Create a virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt
```

> **Note:** `faster-whisper` will automatically download the `large-v3` model (~1.5 GB) from Hugging Face the first time you run a transcription. Subsequent runs reuse the cached model.

### 2. Frontend (Node)

```powershell
cd audio-transcriber\frontend
npm install
```

---

## Running the App

### Start the backend (in one terminal)

```powershell
cd audio-transcriber\backend
.venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Start the frontend (in a second terminal)

```powershell
cd audio-transcriber\frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## GPU Configuration (NVIDIA only)

By default the backend runs on CPU with `int8` quantisation.

To use an NVIDIA GPU:
1. Install the CUDA-compatible PyTorch:
   ```powershell
   pip install torch --index-url https://download.pytorch.org/whl/cu121
   ```
2. In `backend/main.py`, find:
   ```python
   device="cpu",  # change to "cuda" for GPU
   ```
   and change it to:
   ```python
   device="cuda",
   ```
3. Set **Compute Type** to `float16` in the app's Advanced Settings.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Backend status |
| GET | `/api/languages` | Supported languages |
| POST | `/api/transcribe` | Submit transcription job |
| GET | `/api/transcribe/{job_id}` | Poll job status / fetch transcript |

---

## Transcription Parameters

| Parameter | Default | Notes |
|-----------|---------|-------|
| Model | `large-v3` | Best accuracy; `medium` or `small` for speed |
| Compute type | `int8` | CPU-optimised; use `float16` on GPU |
| Beam size | 5 | Higher = more accurate, slower |
| VAD filter | on | Skips silent regions automatically |
| Timestamps | off | Prepends `[HH:MM:SS → HH:MM:SS]` per segment |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `ffmpeg not found` | Install FFmpeg and restart your terminal |
| `CUDA out of memory` | Switch compute type to `int8` or use a smaller model |
| Backend shows "Offline" | Make sure uvicorn is running on port 8000 |
| No transcript / empty output | The audio may contain no speech; try disabling VAD |
| Garbled output | Select the correct language manually instead of auto-detect |
| Model download fails | Check internet connection; files are cached in `~/.cache/huggingface/` |
| PowerShell execution policy error | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

---

## Project Structure

```
audio-transcriber/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── AudioUpload.tsx       # Drag-and-drop uploader
│   │   │   ├── LanguageSelector.tsx  # Searchable language dropdown
│   │   │   ├── StatusPanel.tsx       # Job status + backend health
│   │   │   └── TranscriptViewer.tsx  # Editable transcript + download
│   │   ├── services/
│   │   │   └── api.ts                # Axios API client
│   │   ├── App.tsx                   # Main app + state
│   │   ├── main.tsx                  # React entry point
│   │   └── index.css                 # Tailwind + global styles
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
├── backend/
│   ├── main.py                       # FastAPI app + job registry
│   ├── transcription.py              # faster-whisper wrapper
│   └── requirements.txt
├── .gitignore
└── README.md
```

---

## License

MIT
