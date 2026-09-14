import asyncio
import os
import shutil
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import Response

import main

HLS_ROOT = Path(os.getenv("HLS_CACHE_DIR", "/tmp/quantxdrive-hls"))
HLS_ROOT.mkdir(parents=True, exist_ok=True)
PREPARE_LOCKS = {}
PREPARE_TASKS = {}
PREPARE_FAILED = set()
PREPARE_LOCKS_GUARD = asyncio.Lock()
MAX_HLS_SOURCE_BYTES = int(os.getenv("HLS_MAX_SOURCE_BYTES", str(2 * 1024 * 1024 * 1024)))


def _dir(file_id: int) -> Path:
    return HLS_ROOT / str(file_id)


def _master_path(file_id: int) -> Path:
    return _dir(file_id) / "master.m3u8"


async def _lock_for(file_id: int):
    async with PREPARE_LOCKS_GUARD:
        return PREPARE_LOCKS.setdefault(file_id, asyncio.Lock())


def _task_done(file_id: int, task: asyncio.Task):
    PREPARE_TASKS.pop(file_id, None)
    try:
        task.result()
        PREPARE_FAILED.discard(file_id)
    except asyncio.CancelledError:
        PREPARE_FAILED.add(file_id)
        print(f"⚠️ HLS preparation cancelled for file {file_id}", flush=True)
    except Exception as exc:
        PREPARE_FAILED.add(file_id)
        print(f"❌ HLS preparation failed for file {file_id}: {exc}", flush=True)


async def _start_prepare(file_id: int):
    """Start preparation without blocking the video request."""
    async with PREPARE_LOCKS_GUARD:
        if _master_path(file_id).exists():
            PREPARE_FAILED.discard(file_id)
            return True
        task = PREPARE_TASKS.get(file_id)
        if task and not task.done():
            return False
        PREPARE_FAILED.discard(file_id)
        task = asyncio.create_task(prepare_hls(file_id))
        PREPARE_TASKS[file_id] = task
        task.add_done_callback(lambda t, fid=file_id: _task_done(fid, t))
        print(f"🚀 HLS preparation started in background for file {file_id}", flush=True)
        return False


async def _download_source(file: dict, destination: Path):
    expected = int(file.get("size") or 0)
    tmp = destination.with_suffix(destination.suffix + ".part")
    tmp.unlink(missing_ok=True)
    written = 0
    try:
        with tmp.open("wb") as fh:
            async for chunk in main._stream_media_with_refresh(file):
                if chunk:
                    fh.write(chunk)
                    written += len(chunk)
        if expected and written != expected:
            raise RuntimeError(f"Telegram download incomplete: received {written} bytes, expected {expected}")
        tmp.replace(destination)
        print(f"✅ HLS source downloaded: file {file.get('id')} ({written} bytes)", flush=True)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def _write_master(out_dir: Path):
    variants = [("v0", 256, 144, 150000), ("v1", 426, 240, 280000), ("v2", 640, 360, 550000)]
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for name, width, height, bandwidth in variants:
        playlist = out_dir / name / "playlist.m3u8"
        if not playlist.exists():
            raise RuntimeError(f"missing HLS variant playlist: {name}")
        lines += [
            f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},AVERAGE-BANDWIDTH={bandwidth},RESOLUTION={width}x{height}",
            f"{name}/playlist.m3u8",
        ]
    (out_dir / "master.m3u8").write_text("\n".join(lines) + "\n", encoding="utf-8")


async def _run_ffmpeg(source: Path, out_dir: Path):
    for i in range(3):
        (out_dir / f"v{i}").mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(source),
        "-filter_complex", "[0:v:0]split=3[v144][v240][v360]",
        "-map", "[v144]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-sc_threshold", "0", "-g", "96", "-keyint_min", "96", "-force_key_frames", "expr:gte(t,n_forced*4)",
        "-s:v", "256x144", "-b:v", "120k", "-maxrate", "150k", "-bufsize", "240k", "-c:a", "aac", "-ar", "44100", "-b:a", "32k", "-ac", "2",
        "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments", "-hls_segment_filename", str(out_dir / "v0" / "seg_%05d.ts"), str(out_dir / "v0" / "playlist.m3u8"),
        "-map", "[v240]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-sc_threshold", "0", "-g", "96", "-keyint_min", "96", "-force_key_frames", "expr:gte(t,n_forced*4)",
        "-s:v", "426x240", "-b:v", "220k", "-maxrate", "280k", "-bufsize", "440k", "-c:a", "aac", "-ar", "44100", "-b:a", "48k", "-ac", "2",
        "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments", "-hls_segment_filename", str(out_dir / "v1" / "seg_%05d.ts"), str(out_dir / "v1" / "playlist.m3u8"),
        "-map", "[v360]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-sc_threshold", "0", "-g", "96", "-keyint_min", "96", "-force_key_frames", "expr:gte(t,n_forced*4)",
        "-s:v", "640x360", "-b:v", "450k", "-maxrate", "550k", "-bufsize", "900k", "-c:a", "aac", "-ar", "44100", "-b:a", "64k", "-ac", "2",
        "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments", "-hls_segment_filename", str(out_dir / "v2" / "seg_%05d.ts"), str(out_dir / "v2" / "playlist.m3u8"),
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {stderr.decode('utf-8', 'ignore')[-6000:]}")
    _write_master(out_dir)


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
        suffix = Path(file.get("filename") or "video.mp4").suffix.lower() or ".mp4"
        source = tmp_dir / ("source" + suffix)
        try:
            for attempt in range(1, 3):
                try:
                    await _download_source(file, source)
                    await _run_ffmpeg(source, tmp_dir)
                    source.unlink(missing_ok=True)
                    shutil.rmtree(out_dir, ignore_errors=True)
                    tmp_dir.rename(out_dir)
                    print(f"✅ HLS ready for file {file_id}", flush=True)
                    return file
                except Exception as exc:
                    source.unlink(missing_ok=True)
                    if attempt == 2:
                        raise
                    print(f"⚠️ HLS attempt {attempt}/2 failed for file {file_id}: {exc}", flush=True)
                    await asyncio.sleep(0.5)
        except Exception:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise
    return file


def _hls_response(path: Path, media_type: str) -> Response:
    body = path.read_bytes()
    return Response(content=body, media_type=media_type, headers={
        "Cache-Control": "public, max-age=3600",
        "Content-Length": str(len(body)),
        "Accept-Ranges": "none",
    })


def register_hls_routes(app):
    @app.get("/api/hls/{token}/{file_id}/master.m3u8")
    async def hls_master(token: str, file_id: int):
        if not main.verify_jwt(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        file = await main.db.get_file_by_id(file_id)
        if not file:
            raise HTTPException(status_code=404, detail="File not found")
        await _start_prepare(file_id)
        master = _master_path(file_id)
        if not master.is_file():
            raise HTTPException(status_code=425, detail="HLS is still preparing")
        return _hls_response(master, "application/vnd.apple.mpegurl")

    @app.get("/api/hls/{token}/{file_id}/{variant}/{asset}")
    async def hls_asset(token: str, file_id: int, variant: str, asset: str):
        if not main.verify_jwt(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        if variant not in {"v0", "v1", "v2"} or "/" in asset or "\\" in asset or asset.startswith("."):
            raise HTTPException(status_code=404, detail="HLS asset not found")
        if not _master_path(file_id).exists():
            await _start_prepare(file_id)
            raise HTTPException(status_code=425, detail="HLS is still preparing")
        candidate = _dir(file_id) / variant / asset
        if not candidate.exists() or not candidate.is_file():
            raise HTTPException(status_code=404, detail="HLS asset not found")
        media = "application/vnd.apple.mpegurl" if candidate.suffix == ".m3u8" else "video/mp2t"
        return _hls_response(candidate, media)

    @app.get("/api/hls/{token}/{file_id}/status")
    async def hls_status(token: str, file_id: int):
        if not main.verify_jwt(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        file = await main.db.get_file_by_id(file_id)
        if not file:
            raise HTTPException(status_code=404, detail="File not found")

        master = _master_path(file_id)
        if master.exists():
            PREPARE_FAILED.discard(file_id)
            return {"ready": True, "preparing": False, "failed": False}

        if file_id in PREPARE_FAILED:
            return {"ready": False, "preparing": False, "failed": True}

        task = PREPARE_TASKS.get(file_id)
        if not task or task.done():
            await _start_prepare(file_id)
            task = PREPARE_TASKS.get(file_id)

        return {
            "ready": master.exists(),
            "preparing": bool(task and not task.done()),
            "failed": file_id in PREPARE_FAILED,
        }
