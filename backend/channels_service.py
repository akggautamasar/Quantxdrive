from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

from fastapi import HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pyrogram import Client

import db

_bot_client = None
_original_stream_media_with_refresh = None


def _kind(message):
    if getattr(message, "photo", None): return "photo"
    if getattr(message, "video", None): return "video"
    if getattr(message, "audio", None): return "audio"
    if getattr(message, "voice", None): return "audio"
    if getattr(message, "animation", None): return "video"
    document = getattr(message, "document", None)
    if document:
        name = str(getattr(document, "file_name", None) or "").lower()
        mime = str(getattr(document, "mime_type", None) or "").lower()
        if mime == "application/pdf" or name.endswith(".pdf"): return "pdf"
        if mime == "application/epub+zip" or "epub" in mime or name.endswith(".epub"): return "epub"
        return "other"
    return None


def _media_info(message):
    kind = _kind(message)
    if not kind: return None
    media = message.photo or message.video or message.audio or message.voice or message.document or message.animation
    if not media: return None
    if kind == "photo":
        filename, mime = f"photo_{message.id}.jpg", "image/jpeg"
    else:
        filename = getattr(media, "file_name", None) or getattr(media, "file_unique_id", None) or f"telegram_{message.id}"
        mime = getattr(media, "mime_type", None) or ("video/mp4" if kind == "video" else "audio/mpeg" if kind == "audio" else "application/pdf" if kind == "pdf" else "application/epub+zip" if kind == "epub" else db.get_mime(filename))
    return {
        "message_id": message.id, "channel_id": message.chat.id,
        "category": {"photo": "photos", "video": "videos", "audio": "audio", "pdf": "other_files", "epub": "other_files", "other": "other_files"}[kind],
        "filename": filename, "file_id": media.file_id,
        "size": int(getattr(media, "file_size", 0) or 0), "mime": mime,
        "date": message.date.isoformat() if message.date else "",
        "caption": message.caption or "", "channel_source": True, "telegram_kind": kind,
    }


def _channel_config(channel_id: int):
    for item in db._index.get("channels", []):
        if int(item.get("id")) == int(channel_id): return item
    return None


async def _get_bot_client():
    global _bot_client
    import main
    if not main.BOT_TOKEN:
        return None
    if _bot_client and _bot_client.is_connected:
        return _bot_client
    _bot_client = Client("quantxdrive_channel_bot", api_id=main.API_ID, api_hash=main.API_HASH, bot_token=main.BOT_TOKEN, in_memory=True)
    await _bot_client.start()
    print("🤖 Channel bot client started", flush=True)
    return _bot_client


async def _resolve_with_clients(target):
    import main
    errors = []
    clients = [(main.pyro_client, "session")]
    bot = await _get_bot_client()
    if bot: clients.append((bot, "bot"))
    for client, mode in clients:
        if not client: continue
        try:
            chat = await client.get_chat(target)
            return chat, client, mode
        except Exception as exc:
            errors.append(f"{mode}: {exc}")
    raise HTTPException(status_code=400, detail="Telegram could not access this channel. " + " | ".join(errors))


def _normalize_target(raw: str):
    value = str(raw or "").strip()
    if not value: return None
    if value.lstrip("-").isdigit(): return int(value)
    if value.startswith("@"): return value
    if value.startswith(("http://", "https://")):
        parsed = urlparse(value); host = (parsed.netloc or "").lower()
        if host.endswith("t.me") or host.endswith("telegram.me"):
            parts = [p for p in parsed.path.split("/") if p]
            if parts and parts[0] not in {"c", "joinchat"} and not parts[0].startswith("+"): return "@" + parts[0]
    if value.startswith(("t.me/", "telegram.me/")):
        parts = [p for p in value.split("/", 1)[1].split("/") if p]
        if parts and parts[0] not in {"c", "joinchat"} and not parts[0].startswith("+"): return "@" + parts[0]
    if all(ch.isalnum() or ch == "_" for ch in value): return "@" + value
    return value


async def _resolve_channel(raw: str):
    target = _normalize_target(raw)
    if target is None: raise HTTPException(status_code=400, detail="Enter a Telegram channel ID, @username, or public t.me/username link")
    chat, client, mode = await _resolve_with_clients(target)
    return chat, target, client, mode


async def _sync_channel(channel_id: int, limit: int = 0):
    import main
    cfg = _channel_config(channel_id)
    target = ("@" + cfg.get("username")) if cfg and cfg.get("username") else channel_id
    chat, client, mode = await _resolve_with_clients(target)
    count = scanned = 0
    history = client.get_chat_history(chat.id, limit=limit) if limit > 0 else client.get_chat_history(chat.id)
    async for message in history:
        scanned += 1
        info = _media_info(message)
        if info:
            info["channel_access"] = mode
            await db.upsert_file(info)
            count += 1
    cfg = cfg or {"id": channel_id}
    cfg.update({"title": getattr(chat, "title", None) or getattr(chat, "first_name", None) or str(channel_id), "username": getattr(chat, "username", None) or "", "type": str(getattr(chat, "type", "channel")), "access_client": mode, "last_sync": datetime.utcnow().isoformat(), "scanned": scanned, "files": count})
    if not _channel_config(channel_id):
        db._index.setdefault("channels", []).append(cfg)
    else:
        for i, old in enumerate(db._index["channels"]):
            if int(old.get("id")) == int(channel_id): db._index["channels"][i] = cfg; break
    await db.save_index(main.pyro_client)
    return cfg


async def _stream_channel_file(file: dict, request: Request):
    import main
    mode = file.get("channel_access") or (_channel_config(int(file.get("channel_id", 0))) or {}).get("access_client") or "session"
    client = await _get_bot_client() if mode == "bot" else main.pyro_client
    if not client: raise HTTPException(status_code=503, detail="Telegram client is not ready")
    try: message = await client.get_messages(int(file["channel_id"]), int(file["message_id"]))
    except Exception as exc: raise HTTPException(status_code=502, detail=f"Telegram message unavailable: {exc}")
    if not message or not _kind(message): raise HTTPException(status_code=404, detail="Telegram media message not found")
    total = int(file.get("size", 0) or 0); mime = file.get("mime") or db.get_mime(file.get("filename", "file")); rh = request.headers.get("range") or request.headers.get("Range")
    start, end, partial = 0, total - 1 if total else 0, False
    if rh and rh.startswith("bytes=") and total:
        try:
            a, b = rh[6:].split(",", 1)[0].split("-", 1)
            if a: start, end = int(a), int(b) if b else total - 1
            else: start, end = max(0, total - int(b)), total - 1
            start, end, partial = max(0, min(start, total - 1)), max(start, min(end, total - 1)), True
        except Exception: pass
    chunk_size = 1024 * 1024; offset = start // chunk_size; first_cut = start % chunk_size; count = ((end // chunk_size) - offset) + 1 if total else 0
    async def gen():
        current = 0
        async for chunk in client.stream_media(message, offset=offset, limit=count or 0):
            if not chunk: continue
            if count == 1: yield chunk[first_cut:(end % chunk_size) + 1]
            elif current == 0: yield chunk[first_cut:]
            elif current == count - 1: yield chunk[:(end % chunk_size) + 1]
            else: yield chunk
            current += 1
    headers = {"Accept-Ranges":"bytes", "Content-Disposition":f'inline; filename="{file.get("filename", "telegram-file")}"', "Cache-Control":"public, max-age=3600"}
    if partial: headers["Content-Range"] = f"bytes {start}-{end}/{total}"
    return StreamingResponse(gen(), status_code=206 if partial else 200, media_type=mime, headers=headers)


async def _channel_aware_stream(file, *, offset=0, limit=0):
    import main
    mode = file.get("channel_access") or (_channel_config(int(file.get("channel_id", 0))) or {}).get("access_client")
    if mode != "bot":
        async for chunk in _original_stream_media_with_refresh(file, offset=offset, limit=limit):
            if chunk: yield chunk
        return
    client = await _get_bot_client()
    if not client: raise RuntimeError("BOT_TOKEN is not configured for this channel")
    message = await client.get_messages(int(file["channel_id"]), int(file["message_id"]))
    async for chunk in client.stream_media(message, offset=offset, limit=limit):
        if chunk: yield chunk


def _install_media_bridge():
    global _original_stream_media_with_refresh
    import main
    if _original_stream_media_with_refresh is None:
        _original_stream_media_with_refresh = main._stream_media_with_refresh
        main._stream_media_with_refresh = _channel_aware_stream


def register_routes(app):
    if getattr(app.state, "channels_routes_registered", False): return
    app.state.channels_routes_registered = True
    import main
    _install_media_bridge()

    @app.get("/api/channels")
    async def list_channels(_: bool = Depends(main.verify_token)):
        return {"channels": db._index.get("channels", [])}

    @app.post("/api/channels")
    async def add_channel(body: dict, _: bool = Depends(main.verify_token)):
        raw_target = str(body.get("channel_id", "")).strip(); name = str(body.get("name") or "").strip()
        chat, target, _, mode = await _resolve_channel(raw_target); channel_id = int(chat.id); existing = _channel_config(channel_id); cfg = existing or {"id": channel_id}
        cfg.update({"title": name or getattr(chat, "title", None) or getattr(chat, "first_name", None) or str(channel_id), "username": getattr(chat, "username", None) or "", "type": str(getattr(chat, "type", "channel")), "input": raw_target, "resolved_from": str(target), "access_client": mode, "added_at": existing.get("added_at") if existing else datetime.utcnow().isoformat(), "last_sync": existing.get("last_sync") if existing else None})
        if existing:
            for i, old in enumerate(db._index["channels"]):
                if int(old.get("id")) == channel_id: db._index["channels"][i] = cfg; break
        else: db._index.setdefault("channels", []).append(cfg)
        await db.save_index(main.pyro_client); return {"channel": cfg, "connected": True}

    @app.delete("/api/channels/{channel_id}")
    async def remove_channel(channel_id: int, _: bool = Depends(main.verify_token)):
        db._index["channels"] = [c for c in db._index.get("channels", []) if int(c.get("id")) != channel_id]
        await db.save_index(main.pyro_client); return {"deleted": channel_id}

    @app.post("/api/channels/{channel_id}/sync")
    async def sync_channel(channel_id: int, request: Request, _: bool = Depends(main.verify_token)):
        limit = 0
        try:
            if "application/json" in (request.headers.get("content-type") or ""):
                body = await request.json()
                if isinstance(body, dict): limit = int(body.get("limit", 0) or 0)
        except Exception: limit = 0
        try:
            print(f"📺 Channel sync requested: {channel_id}, limit={limit}", flush=True)
            cfg = await _sync_channel(channel_id, max(0, min(limit, 10000)))
            print(f"📺 Channel sync complete: {channel_id}, scanned={cfg.get('scanned', 0)}, files={cfg.get('files', 0)}, access={cfg.get('access_client')}", flush=True)
            return {"channel": cfg, "synced": True}
        except HTTPException: raise
        except Exception as exc:
            import traceback; traceback.print_exc()
            raise HTTPException(status_code=502, detail=f"Channel sync failed: {type(exc).__name__}: {exc}")

    @app.get("/api/channels/{channel_id}/files")
    async def channel_files(channel_id: int, type: str = "all", q: str = "", sort_by: str = "date", sort_dir: str = "desc", page: int = 1, limit: int = 50, _: bool = Depends(main.verify_token)):
        configured = _channel_config(channel_id)
        if not configured: raise HTTPException(status_code=404, detail="Channel is not configured")
        files = [f for f in db._index.get("files", []) if int(f.get("channel_id", 0)) == channel_id and f.get("message_id")]
        if type != "all":
            if type == "document": files = [f for f in files if f.get("telegram_kind") in {"pdf", "epub"}]
            else:
                wanted = "photos" if type == "photo" else "videos" if type == "video" else "audio" if type == "audio" else "other_files"
                files = [f for f in files if f.get("category") == wanted and f.get("telegram_kind") not in {"pdf", "epub"}]
        if q:
            ql = q.lower(); files = [f for f in files if ql in str(f.get("filename", "")).lower() or ql in str(f.get("caption", "")).lower()]
        reverse = sort_dir != "asc"
        if sort_by == "name": files.sort(key=lambda f: str(f.get("filename", "")).lower(), reverse=reverse)
        elif sort_by == "size": files.sort(key=lambda f: int(f.get("size", 0) or 0), reverse=reverse)
        else: files.sort(key=lambda f: str(f.get("date", "")), reverse=reverse)
        total = len(files); limit = max(1, min(limit, 100)); page = max(1, page); offset = (page - 1) * limit
        out = [{**f, "tg_link": main.make_tg_link(channel_id, f.get("message_id", 0))} for f in files[offset:offset + limit]]
        return {"channel": configured, "files": out, "total": total, "page": page, "pages": max(1, (total + limit - 1) // limit)}

    @app.get("/api/channel-media/{token}/{file_db_id}")
    async def channel_media(token: str, file_db_id: int, request: Request):
        if not main.verify_jwt(token): raise HTTPException(status_code=401, detail="Invalid token")
        file = await db.get_file_by_id(file_db_id)
        if not file or not file.get("channel_source"): raise HTTPException(status_code=404, detail="Channel file not found")
        return await _stream_channel_file(file, request)
