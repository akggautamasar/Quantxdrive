from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pyrogram import Client
from pyrogram.errors import FloodWait
import asyncio
import os
import json
import jwt
import time
from datetime import datetime, timedelta
from typing import Optional, AsyncGenerator
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from db import init_db, get_files, search_files, get_file_by_id, upsert_file, get_stats

load_dotenv()

API_ID = int(os.getenv("API_ID", "26182818"))
API_HASH = os.getenv("API_HASH", "e98cc55fabed0fce53269188fa3a0e63")
JWT_SECRET = os.getenv("JWT_SECRET", "airdrive_secret_change_this")
APP_PASSWORD = os.getenv("APP_PASSWORD", "Airlocked@6279")
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

pyro_client: Optional[Client] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global pyro_client
    await init_db()
    pyro_client = Client(
        "airdrive_web",
        api_id=API_ID,
        api_hash=API_HASH,
        session_string=SESSION_STRING if SESSION_STRING else None,
    )
    await pyro_client.start()
    print("✅ Pyrogram client started")
    yield
    await pyro_client.stop()
    print("🛑 Pyrogram client stopped")

app = FastAPI(title="AirDrive API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

def create_token():
    payload = {"exp": datetime.utcnow() + timedelta(days=7), "iat": datetime.utcnow()}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    return True

# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/api/login")
async def login(body: dict):
    if body.get("password") != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password")
    return {"token": create_token()}

# ── Sync ──────────────────────────────────────────────────────────────────────

@app.post("/api/sync")
async def sync_channel(category: str, _: bool = Depends(verify_token)):
    if category not in CHANNELS:
        raise HTTPException(status_code=400, detail="Unknown category")

    channel_id = CHANNELS[category]
    count = 0

    async for message in pyro_client.get_chat_history(channel_id):
        if not message.document and not message.photo and not message.video and not message.audio:
            continue

        doc = message.document or message.video or message.audio
        filename = ""
        size = 0
        file_id = ""
        mime = ""

        if doc:
            filename = doc.file_name or f"file_{message.id}"
            size = doc.file_size or 0
            file_id = doc.file_id
            mime = doc.mime_type or ""
        elif message.photo:
            filename = f"photo_{message.id}.jpg"
            size = message.photo.file_size or 0
            file_id = message.photo.file_id
            mime = "image/jpeg"

        await upsert_file({
            "message_id": message.id,
            "channel_id": channel_id,
            "category": category,
            "filename": filename,
            "file_id": file_id,
            "size": size,
            "mime": mime,
            "date": message.date.isoformat() if message.date else "",
            "caption": message.caption or "",
        })
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
    return results

# ── Files ─────────────────────────────────────────────────────────────────────

@app.get("/api/files")
async def list_files(
    category: Optional[str] = None,
    q: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    _: bool = Depends(verify_token),
):
    offset = (page - 1) * limit
    if q:
        files, total = await search_files(q, category, limit, offset)
    else:
        files, total = await get_files(category, limit, offset)
    return {"files": files, "total": total, "page": page, "pages": -(-total // limit)}

@app.get("/api/stats")
async def stats(_: bool = Depends(verify_token)):
    return await get_stats()

# ── Stream / Download ─────────────────────────────────────────────────────────

@app.get("/api/stream/{file_db_id}")
async def stream_file(file_db_id: int, _: bool = Depends(verify_token)):
    file = await get_file_by_id(file_db_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    mime = file["mime"] or "application/octet-stream"

    async def generator() -> AsyncGenerator[bytes, None]:
        async for chunk in pyro_client.stream_media(file["file_id"], limit=512):
            yield chunk

    return StreamingResponse(generator(), media_type=mime, headers={
        "Content-Disposition": f'inline; filename="{file["filename"]}"',
        "Accept-Ranges": "bytes",
    })

@app.get("/api/download/{file_db_id}")
async def download_file(file_db_id: int, _: bool = Depends(verify_token)):
    file = await get_file_by_id(file_db_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    async def generator() -> AsyncGenerator[bytes, None]:
        async for chunk in pyro_client.stream_media(file["file_id"]):
            yield chunk

    return StreamingResponse(generator(), media_type="application/octet-stream", headers={
        "Content-Disposition": f'attachment; filename="{file["filename"]}"',
    })
