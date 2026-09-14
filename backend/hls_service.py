import asyncio
import os
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
HLS_JOB_SEMAPHORE = asyncio.Semaphore(1)
MAX_HLS_SOURCE_BYTES = int(os.getenv("HLS_MAX_SOURCE_BYTES", str(2 * 1024 * 1024 * 1024)))

# The streaming prototype deliberately avoids downloading the complete Telegram
# source. FFmpeg reads this local HTTP endpoint as a seekable resource and asks
# for only the byte ranges it needs. The secret is process-local and the route
# additionally accepts requests only from loopback.
HLS_PROXY_SECRET = os.getenv("HLS_PROXY_SECRET") or secrets.token_urlsafe(32)
HLS_PROXY_PORT = int(os.getenv("PORT", "8000"))
TG_CHUNK_SIZE = 1024 * 1024


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
    """Legacy full-download fallback for sources the proxy/FFmpeg path cannot parse."""
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
        print(f"✅ HLS source downloaded (fallback): file {file.get('id')} ({written} bytes)", flush=True)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


VARIANTS = [
    ("v0", "256x144", "96k", "120k", "200k", "24k"),
    ("v1", "426x240", "180k", "220k", "360k", "32k"),
    ("v2", "640x360", "400k", "480k", "720k", "48k"),
]


VARIANTS = [
    ("v0", "256x144", "96k", "120k", "200k", "24k"),
    ("v1", "426x240", "180k", "220k", "360k", "32k"),
    ("v2", "640x360", "400k", "480k", "720k", "48k"),
]

def _write_master(out_dir: Path, names):
    specs={name:(resolution,maxrate) for name,resolution,_,maxrate,_,_ in VARIANTS}
    lines=["#EXTM3U","#EXT-X-VERSION:3"]
    for name in names:
        resolution,bandwidth=specs[name]
        lines += [f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},AVERAGE-BANDWIDTH={bandwidth},RESOLUTION={resolution}",f"{name}/playlist.m3u8"]
    tmp=out_dir/"master.m3u8.tmp"
    tmp.write_text("\n".join(lines)+"\n",encoding="utf-8")
    tmp.replace(out_dir/"master.m3u8")

async def _encode_variant(source: Path, out_dir: Path, variant, live=False):
    name,resolution,video_bitrate,maxrate,bufsize,audio_bitrate=variant
    variant_dir=out_dir/name
    variant_dir.mkdir(parents=True,exist_ok=True)
    playlist=variant_dir/"playlist.m3u8"
    segment_pattern=variant_dir/"seg_%05d.ts"
    cmd=["ffmpeg","-hide_banner","-loglevel","error","-threads","1","-filter_threads","1","-filter_complex_threads","1","-i",str(source),"-map","0:v:0","-map","0:a:0?","-c:v","libx264","-preset","ultrafast","-profile:v","main","-pix_fmt","yuv420p","-sc_threshold","0","-r","24","-g","48","-keyint_min","48","-force_key_frames","expr:gte(t,n_forced*2)","-s:v",resolution,"-b:v",video_bitrate,"-maxrate",maxrate,"-bufsize",bufsize,"-c:a","aac","-ar","44100","-b:a",audio_bitrate,"-ac","2","-f","hls","-hls_time","2","-hls_list_size","0","-hls_flags","independent_segments","-hls_segment_filename",str(segment_pattern),"-hls_playlist_type","event" if live else "vod",str(playlist)]
    print(f"🎞️ HLS encoding {name} for source {source.name}",flush=True)
    proc=await asyncio.create_subprocess_exec(*cmd,stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.PIPE)
    if live:
        for _ in range(120):
            if playlist.exists() and list(variant_dir.glob("seg_*.ts")):
                print(f"⚡ HLS first segment ready for {name}",flush=True)
                return proc,playlist
            if proc.returncode is not None: break
            await asyncio.sleep(0.25)
    _,stderr=await proc.communicate()
    if proc.returncode!=0: raise RuntimeError(f"ffmpeg {name} failed ({proc.returncode}): {stderr.decode('utf-8','ignore')[-6000:]}")
    if not playlist.exists(): raise RuntimeError(f"ffmpeg {name} produced no playlist")
    return None,playlist

async def prepare_hls(file_id: int):
    file=await main.db.get_file_by_id(file_id)
    if not file: raise HTTPException(status_code=404,detail="File not found")
    mime=file.get("mime") or main.get_mime(file.get("filename",""))
    if not mime.startswith("video/"): raise HTTPException(status_code=400,detail="HLS is available only for videos")
    size=int(file.get("size") or 0)
    if size and size>MAX_HLS_SOURCE_BYTES: raise HTTPException(status_code=413,detail="Video is too large for on-demand HLS preparation")
    master=_master_path(file_id)
    if master.exists(): return file
    lock=await _lock_for(file_id)
    async with lock:
        if master.exists(): return file
        async with HLS_JOB_SEMAPHORE:
            out_dir=_dir(file_id); tmp_dir=HLS_ROOT/f".{file_id}.building"
            shutil.rmtree(tmp_dir,ignore_errors=True); shutil.rmtree(out_dir,ignore_errors=True); tmp_dir.mkdir(parents=True,exist_ok=True)
            suffix=Path(file.get("filename") or "video.mp4").suffix.lower() or ".mp4"
            source=tmp_dir/("source"+suffix)
            try:
                await _download_source(file,source)
                out_dir.mkdir(parents=True,exist_ok=True)
                proc0,_=await _encode_variant(source,out_dir,VARIANTS[0],live=True)
                _write_master(out_dir,["v0"])
                print(f"⚡ HLS low-bandwidth stream ready for file {file_id}",flush=True)
                if proc0:
                    _,err=await proc0.communicate()
                    if proc0.returncode!=0: raise RuntimeError(f"ffmpeg v0 failed ({proc0.returncode}): {err.decode('utf-8','ignore')[-6000:]}")
                await _encode_variant(source,out_dir,VARIANTS[1],live=False)
                _write_master(out_dir,["v0","v1"])
                print(f"⚡ HLS 240p available for file {file_id}",flush=True)
                await _encode_variant(source,out_dir,VARIANTS[2],live=False)
                _write_master(out_dir,["v0","v1","v2"])
                print(f"⚡ HLS 360p available for file {file_id}",flush=True)
                source.unlink(missing_ok=True); shutil.rmtree(tmp_dir,ignore_errors=True)
                print(f"✅ HLS ready for file {file_id}",flush=True)
                return file
            except Exception:
                source.unlink(missing_ok=True); shutil.rmtree(tmp_dir,ignore_errors=True)
                if not master.exists(): shutil.rmtree(out_dir,ignore_errors=True)
                raise
    return file

def _hls_response(path: Path, media_type: str) -> Response:
    body = path.read_bytes()
    return Response(
        content=body,
        media_type=media_type,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Length": str(len(body)),
            "Accept-Ranges": "none",
        },
    )


def _parse_single_range(range_header: str, size: int):
    if not range_header or not range_header.startswith("bytes="):
        return None
    value = range_header[6:].strip()
    if not value or "," in value:
        raise HTTPException(status_code=416, detail="Only a single byte range is supported")
    left, sep, right = value.partition("-")
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
    end = min(end, size - 1)
    return start, end


async def _proxy_range_response(file: dict, request: Request, head_only: bool = False):
    file_size = int(file.get("size") or 0)
    if file_size <= 0:
        raise HTTPException(status_code=416, detail="Unknown source size")

    range_header = request.headers.get("range") or request.headers.get("Range")
    parsed = _parse_single_range(range_header, file_size) if range_header else None
    start, end = parsed if parsed else (0, file_size - 1)
    length = end - start + 1
    mime = file.get("mime") or main.get_mime(file.get("filename", ""))

    headers = {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Content-Range": f"bytes {start}-{end}/{file_size}" if parsed else f"bytes 0-{file_size - 1}/{file_size}",
        "Cache-Control": "no-store",
    }

    if head_only:
        return Response(status_code=206 if parsed else 200, headers=headers, media_type=mime)

    # Pyrogram stream_media() works in 1 MiB chunks. Align the Telegram read to
    # those chunks and trim only the first/last chunk to the exact HTTP range.
    chunk_offset = start // TG_CHUNK_SIZE
    first_cut = start - (chunk_offset * TG_CHUNK_SIZE)
    last_cut = (end % TG_CHUNK_SIZE) + 1
    chunk_count = ((end // TG_CHUNK_SIZE) - chunk_offset) + 1

    async def generator():
        current = 0
        async for chunk in main._stream_media_with_refresh(
            file, offset=chunk_offset, limit=chunk_count
        ):
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
    print(
        f"🔎 HLS proxy file={file.get('id')} range={start}-{end} "
        f"len={length} telegram_chunks={chunk_count}",
        flush=True,
    )
    return StreamingResponse(generator(), status_code=status, headers=headers, media_type=mime)


def register_hls_routes(app):
    @app.api_route("/internal/hls-source/{file_id}", methods=["GET", "HEAD"])
    async def hls_source_proxy(file_id: int, request: Request, key: str = ""):
        """Loopback-only seekable HTTP view of a Telegram media file for FFmpeg."""
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
        if not main.verify_jwt(token): raise HTTPException(status_code=401,detail="Invalid token")
        file=await main.db.get_file_by_id(file_id)
        if not file: raise HTTPException(status_code=404,detail="File not found")
        master=_master_path(file_id)
        if not master.exists() and file_id not in PREPARE_FAILED:
            task=PREPARE_TASKS.get(file_id)
            if not task or task.done(): await _start_prepare(file_id)
        task=PREPARE_TASKS.get(file_id)
        available=[name for name,*_ in VARIANTS if (_dir(file_id)/name/"playlist.m3u8").exists()]
        ready=master.exists()
        if ready: PREPARE_FAILED.discard(file_id)
        return {"ready":ready,"preparing":bool(task and not task.done()),"failed":file_id in PREPARE_FAILED and not ready,"qualities":available}
