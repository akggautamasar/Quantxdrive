import json
import os
import io
from typing import Optional

INDEX_CHANNEL_ID = int(os.getenv("INDEX_CHANNEL_ID", "-1003897388411"))

_index: dict = {"files": [], "next_id": 1}
_index_msg_id: Optional[int] = None

async def load_index(client):
    global _index, _index_msg_id
    try:
        chat = await client.get_chat(INDEX_CHANNEL_ID)
        print(f"✅ Index channel: {chat.title}")

        latest_msg = None
        async for msg in client.get_chat_history(INDEX_CHANNEL_ID, limit=50):
            if msg.document and msg.document.file_name == "index.json":
                latest_msg = msg
                break

        if latest_msg:
            _index_msg_id = latest_msg.id
            file_bytes = await client.download_media(latest_msg, in_memory=True)
            data = bytes(file_bytes.getbuffer())
            _index = json.loads(data.decode("utf-8"))
            print(f"✅ Loaded index from msg {_index_msg_id}: {len(_index['files'])} files")
        else:
            print("⚠️  No index.json found, starting fresh")
            _index = {"files": [], "next_id": 1}
    except Exception as e:
        print(f"⚠️  Could not load index: {e}, starting fresh")
        _index = {"files": [], "next_id": 1}
    _index.setdefault("files", [])
    _index.setdefault("next_id", 1)

async def save_index(client):
    global _index_msg_id
    try:
        text = json.dumps(_index, ensure_ascii=False).encode("utf-8")
        bio = io.BytesIO(text)
        bio.name = "index.json"

        if _index_msg_id:
            try:
                from pyrogram.types import InputMediaDocument
                bio.seek(0)
                await client.edit_message_media(
                    chat_id=INDEX_CHANNEL_ID,
                    message_id=_index_msg_id,
                    media=InputMediaDocument(media=bio, file_name="index.json"),
                )
                print(f"✅ Index updated msg {_index_msg_id}: {len(_index['files'])} files")
                return
            except Exception as e:
                print(f"⚠️  Edit failed: {e}, sending new")

        bio.seek(0)
        new_msg = await client.send_document(
            chat_id=INDEX_CHANNEL_ID,
            document=bio,
            file_name="index.json",
            caption="AirDrive Index",
        )
        old_id = _index_msg_id
        _index_msg_id = new_msg.id
        if old_id and old_id != new_msg.id:
            try:
                await client.delete_messages(INDEX_CHANNEL_ID, old_id)
            except: pass
        print(f"✅ Index saved new msg {_index_msg_id}: {len(_index['files'])} files")
    except Exception as e:
        print(f"❌ Save failed: {e}")

async def cleanup_old_indexes(client):
    deleted = 0
    try:
        to_delete = []
        async for msg in client.get_chat_history(INDEX_CHANNEL_ID, limit=100):
            if msg.document and msg.document.file_name == "index.json":
                if msg.id != _index_msg_id:
                    to_delete.append(msg.id)
        if to_delete:
            await client.delete_messages(INDEX_CHANNEL_ID, to_delete)
            deleted = len(to_delete)
        print(f"🧹 Deleted {deleted} old indexes")
    except Exception as e:
        print(f"⚠️  Cleanup failed: {e}")
    return deleted

async def upsert_file(data: dict):
    global _index
    msg_id = data.get("message_id")
    ch_id = data.get("channel_id")
    for i, f in enumerate(_index["files"]):
        if f.get("message_id") == msg_id and f.get("channel_id") == ch_id:
            _index["files"][i] = {**f, **data, "id": f["id"]}
            return
    _index["files"].append({"id": _index["next_id"], **data})
    _index["next_id"] += 1

async def clear_index(client):
    global _index
    _index = {"files": [], "next_id": 1}
    await save_index(client)

def _filter(files, category=None, q=None):
    if category:
        files = [f for f in files if f.get("category") == category]
    if q:
        ql = q.lower()
        files = [f for f in files if ql in f.get("filename","").lower() or ql in f.get("caption","").lower()]
    return files

async def get_files(category, limit, offset):
    files = sorted(_filter(_index["files"], category=category), key=lambda f: f.get("date",""), reverse=True)
    return files[offset:offset+limit], len(files)

async def search_files(q, category, limit, offset):
    files = sorted(_filter(_index["files"], category=category, q=q), key=lambda f: f.get("date",""), reverse=True)
    return files[offset:offset+limit], len(files)

async def get_file_by_id(file_id: int):
    for f in _index["files"]:
        if f.get("id") == file_id:
            return f
    return None

async def get_stats():
    files = _index["files"]
    by_cat = {}
    for f in files:
        cat = f.get("category", "other")
        if cat not in by_cat:
            by_cat[cat] = {"category": cat, "count": 0, "total_size": 0}
        by_cat[cat]["count"] += 1
        by_cat[cat]["total_size"] += f.get("size", 0)
    return {
        "by_category": list(by_cat.values()),
        "total_files": len(files),
        "total_size": sum(f.get("size", 0) for f in files),
    }
