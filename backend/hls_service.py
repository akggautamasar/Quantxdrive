import asyncio
import os
import shutil
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import FileResponse

import main

HLS_ROOT = Path(os.getenv("HLS_CACHE_DIR", "/tmp/quantxdrive-hls"))
HLS_ROOT.mkdir(parents=True, exist_ok=True)
PREPARE_LOCKS = {}
PREPARE_LOCKS_GUARD = asyncio.Lock()
MAX_HLS_SOURCE_BYTES = int(os.getenv("HLS_MAX_SOURCE_BYTES", str(2 * 1024 * 1024 * 1024)))


def _dir(file_id: int) -> Path:
    return HLS_ROOT / str(file_id)


def _master_path(file_id: int) -> Path:
    return _dir(file_id) / "master.m3u8"


async def _lock_for(file_id: int):
    async with PREPARE_LOCKS_GUARD:
        return PREPARE_LOCKS.setdefault(file_id, asyncio.Lock())


async def _write_telegram_to_pipe(file: dict, pipe):
    try:
        async for chunk in main._stream_media_with_refresh(file):
            if chunk:
                pipe.write(chunk)
                await pipe.drain()
        pipe.close()
        try:
            await pipe.wait_closed()
        except Exception:
            pass
    except Exception:
        try:
            pipe.close()
        except Exception:
            pass
        raise


async def _run_ffmpeg(file: dict, out_dir: Path):
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-i", "pipe:0",
        "-filter_complex", "[0:v:0]split=3[v144][v240][v360]",
        "-map", "[v144]", "-map", "0:a:0?",
        "-map", "[v240]", "-map", "0:a:0?",
        "-map", "[v360]", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main",
        "-sc_threshold", "0", "-g", "96", "-keyint_min", "96",
        "-force_key_frames", "expr:gte(t,n_forced*4)",
        "-s:v:0", "256x144", "-b:v:0", "120k", "-maxrate:v:0", "150k", "-bufsize:v:0", "240k",
        "-s:v:1", "426x240", "-b:v:1", "220k", "-maxrate:v:1", "280k", "-bufsize:v:1", "440k",
        "-s:v:2", "640x360", "-b:v:2", "450k", "-maxrate:v:2", "550k", "-bufsize:v:2", "900k",
        "-c:a", "aac", "-ar", "44100", "-b:a:0", "32k", "-b:a:1", "48k", "-b:a:2", "64k", "-ac", "2",
        "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments", "-master_pl_name", "master.m3u8",
        "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2",
        "-hls_segment_filename", str(out_dir / "v%v" / "seg_%05d.ts"),
        str(out_dir / "v%v" / "playlist.m3u8"),
    ]
    for i in range(3):
        (out_dir / f"v{i}").mkdir(parents=True, exist_ok=True)

    proc = await asyncio.create_subprocess_exec(
        *cmd, stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    feeder = asyncio.create_task(_write_telegram_to_pipe(file, proc.stdin))
    try:
        _, stderr = await asyncio.gather(proc.wait(), proc.stderr.read())
    finally:
        if not feeder.done():
            feeder.cancel()
            try:
                await feeder
            except asyncio.CancelledError:
                pass
    if proc.returncode != 0:
        detail = stderr.decode("utf-8", "ignore")[-4000:]
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {detail}")
    if not (out_dir / "master.m3u8").exists():
        raise RuntimeError("ffmpeg completed without an HLS master playlist")


async def prepare_hls(file_id: int):
    file = await main.db.get_file_by_id(file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    mime = file.get("mime") or main.get_mime(file.get("filename", ""))
    if not mime.startswith("video/"):
        raise HTTPException(status_code=400, detail="HLS is available only for videos")
    size = int(file.get("size") or 0)
    if size and size > MAX_HLS_SOURCE_BYTES:
        raise HTTPException(status_code=413, detail="Video is too large for on-demand HLS preparation")

    master = _master_path(file_id)
    if master.exists():
        return file

    lock = await _lock_for(file_id)
    async with lock:
        if master.exists():
            return file
        out_dir = _dir(file_id)
        tmp_dir = HLS_ROOT / f".{file_id}.building"
        shutil.rmtree(tmp_dir, ignore_errors=True)
        tmp_dir.mkdir(parents=True, exist_ok=True)
        try:
            await _run_ffmpeg(file, tmp_dir)
            shutil.rmtree(out_dir, ignore_errors=True)
            tmp_dir.rename(out_dir)
        except Exception:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise
    return file


def register_hls_routes(app):
    @app.get("/api/hls/{token}/{file_id}/master.m3u8")
    async def hls_master(token: str, file_id: int):
        if not main.verify_jwt(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        try:
            await prepare_hls(file_id)
        except HTTPException:
            raise
        except Exception as exc:
            print(f"HLS preparation failed for {file_id}: {exc}")
            raise HTTPException(status_code=502, detail="Could not prepare video for adaptive streaming")
        return FileResponse(_master_path(file_id), media_type="application/vnd.apple.mpegurl", headers={"Cache-Control": "public, max-age=3600"})

    @app.get("/api/hls/{token}/{file_id}/{variant}/{asset}")
    async def hls_asset(token: str, file_id: int, variant: str, asset: str):
        if not main.verify_jwt(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        if variant not in {"v0", "v1", "v2"} or "/" in asset or "\\" in asset or asset.startswith("."):
            raise HTTPException(status_code=404, detail="HLS asset not found")
        await prepare_hls(file_id)
        candidate = _dir(file_id) / variant / asset
        if not candidate.exists() or not candidate.is_file():
            raise HTTPException(status_code=404, detail="HLS asset not found")
        media = "application/vnd.apple.mpegurl" if candidate.suffix == ".m3u8" else "video/mp2t"
        return FileResponse(candidate, media_type=media, headers={"Cache-Control": "public, max-age=3600"})

    @app.get("/api/hls/{token}/{file_id}/status")
    async def hls_status(token: str, file_id: int):
        if not main.verify_jwt(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        return {"ready": _master_path(file_id).exists()}
