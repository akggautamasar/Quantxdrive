import os
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

import db


def _kind(message):
    if getattr(message, "photo", None):
        return "photo"
    if getattr(message, "video", None):
        return "video"
    if getattr(message, "audio", None):
        return "audio"
    if getattr(message, "voice", None):
        return "audio"
    if getattr(message, "document", None):
        return "other"
    if getattr(message, "animation", None):
        return "video"
    return None


def _media_info(message):
    kind = _kind(message)
    if not kind:
        return None
    media = message.photo or message.video or message.audio or message.voice or message.document or message.animation
    if not media:
        return None
    if kind == "photo":
        filename = f"photo_{message.id}.jpg"
        mime = "image/jpeg"
    else:
        filename = getattr(media, "file_name", None) or getattr(media, "file_unique_id", None) or f"telegram_{message.id}"
        mime = getattr(media, "mime_type", None) or ("video/mp4" if kind == "video" else "audio/mpeg" if kind == "audio" else db.get_mime(filename))
    return {
        "message_id": message.id,
        "channel_id": message.chat.id,
        "category": {"photo": "photos", "video": "videos", "audio": "audio", "other": "other_files"}[kind],
        "filename": filename,
        "file_id": media.file_id,
        "size": int(getattr(media, "file_size", 0) or 0),
        "mime": mime,
        "date": message.date.isoformat() if message.date else "",
        "caption": message.caption or "",
        "channel_source": True,
        "telegram_kind": kind,
    }


def _channel_config(channel_id: int):
    for item in db._index.get("channels", []):
        if int(item.get("id")) == int(channel_id):
            return item
    return None


async def _sync_channel(channel_id: int, limit: int = 0):
    import main
    if not main.pyro_client:
        raise HTTPException(status_code=503, detail="Telegram client is not ready")
    try:
        chat = await main.pyro_client.get_chat(channel_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot access channel: {exc}")

    count = 0
    scanned = 0
    async for message in main.pyro_client.get_chat_history(chat.id, limit=limit or 0):
        scanned += 1
        info = _media_info(message)
        if not info:
            continue
        await db.upsert_file(info)
        count += 1

    cfg = _channel_config(channel_id) or {"id": channel_id}
    cfg.update({
        "title": getattr(chat, "title", None) or getattr(chat, "first_name", None) or str(channel_id),
        "username": getattr(chat, "username", None) or "",
        "type": str(getattr(chat, "type", "channel")),
        "last_sync": datetime.utcnow().isoformat(),
        "scanned": scanned,
        "files": count,
    })
    if not _channel_config(channel_id):
        db._index.setdefault("channels", []).append(cfg)
    else:
        for i, old in enumerate(db._index["channels"]):
            if int(old.get("id")) == int(channel_id):
                db._index["channels"][i] = cfg
                break
    await db.save_index(main.pyro_client)
    return cfg


def register_routes(app):
    if getattr(app.state, "channels_routes_registered", False):
        return
    app.state.channels_routes_registered = True

    @app.get("/api/channels")
    async def list_channels(_: bool = __import__("fastapi").Depends(__import__("main").verify_token)):
        return {"channels": db._index.get("channels", [])}

    @app.post("/api/channels")
    async def add_channel(body: dict, _: bool = __import__("fastapi").Depends(__import__("main").verify_token)):
        import main
        raw_id = str(body.get("channel_id", "")).strip()
        if not raw_id or not raw_id.lstrip("-").isdigit():
            raise HTTPException(status_code=400, detail="Enter a numeric Telegram channel ID, for example -1001234567890")
        channel_id = int(raw_id)
        name = str(body.get("name") or "").strip()
        try:
            chat = await main.pyro_client.get_chat(channel_id)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Telegram account cannot access this channel: {exc}")
        existing = _channel_config(channel_id)
        cfg = existing or {"id": channel_id}
        cfg.update({
            "title": name or getattr(chat, "title", None) or getattr(chat, "first_name", None) or str(channel_id),
            "username": getattr(chat, "username", None) or "",
            "type": str(getattr(chat, "type", "channel")),
            "added_at": existing.get("added_at") if existing else datetime.utcnow().isoformat(),
            "last_sync": existing.get("last_sync") if existing else None,
        })
        if existing:
            for i, old in enumerate(db._index["channels"]):
                if int(old.get("id")) == channel_id:
                    db._index["channels"][i] = cfg
                    break
        else:
            db._index.setdefault("channels", []).append(cfg)
        await db.save_index(main.pyro_client)
        return {"channel": cfg, "connected": True}

    @app.delete("/api/channels/{channel_id}")
    async def remove_channel(channel_id: int, _: bool = __import__("fastapi").Depends(__import__("main").verify_token)):
        import main
        db._index["channels"] = [c for c in db._index.get("channels", []) if int(c.get("id")) != channel_id]
        await db.save_index(main.pyro_client)
        return {"deleted": channel_id}

    @app.post("/api/channels/{channel_id}/sync")
    async def sync_channel(channel_id: int, body: Optional[dict] = None, _: bool = __import__("fastapi").Depends(__import__("main").verify_token)):
        limit = int((body or {}).get("limit", 0) or 0)
        cfg = await _sync_channel(channel_id, max(0, min(limit, 10000)))
        return {"channel": cfg}

    @app.get("/api/channels/{channel_id}/files")
    async def channel_files(
        channel_id: int,
        type: str = "all",
        q: str = "",
        sort_by: str = "date",
        sort_dir: str = "desc",
        page: int = 1,
        limit: int = 50,
        _: bool = __import__("fastapi").Depends(__import__("main").verify_token),
    ):
        configured = _channel_config(channel_id)
        if not configured:
            raise HTTPException(status_code=404, detail="Channel is not configured")
        files = [f for f in db._index.get("files", []) if int(f.get("channel_id", 0)) == channel_id and f.get("message_id")]
        if type != "all":
            wanted = "photos" if type == "photo" else "videos" if type == "video" else "audio" if type == "audio" else "other_files"
            files = [f for f in files if f.get("category") == wanted]
        if q:
            ql = q.lower()
            files = [f for f in files if ql in str(f.get("filename", "")).lower() or ql in str(f.get("caption", "")).lower()]
        reverse = sort_dir != "asc"
        if sort_by == "name":
            files.sort(key=lambda f: str(f.get("filename", "")).lower(), reverse=reverse)
        elif sort_by == "size":
            files.sort(key=lambda f: int(f.get("size", 0) or 0), reverse=reverse)
        else:
            files.sort(key=lambda f: str(f.get("date", "")), reverse=reverse)
        total = len(files)
        limit = max(1, min(limit, 100))
        page = max(1, page)
        offset = (page - 1) * limit
        out = [{**f, "tg_link": main.make_tg_link(channel_id, f.get("message_id", 0))} for f in files[offset:offset + limit]] if False else files[offset:offset + limit]
        import main
        out = [{**f, "tg_link": main.make_tg_link(channel_id, f.get("message_id", 0))} for f in out]
        return {"channel": configured, "files": out, "total": total, "page": page, "pages": max(1, (total + limit - 1) // limit)}
