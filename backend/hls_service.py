import asyncio
import os
import re
import secrets
from pathlib import Path
from fastapi import HTTPException, Request
from fastapi.responses import Response, StreamingResponse
import main

HLS_ROOT = Path(os.getenv("HLS_CACHE_DIR", "/tmp/quantxdrive-hls"))
HLS_ROOT.mkdir(parents=True, exist_ok=True)
PREPARE_TASKS = {}
PREPARE_FAILED = set()
PREPARE_LOCKS_GUARD = asyncio.Lock()
FFMPEG_LOCK = asyncio.Lock()
FFMPEG_PATH = None
HLS_ENCODE_SEMAPHORE = asyncio.Semaphore(1)
HLS_PROXY_SECRET = os.getenv("HLS_PROXY_SECRET") or secrets.token_urlsafe(32)
HLS_PROXY_PORT = int(os.getenv("PORT", "8000"))
TG_CHUNK_SIZE = 1024 * 1024
FFMPEG_BINARY = Path(__file__).resolve().parent / ".render-ffmpeg" / "ffmpeg"
FFMPEG_BOOTSTRAP = Path(__file__).resolve().parent / "ensure_render_ffmpeg.sh"

VARIANTS = [
    ("v0", 256, 144, "96k", "120k", "200k", "24k"),
    ("v1", 426, 240, "180k", "220k", "360k", "32k"),
    ("v2", 640, 360, "400k", "480k", "720k", "48k"),
    ("v3", 854, 480, "650k", "800k", "1200k", "64k"),
    ("v4", 1280, 720, "1400k", "1800k", "2400k", "96k"),
    ("v5", 1920, 1080, "2800k", "3500k", "5000k", "128k"),
    ("v6", 2560, 1440, "5000k", "6500k", "8500k", "128k"),
    ("v7", 3840, 2160, "9000k", "12000k", "16000k", "160k"),
]
QUALITY_BY_ID = {x[0]: x for x in VARIANTS}


def _source_max_height(file: dict) -> int:
    filename = str(file.get("filename") or "")
    matches = re.findall(r"(?<!\d)(2160|1440|1080|720|576|540|480|360|240|144)p(?!\d)", filename.lower())
    return max(map(int, matches)) if matches else 2160


def _supported_variants(file: dict):
    return [x for x in VARIANTS if x[2] <= _source_max_height(file)]


async def _ffmpeg_supports_range_options(binary: str) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(binary, "-hide_banner", "-h", "protocol=http", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        output, _ = await proc.communicate()
        text = output.decode("utf-8", "ignore")
        return proc.returncode == 0 and all(x in text for x in ("request_size", "initial_request_size", "short_seek_size"))
    except Exception:
        return False


async def _bootstrap_ffmpeg() -> None:
    if not FFMPEG_BOOTSTRAP.is_file():
        raise RuntimeError(f"FFmpeg bootstrap script not found: {FFMPEG_BOOTSTRAP}")
    proc = await asyncio.create_subprocess_exec("bash", str(FFMPEG_BOOTSTRAP), cwd=str(FFMPEG_BOOTSTRAP.parent), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
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
        bundled = str(FFMPEG_BINARY)
        if not FFMPEG_BINARY.is_file() or not os.access(bundled, os.X_OK):
            await _bootstrap_ffmpeg()
        if not FFMPEG_BINARY.is_file():
            raise RuntimeError(f"Bundled Render FFmpeg not found: {bundled}")
        if not os.access(bundled, os.X_OK):
            raise RuntimeError(f"Bundled Render FFmpeg is not executable: {bundled}")
        if not await _ffmpeg_supports_range_options(bundled):
            raise RuntimeError(f"Bundled Render FFmpeg lacks required HTTP range options: {bundled}")
        FFMPEG_PATH = bundled
        print(f"🎬 Using bundled Render FFmpeg: {FFMPEG_PATH}", flush=True)
        return FFMPEG_PATH


def _dir(file_id: int) -> Path:
    return HLS_ROOT / str(file_id)


def _master_path(file_id: int) -> Path:
    return _dir(file_id) / "master.m3u8"


def _task_key(file_id: int, variant: str):
    return file_id, variant


def _available_variants(file_id: int):
    root = _dir(file_id)
    return [x for x in VARIANTS if (root / x[0] / "playlist.m3u8").is_file() and any((root / x[0]).glob("seg_*.ts"))]


def _master_is_valid(file_id: int) -> bool:
    master = _master_path(file_id)
    available = _available_variants(file_id)
    if not master.is_file() or not available:
        return False
    try:
        text = master.read_text(encoding="utf-8")
    except Exception:
        return False
    return "#EXTM3U" in text and all(f"{x[0]}/playlist.m3u8" in text for x in available)


def _task_done(key, task: asyncio.Task):
    PREPARE_TASKS.pop(key, None)
    try:
        task.result()
        PREPARE_FAILED.discard(key)
    except asyncio.CancelledError:
        PREPARE_FAILED.add(key)
        print(f"⚠️ HLS preparation cancelled for file {key[0]} quality {key[1]}", flush=True)
    except Exception as exc:
        PREPARE_FAILED.add(key)
        print(f"❌ HLS preparation failed for file {key[0]} quality {key[1]}: {exc}", flush=True)


async def _start_variant(file_id: int, variant_name: str):
    file = await main.db.get_file_by_id(file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    supported = {x[0] for x in _supported_variants(file)}
    if variant_name not in supported:
        raise HTTPException(status_code=400, detail="Requested quality is higher than the source video")
    root = _dir(file_id) / variant_name
    if (root / "playlist.m3u8").is_file() and any(root.glob("seg_*.ts")):
        return True
    key = _task_key(file_id, variant_name)
    async with PREPARE_LOCKS_GUARD:
        old = PREPARE_TASKS.get(key)
        if old and not old.done():
            return False
        PREPARE_FAILED.discard(key)
        task = asyncio.create_task(_prepare_variant(file_id, file, variant_name))
        PREPARE_TASKS[key] = task
        task.add_done_callback(lambda t, k=key: _task_done(k, t))
    print(f"🚀 HLS {variant_name} preparation started for file {file_id}", flush=True)
    return False


def _bitrate_to_int(value: str) -> int:
    text = str(value).strip().lower()
    if text.endswith("k"):
        return int(float(text[:-1]) * 1000)
    if text.endswith("m"):
        return int(float(text[:-1]) * 1000000)
    return int(float(text))


async def _write_master_for_file(file_id: int):
    out_dir = _dir(file_id)
    available = _available_variants(file_id)
    if not available:
        return
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for name, width, height, _, maxrate, _, audio in available:
        bandwidth = _bitrate_to_int(maxrate) + _bitrate_to_int(audio)
        lines += [f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},AVERAGE-BANDWIDTH={bandwidth},RESOLUTION={width}x{height}", f"{name}/playlist.m3u8"]
    tmp = out_dir / "master.m3u8.tmp"
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    tmp.replace(out_dir / "master.m3u8")


async def _prepare_variant(file_id: int, file: dict, variant_name: str):
    variant = QUALITY_BY_ID[variant_name]
    out_dir = _dir(file_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    source_url = f"http://127.0.0.1:{HLS_PROXY_PORT}/internal/hls-source/{file_id}?key={HLS_PROXY_SECRET}"

    async with HLS_ENCODE_SEMAPHORE:
        proc, playlist = await _encode_variant(source_url, str(file_id), out_dir, variant, live=True)
        if not playlist.exists() or not any((out_dir / variant_name).glob("seg_*.ts")):
            raise RuntimeError(f"ffmpeg {variant_name} produced no playable HLS segment")
        await _write_master_for_file(file_id)
        print(f"⚡ HLS first segment ready for {variant_name} on file {file_id}", flush=True)
        if proc:
            _, err = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"ffmpeg {variant_name} failed ({proc.returncode}): {err.decode('utf-8', 'ignore')[-10000:]}")
            await _write_master_for_file(file_id)
            print(f"⚡ HLS {variant_name} completed for file {file_id}", flush=True)


async def _encode_variant(source_url: str, source_label: str, out_dir: Path, variant, live=False):
    name, width, height, video_bitrate, maxrate, bufsize, audio_bitrate = variant
    variant_dir = out_dir / name
    variant_dir.mkdir(parents=True, exist_ok=True)
    playlist = variant_dir / "playlist.m3u8"
    segment_pattern = variant_dir / "seg_%05d.ts"
    ffmpeg = await _ensure_ffmpeg()
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "warning",
        "-threads", "0", "-filter_threads", "0", "-filter_complex_threads", "0",
        "-seekable", "1", "-multiple_requests", "1", "-request_size", "4194304",
        "-initial_request_size", "2097152", "-short_seek_size", "4194304",
        "-reconnect", "1", "-reconnect_on_network_error", "1", "-reconnect_streamed", "1",
        "-reconnect_max_retries", "20", "-reconnect_delay_max", "2", "-rw_timeout", "60000000",
        "-i", source_url, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264",
        "-preset", "ultrafast", "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-sc_threshold", "0", "-r", "24", "-g", "48", "-keyint_min", "48",
        "-force_key_frames", "expr:gte(t,n_forced*2)",
        "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2",
        "-b:v", video_bitrate, "-maxrate", maxrate, "-bufsize", bufsize,
        "-c:a", "aac", "-ar", "44100", "-b:a", audio_bitrate, "-ac", "2",
        "-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
        "-hls_flags", "independent_segments", "-hls_segment_filename", str(segment_pattern),
        "-hls_playlist_type", "event", str(playlist),
    ]
    print(f"🎞️ HLS encoding {name} from seekable Telegram HTTP source {source_label}", flush=True)
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    if live:
        for _ in range(480):
            if playlist.exists() and any(variant_dir.glob("seg_*.ts")):
                print(f"⚡ HLS first segment ready for {name}", flush=True)
                return proc, playlist
            if proc.returncode is not None:
                break
            await asyncio.sleep(0.25)
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg {name} failed ({proc.returncode}): {stderr.decode('utf-8', 'ignore')[-10000:]}")
    if not playlist.exists():
        raise RuntimeError(f"ffmpeg {name} produced no playlist")
    return None, playlist


async def prepare_hls(file_id: int):
    file = await main.db.get_file_by_id(file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    mime = file.get("mime") or main.get_mime(file.get("filename", ""))
    if not mime.startswith("video/"):
        raise HTTPException(status_code=400, detail="HLS is available only for videos")
    _dir(file_id).mkdir(parents=True, exist_ok=True)
    await _start_variant(file_id, "v0")
    return file


def _hls_response(path: Path, media_type: str) -> Response:
    body = path.read_bytes()
    return Response(content=body, media_type=media_type, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Content-Length": str(len(body)), "Accept-Ranges": "none"})


def _parse_single_range(range_header: str, size: int):
    if not range_header or not range_header.startswith("bytes="):
        return None
    value = range_header[6:].strip()
    if not value or "," in value:
        raise HTTPException(status_code=416, detail="Only a single byte range is supported")
    left, _, right = value.partition("-")
    try:
        if not left:
            suffix = int(right)
            if suffix <= 0:
                raise ValueError
            start = max(0, size - suffix)
            end = size - 1
        else:
            start = int(left)
            end = int(right) if right else size - 1
    except (TypeError, ValueError):
        raise HTTPException(status_code=416, detail="Invalid byte range")
    if start < 0 or start >= size or end < start:
        raise HTTPException(status_code=416, detail="Range not satisfiable")
    return start, min(end, size - 1)


async def _proxy_range_response(file: dict, request: Request, head_only: bool = False):
    file_size = int(file.get("size") or 0)
    if file_size <= 0:
        raise HTTPException(status_code=416, detail="Unknown source size")
    range_header = request.headers.get("range") or request.headers.get("Range")
    parsed = _parse_single_range(range_header, file_size) if range_header else None
    start, end = parsed if parsed else (0, file_size - 1)
    length = end - start + 1
    mime = file.get("mime") or main.get_mime(file.get("filename", ""))
    headers = {"Content-Type": mime, "Accept-Ranges": "bytes", "Content-Length": str(length), "Content-Range": f"bytes {start}-{end}/{file_size}" if parsed else f"bytes 0-{file_size - 1}/{file_size}", "Cache-Control": "no-store"}
    if head_only:
        return Response(status_code=206 if parsed else 200, headers=headers, media_type=mime)
    chunk_offset = start // TG_CHUNK_SIZE
    first_cut = start - chunk_offset * TG_CHUNK_SIZE
    last_cut = (end % TG_CHUNK_SIZE) + 1
    chunk_count = ((end // TG_CHUNK_SIZE) - chunk_offset) + 1
    async def generator():
        current = 0
        async for chunk in main._stream_media_with_refresh(file, offset=chunk_offset, limit=chunk_count):
            if not chunk:
                break
            if chunk_count == 1:
                piece = chunk[first_cut:last_cut]
            elif current == 0:
                piece = chunk[first_cut:]
            elif current == chunk_count - 1:
                piece = chunk[:last_cut]
            else:
                piece = chunk
            if piece:
                yield piece
            current += 1
    status = 206 if parsed else 200
    print(f"🔎 HLS proxy file={file.get('id')} range={start}-{end} len={length} telegram_chunks={chunk_count}", flush=True)
    return StreamingResponse(generator(), status_code=status, headers=headers, media_type=mime)


def register_hls_routes(app):
    @app.api_route("/internal/hls-source/{file_id}", methods=["GET", "HEAD"])
    async def hls_source_proxy(file_id: int, request: Request, key: str = ""):
        client_host = request.client.host if request.client else ""
        if client_host not in {"127.0.0.1", "::1", "localhost"} or not secrets.compare_digest(key, HLS_PROXY_SECRET):
            raise HTTPException(status_code=404, detail="Not found")
        file = await main.db.get_file_by_id(file_id)
        if not file:
            raise HTTPException(status_code=404, detail="File not found")
        if not (file.get("mime") or main.get_mime(file.get("filename", ""))).startswith("video/"):
            raise HTTPException(status_code=400, detail="Source is not a video")
        return await _proxy_range_response(file, request, head_only=request.method == "HEAD")

    @app.get("/api/hls/{token}/{file_id}/master.m3u8")
    async def hls_master(token: str, file_id: int):
        if not main.verify_jwt(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        file = await main.db.get_file_by_id(file_id)
        if not file:
            raise HTTPException(status_code=404, detail="File not found")
        await prepare_hls(file_id)
        master = _master_path(file_id)
        if not master.is_file():
            raise HTTPException(status_code=425, detail="HLS is still preparing")
        return _hls_response(master, "application/vnd.apple.mpegurl")

    @app.get("/api/hls/{token}/{file_id}/{variant}/{asset}")
    async def hls_asset(token: str, file_id: int, variant: str, asset: str):
        if not main.verify_jwt(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        if variant not in QUALITY_BY_ID or "/" in asset or "\\" in asset or asset.startswith("."):
            raise HTTPException(status_code=404, detail="HLS asset not found")
        file = await main.db.get_file_by_id(file_id)
        if not file:
            raise HTTPException(status_code=404, detail="File not found")
        if variant not in {x[0] for x in _supported_variants(file)}:
            raise HTTPException(status_code=404, detail="HLS quality not supported for this source")
        candidate = _dir(file_id) / variant / asset
        if not candidate.exists() or not candidate.is_file():
            await _start_variant(file_id, variant)
            raise HTTPException(status_code=425, detail="Quality is still preparing")
        media = "application/vnd.apple.mpegurl" if candidate.suffix == ".m3u8" else "video/mp2t"
        return _hls_response(candidate, media)

    @app.get("/api/hls/{token}/{file_id}/status")
    async def hls_status(token: str, file_id: int, quality: str = ""):
        if not main.verify_jwt(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        file = await main.db.get_file_by_id(file_id)
        if not file:
            raise HTTPException(status_code=404, detail="File not found")
        supported = [x[0] for x in _supported_variants(file)]
        if "v0" in supported:
            await _start_variant(file_id, "v0")
        if quality:
            if quality not in supported:
                raise HTTPException(status_code=400, detail="Requested quality is higher than the source video")
            await _start_variant(file_id, quality)
        available = [x[0] for x in _available_variants(file_id) if x[0] in supported]
        task_keys = [_task_key(file_id, q) for q in supported]
        preparing = any(k in PREPARE_TASKS and not PREPARE_TASKS[k].done() for k in task_keys)
        failed = _task_key(file_id, quality) in PREPARE_FAILED if quality else False
        return {"ready": bool(available), "preparing": preparing, "failed": failed, "qualities": available, "supported": supported}
