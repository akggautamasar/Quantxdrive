from fastapi import FastAPI, HTTPException, Depends, Request, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pyrogram import Client
import os, math, jwt, mimetypes
from datetime import datetime, timedelta
from typing import Optional, AsyncGenerator
from contextlib import asynccontextmanager
from urllib.parse import quote
from dotenv import load_dotenv
import db

load_dotenv()

API_ID         = int(os.getenv("API_ID", "26182818"))
API_HASH       = os.getenv("API_HASH", "e98cc55fabed0fce53269188fa3a0e63")
JWT_SECRET     = os.getenv("JWT_SECRET", "airdrive_secret_change_this")
APP_PASSWORD   = os.getenv("APP_PASSWORD", "Airlocked@6279")
SESSION_STRING = os.getenv("SESSION_STRING", "")

CHANNELS = {
    "call_recordings": -1004274179262,
    "word_excel":      -1003999074582,
    "other_files":     -1004237723796,
    "photos":          -1004291403787,
    "videos":          -1003982372929,
    "pdfs":            -1003416055978,
    "audio":           -1003935949819,
}

MIME_MAP = {
    '.mp4':'video/mp4','.mkv':'video/x-matroska','.webm':'video/webm','.mov':'video/quicktime',
    '.m4v':'video/mp4','.avi':'video/x-msvideo','.3gp':'video/3gpp',
    '.mp3':'audio/mpeg','.wav':'audio/wav','.flac':'audio/flac','.aac':'audio/aac',
    '.ogg':'audio/ogg','.m4a':'audio/mp4','.opus':'audio/ogg',
    '.pdf':'application/pdf','.epub':'application/epub+zip',
    '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp',
}

def get_mime(filename):
    ext = os.path.splitext(filename.lower())[1]
    return MIME_MAP.get(ext) or mimetypes.guess_type(filename)[0] or "application/octet-stream"

pyro_client: Optional[Client] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global pyro_client
    print("🚀 Starting AirDrive...")
    pyro_client = Client(name="airdrive_render", api_id=API_ID, api_hash=API_HASH, session_string=SESSION_STRING)
    await pyro_client.start()
    print("✅ Pyrogram client started")
    print("🔄 Populating peer cache...")
    try:
        count = 0
        async for _ in pyro_client.get_dialogs():
            count += 1
        print(f"✅ Loaded {count} dialogs")
    except Exception as e:
        print(f"⚠️  get_dialogs failed: {e}")
    await db.load_index(pyro_client)
    yield
    await pyro_client.stop()

app = FastAPI(title="AirDrive API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Range", "Accept-Ranges"],
)
security = HTTPBearer(auto_error=False)

def create_token(days=30):
    return jwt.encode({"exp": datetime.utcnow() + timedelta(days=days), "iat": datetime.utcnow()}, JWT_SECRET, algorithm="HS256")

def verify_jwt(token: str):
    try:
        jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return True
    except:
        return False

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials or not verify_jwt(credentials.credentials):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return True

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
async def health():
    return {"status": "AirDrive API running"}

@app.post("/api/login")
async def login(body: dict):
    if body.get("password") != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password")
    return {"token": create_token()}

@app.get("/api/resolve")
async def resolve():
    results = {}
    for cid in list(CHANNELS.values()) + [db.INDEX_CHANNEL_ID]:
        try:
            chat = await pyro_client.get_chat(cid)
            results[str(cid)] = chat.title
        except Exception as e:
            results[str(cid)] = f"ERROR: {e}"
    return results

@app.post("/api/sync")
async def sync_channel(category: str, _: bool = Depends(verify_token)):
    if category not in CHANNELS:
        raise HTTPException(status_code=400, detail="Unknown category")
    channel_id = CHANNELS[category]
    count = 0
    async for message in pyro_client.get_chat_history(channel_id):
        doc = message.document or message.video or message.audio
        photo = message.photo
        if not doc and not photo:
            continue
        if doc:
            filename = doc.file_name or f"file_{message.id}"
            size, file_id, mime = doc.file_size or 0, doc.file_id, doc.mime_type or get_mime(filename)
        else:
            filename = f"photo_{message.id}.jpg"
            size, file_id, mime = photo.file_size or 0, photo.file_id, "image/jpeg"
        await db.upsert_file({"message_id": message.id, "channel_id": channel_id, "category": category,
                               "filename": filename, "file_id": file_id, "size": size, "mime": mime,
                               "date": message.date.isoformat() if message.date else "", "caption": message.caption or ""})
        count += 1
    return {"synced": count, "category": category}

@app.post("/api/sync/all")
async def sync_all(_: bool = Depends(verify_token)):
    results = {}
    for category in CHANNELS:
        try:
            res = await sync_channel(category)
            results[category] = res["synced"]
        except Exception as e:
            results[category] = f"error: {str(e)}"
    await db.save_index(pyro_client)
    return results

@app.get("/api/files")
async def list_files(category: Optional[str] = None, q: Optional[str] = None, page: int = 1, limit: int = 50, _: bool = Depends(verify_token)):
    offset = (page - 1) * limit
    files, total = await (db.search_files(q, category, limit, offset) if q else db.get_files(category, limit, offset))
    return {"files": files, "total": total, "page": page, "pages": -(-total // limit)}

@app.get("/api/stats")
async def stats(_: bool = Depends(verify_token)):
    return await db.get_stats()

# ── Token-based media streaming (works with <img>, <video>, <audio>) ─────────

@app.get("/api/media/{token}/{file_db_id}")
async def media_stream(token: str, file_db_id: int, request: Request):
    """Stream files via URL token — works for <img>, <video>, <audio>, <iframe> tags."""
    if not verify_jwt(token):
        raise HTTPException(status_code=401, detail="Invalid token")

    file = await db.get_file_by_id(file_db_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    file_size = file.get("size", 0)
    mime_type = file.get("mime") or get_mime(file["filename"])
    range_header = request.headers.get("range") or request.headers.get("Range")

    # Parse range request
    start, end = 0, file_size - 1
    if range_header and range_header.startswith("bytes="):
        try:
            range_spec = range_header[6:]
            if range_spec.startswith("-"):
                start = max(0, file_size - int(range_spec[1:]))
            elif range_spec.endswith("-"):
                start = int(range_spec[:-1])
            else:
                parts = range_spec.split("-", 1)
                start = int(parts[0])
                if parts[1]:
                    end = int(parts[1])
        except:
            pass

    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))

    # Calculate chunk parameters
    chunk_size = 1024 * 1024
    offset = start - (start % chunk_size)
    first_cut = start - offset
    last_cut = (end % chunk_size) + 1
    part_count = math.ceil((end + 1) / chunk_size) - math.floor(offset / chunk_size)
    content_length = end - start + 1

    async def generator():
        chunk_offset = offset // chunk_size
        current = 1
        try:
            async for chunk in pyro_client.stream_media(file["file_id"], offset=chunk_offset, limit=part_count):
                if not chunk:
                    break
                if part_count == 1:
                    yield chunk[first_cut:last_cut]
                elif current == 1:
                    yield chunk[first_cut:]
                elif current == part_count:
                    yield chunk[:last_cut]
                else:
                    yield chunk
                current += 1
        except Exception as e:
            print(f"Stream error: {e}")

    is_range = bool(range_header)
    status = 206 if is_range else 200
    disposition = "inline" if any(x in mime_type for x in ["video/", "audio/", "image/", "pdf", "epub", "/html"]) else "attachment"

    headers = {
        "Content-Type": mime_type,
        "Content-Length": str(content_length),
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'{disposition}; filename="{quote(file["filename"])}"',
        "Cache-Control": "public, max-age=3600",
    }
    if is_range:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    return StreamingResponse(generator(), status_code=status, headers=headers, media_type=mime_type)

# Old endpoint kept for compat
@app.get("/api/stream/{file_db_id}")
async def stream_old(file_db_id: int, request: Request, _: bool = Depends(verify_token)):
    # Redirect to new endpoint with token in URL
    auth = request.headers.get("authorization", "").replace("Bearer ", "")
    return await media_stream(auth, file_db_id, request)

@app.get("/api/download/{file_db_id}")
async def download_old(file_db_id: int, request: Request, _: bool = Depends(verify_token)):
    auth = request.headers.get("authorization", "").replace("Bearer ", "")
    return await media_stream(auth, file_db_id, request)
