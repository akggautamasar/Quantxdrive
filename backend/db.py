"""
Database layer using Telegram channel as persistent storage.
Configure via env variables:
  INDEX_CHANNEL_ID — channel where index is stored
  INDEX_MESSAGE_ID — message ID of the {} text message in that channel
"""
import json
import os
from typing import Optional

INDEX_CHANNEL_ID = int(os.getenv("INDEX_CHANNEL_ID", "-1003897388411"))
INDEX_MESSAGE_ID = int(os.getenv("INDEX_MESSAGE_ID", "4"))

_index: dict = {"files": [], "next_id": 1}
_pyro_client = None

def set_client(client):
    global _pyro_client
    _pyro_client = client

async def init_db():
    """Load index from Telegram on startup."""
    global _index
    try:
        # First resolve the channel
        chat = await _pyro_client.get_chat(INDEX_CHANNEL_ID)
        print(f"✅ Index channel resolved: {chat.title}")

        # Then fetch the index message
        msg = await _pyro_client.get_messages(INDEX_CHANNEL_ID, INDEX_MESSAGE_ID)
        if msg and msg.text and msg.text.strip().startswith("{"):
            _index = json.loads(msg.text.strip())
            print(f"✅ Loaded index: {len(_index['files'])} files")
        else:
            print("⚠️  Index message empty, starting fresh")
            _index = {"files": [], "next_id": 1}
    except Exception as e:
        print(f"⚠️  Could not load index: {e}, starting fresh")
        _index = {"files": [], "next_id": 1}

async def save_index():
    """Save index back to Telegram message."""
    global _index
    try:
        text = json.dumps(_index, ensure_ascii=False)
        if len(text) > 4000:
            # Too large for a message — save as file
            import io
            bio = io.BytesIO(text.encode())
            bio.name = "index.json"
            await _pyro_client.send_document(
                chat_id=INDEX_CHANNEL_ID,
                document=bio,
                caption="AirDrive Index",
            )
            print("✅ Index saved as file (too large for message)")
        else:
            await _pyro_client.edit_message_text(
                chat_id=INDEX_CHANNEL_ID,
                message_id=INDEX_MESSAGE_ID,
                text=text,
            )
            print(f"✅ Index saved: {len(_index['files'])} files")
    except Exception as e:
        print(f"❌ Save index failed: {e}")

async def upsert_file(data: dict):
    global _index
    for i, f in enumerate(_index["files"]):
        if f.get("file_id") == data.get("file_id"):
            _index["files"][i] = {**f, **data}
            return
    new_file = {"id": _index["next_id"], **data}
    _index["next_id"] += 1
    _index["files"].append(new_file)

def _filter(files, category=None, q=None):
    if category:
        files = [f for f in files if f.get("category") == category]
    if q:
        ql = q.lower()
        files = [f for f in files if ql in f.get("filename","").lower() or ql in f.get("caption","").lower()]
    return files

async def get_files(category: Optional[str], limit: int, offset: int):
    files = sorted(_filter(_index["files"], category=category), key=lambda f: f.get("date",""), reverse=True)
    return files[offset:offset+limit], len(files)

async def search_files(q: str, category: Optional[str], limit: int, offset: int):
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
