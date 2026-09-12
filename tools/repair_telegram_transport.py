from pathlib import Path

p = Path("backend/main.py")
s = p.read_text(encoding="utf-8")
start = s.index("# Telegram file references are temporary.")
end = s.index("async def _stream_file", start)

new = '''# Telegram file references are temporary. The file index stores the origin
# channel/message IDs as the durable source of truth. The main Pyrogram transport can
# also die independently of the media transport, so refreshes must recover that
# connection instead of falling back to the stale file_id.
_tg_refresh_lock = asyncio.Lock()
_tg_reconnect_lock = asyncio.Lock()
_tg_message_cache: dict = {}
_TG_MESSAGE_CACHE_TTL = 120.0


def _is_transport_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return isinstance(exc, (ConnectionError, OSError, TimeoutError)) or any(
        marker in text for marker in (
            "handler is closed",
            "tcptransport",
            "transport closed",
            "client has not been started",
            "connection closed",
            "connection reset",
        )
    )


async def _recover_pyrogram_transport():
    if pyro_client is None:
        raise RuntimeError("Telegram client is not initialized")
    async with _tg_reconnect_lock:
        print("♻️ Telegram RPC transport appears closed; restarting Pyrogram client")
        await pyro_client.restart()
        print("✅ Pyrogram client restarted")


async def _fresh_media_source(file, *, force=False):
    channel_id = file.get("channel_id")
    message_id = file.get("message_id")
    if channel_id is None or not message_id:
        return file.get("file_id")

    key = (int(channel_id), int(message_id))
    if not force:
        cached = _tg_message_cache.get(key)
        if cached and (time.monotonic() - cached[0]) < _TG_MESSAGE_CACHE_TTL:
            return cached[1]

    async with _tg_refresh_lock:
        if not force:
            cached = _tg_message_cache.get(key)
            if cached and (time.monotonic() - cached[0]) < _TG_MESSAGE_CACHE_TTL:
                return cached[1]

        last_error = None
        for attempt in range(2):
            try:
                message = await pyro_client.get_messages(channel_id, message_id, replies=0)
                if message and not getattr(message, "empty", False):
                    if any(getattr(message, attr, None) is not None for attr in (
                        "document", "video", "audio", "photo", "animation", "voice", "video_note"
                    )):
                        _tg_message_cache[key] = (time.monotonic(), message)
                        return message
                last_error = RuntimeError(
                    f"Telegram origin message {channel_id}/{message_id} has no media"
                )
                break
            except Exception as e:
                last_error = e
                if attempt == 0 and _is_transport_error(e):
                    await _recover_pyrogram_transport()
                    continue
                break

        if last_error:
            print(f"⚠️ Could not refresh Telegram message {channel_id}/{message_id}: {last_error}")
            raise last_error
        raise RuntimeError(f"Could not refresh Telegram message {channel_id}/{message_id}")


async def _stream_media_with_refresh(file, *, offset=0, limit=0):
    source = await _fresh_media_source(file)
    if not source:
        raise RuntimeError("No Telegram media source available")
    try:
        async for chunk in pyro_client.stream_media(source, offset=offset, limit=limit):
            if chunk:
                yield chunk
    except Exception as e:
        if e.__class__.__name__ != "FileReferenceExpired":
            raise
        print(f"♻️ Telegram file reference expired; forcing origin refresh {file.get('channel_id')}/{file.get('message_id')}")
        fresh = await _fresh_media_source(file, force=True)
        async for chunk in pyro_client.stream_media(fresh, offset=offset, limit=limit):
            if chunk:
                yield chunk


'''

p.write_text(s[:start] + new + s[end:], encoding="utf-8")
print("patched backend/main.py")
