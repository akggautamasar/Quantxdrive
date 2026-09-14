import asyncio
import os
import re
import shutil
import secrets
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import Response, StreamingResponse

import main

HLS_ROOT = Path(os.getenv("HLS_CACHE_DIR", "/tmp/quantxdrive-hls"))
HLS_ROOT.mkdir(parents=True, exist_ok=True)
PREPARE_LOCKS = {}
PREPARE_TASKS = {}
PREPARE_FAILED = set()
PREPARE_LOCKS_GUARD = asyncio.Lock()
FFMPEG_LOCK = asyncio.Lock()
FFMPEG_PATH = None

HLS_V0_SEMAPHORE = asyncio.Semaphore(2)
HLS_UPGRADE_SEMAPHORE = asyncio.Semaphore(1)

HLS_PROXY_SECRET = os.getenv("HLS_PROXY_SECRET") or secrets.token_urlsafe(32)
HLS_PROXY_PORT = int(os.getenv("PORT", "8000"))
TG_CHUNK_SIZE = 1024 * 1024

# Render installs the known-good FFmpeg build here during the backend build.
# Do not fall back to the host/system FFmpeg: the HLS HTTP range options below
# are required for bounded Telegram range reads on low-bandwidth streaming.
FFMPEG_BINARY = Path(__file__).resolve().parent / ".render-ffmpeg" / "ffmpeg"
FFMPEG_BOOTSTRAP = Path(__file__).resolve().parent / "ensure_render_ffmpeg.sh"

VARIANTS = [
    ("v0", "256x144", "96k", "120k", "200k", "24k"),
    ("v1", "426x240", "180k", "220k", "360k", "32k"),
    ("v2", "640x360", "400k", "480k", "720k", "48k"),
]

async def _ffmpeg_supports_range_options(binary: str) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            binary, "-hide_banner", "-h", "protocol=http",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        output, _ = await proc.communicate()
        text = output.decode("utf-8", "ignore")
        required = ("request_size", "initial_request_size", "short_seek_size")
        return proc.returncode == 0 and all(option in text for option in required)
    except Exception:
        return False

async def _bootstrap_ffmpeg() -> None:
    """Provision the exact Render FFmpeg binary if Render did not run its build command."""
    if not FFMPEG_BOOTSTRAP.is_file():
        raise RuntimeError(f"FFmpeg bootstrap script not found: {FFMPEG_BOOTSTRAP}")
    print(f"🛠️ FFmpeg missing; bootstrapping bundled binary: {FFMPEG_BOOTSTRAP}", flush=True)
    proc = await asyncio.create_subprocess_exec(
        "bash", str(FFMPEG_BOOTSTRAP),
        cwd=str(FFMPEG_BOOTSTRAP.parent),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output, _ = await proc.communicate()
    text = output.decode("utf-8", "ignore").strip()
    if text:
        print(text, flush=True)
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg bootstrap failed with exit code {proc.returncode}")

async def _ensure_ffmpeg() -> str:
    global FFMPEG_PATH
    if FFMPEG_PATH:
        return FFMPEG_PATH
    async with FFMPEG_LOCK:
        if FFMPEG_PATH:
            return FFMPEG_PATH
        bundled_ffmpeg = str(FFMPEG_BINARY)
        # Render service configuration can lag behind render.yaml. Bootstrap at
        # first HLS use as a final safety net instead of silently using system FFmpeg.
        if not FFMPEG_BINARY.is_file() or not os.access(bundled_ffmpeg, os.X_OK):
            await _bootstrap_ffmpeg()
        if not FFMPEG_BINARY.is_file():
            raise RuntimeError(f"Bundled Render FFmpeg not found after bootstrap: {bundled_ffmpeg}")
        if not os.access(bundled_ffmpeg, os.X_OK):
            raise RuntimeError(f"Bundled Render FFmpeg is not executable: {bundled_ffmpeg}")
        if not await _ffmpeg_supports_range_options(bundled_ffmpeg):
            raise RuntimeError(
                f"Bundled Render FFmpeg lacks required HTTP range options: {bundled_ffmpeg}"
            )
        FFMPEG_PATH = bundled_ffmpeg
        print(f"🎬 Using bundled Render FFmpeg: {FFMPEG_PATH}", flush=True)
        return FFMPEG_PATH

def _dir(file_id: int) -> Path:
    return HLS_ROOT / str(file_id)

def _master_path(file_id: int) -> Path:
    return _dir(file_id) / "master.m3u8"

def _master_is_valid(file_id: int) -> bool:
    root = _dir(file_id)
    master = root / "master.m3u8"
    v0_dir = root / "v0"
    v0_playlist = v0_dir / "playlist.m3u8"
    if not master.is_file() or not v0_playlist.is_file() or not list(v0_dir.glob("seg_*.ts")):
        return False
    try:
        text = master.read_text(encoding="utf-8")
    except Exception:
        return False
    if "#EXTM3U" not in text or "v0/playlist.m3u8" not in text: