"""
Database layer using Telegram channel as persistent storage.
The index is stored as a JSON message in AirDrive Index channel.
Message ID 3 is the index message we update in place.
"""
import json
from typing import Optional

INDEX_CHANNEL_ID = -1003897388411
INDEX_MESSAGE_ID = 3  # The message in AirDrive Index where JSON is stored

# In-memory index — loaded from Telegram on startup
_index: dict = {
    "files": [],
    "next_id": 1,
}

_pyro_client = None  # Set by main.py after client starts

def set_client(client):
    global _pyro_client
    _pyro_client = client

async def load_index():
    """Load index from Telegram message on startup."""
    global _index
    try:
        msg = await _pyro_client.get_messages(INDEX_CHANNEL_ID, INDEX_MESSAGE_ID)
        if msg and msg.text:
            text = msg.text.strip()
            if text.startswith("{"):
                _index = json.loads(text)
                print(f"✅ Loaded index: {len(_index['files'])} files")
                return
        print("⚠️  Index message empty or not found, starting fresh")
    except Exception as e:
        print(f"⚠️  Could not load index: {e}, starting fresh")
    _index = {"files": [], "next_id": 1}

async def save_index():
    """Save index back to Telegram message."""
    try:
        text = json.dumps(_index, ensure_ascii=False)
        await _pyro_client.edit_message_text(
            chat_id=INDEX_CHANNEL_ID,
            message_id=INDEX_MESSAGE_ID,
            text=text,
        )
        print(f"✅ Index saved: {len(_index['files'])} files")
    except Exception as e:
        # If message is too long, split into chunks saved as separate messages
        print(f"⚠️  Save failed (maybe too large): {e}")
        await _save_chunked()

async def _save_chunked():
    """Fallback: save index as a file attachment if JSON is too large for a message."""
    try:
        import io
        data = json.dumps(_index, ensure_ascii=False).encode()
        bio = io.BytesIO(data)
        bio.name = "airdrive_index.json"
        await _pyro_client.send_document(
            chat_id=INDEX_CHANNEL_ID,
            document=bio,
            caption="AirDrive Index Backup",
        )
        print("✅ Index saved as file attachment")
    except Exception as e:
        print(f"❌ Chunked save failed: {e}")

async def init_db():
    """Called on startup — loads index from Telegram."""
    await load_index()

async def upsert_file(data: dict):
    """Add or update a file in the in-memory index, then save to Telegram."""
    global _index

    # Check if file already exists by file_id
    for i, f in enumerate(_index["files"]):
        if f.get("file_id") == data.get("file_id"):
            _index["files"][i] = {**f, **data}
            await save_index()
            return

    # New file
    new_file = {
        "id": _index["next_id"],
        **data,
    }
    _index["next_id"] += 1
    _index["files"].append(new_file)
    await save_index()

def _filter_files(files, category=None, q=None):
    result = files
    if category:
        result = [f for f in result if f.get("category") == category]
    if q:
        q_lower = q.lower()
        result = [f for f in result if
                  q_lower in f.get("filename", "").lower() or
                  q_lower in f.get("caption", "").lower()]
    return result

async def get_files(category: Optional[str], limit: int, offset: int):
    files = _filter_files(_index["files"], category=category)
    # Sort by date descending
    files = sorted(files, key=lambda f: f.get("date", ""), reverse=True)
    total = len(files)
    return files[offset:offset + limit], total

async def search_files(q: str, category: Optional[str], limit: int, offset: int):
    files = _filter_files(_index["files"], category=category, q=q)
    files = sorted(files, key=lambda f: f.get("date", ""), reverse=True)
    total = len(files)
    return files[offset:offset + limit], total

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

    total_size = sum(f.get("size", 0) for f in files)
    return {
        "by_category": list(by_cat.values()),
        "total_files": len(files),
        "total_size": total_size,
    }
