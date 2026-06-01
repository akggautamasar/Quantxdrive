import json, os, io, time, uuid
from typing import Optional

_raw_idx = os.getenv("INDEX_CHANNEL_ID", "me")
INDEX_CHANNEL_ID = int(_raw_idx) if _raw_idx.lstrip("-").isdigit() else _raw_idx

_index: dict = {"files": [], "next_id": 1, "folders": [], "shares": {}}
_index_msg_id: Optional[int] = None

def _ensure_keys():
    _index.setdefault("files", [])
    _index.setdefault("next_id", 1)
    _index.setdefault("folders", [])
    _index.setdefault("shares", {})

async def _load_index_from(client, chat_id):
    """Try to load index.json from the given chat_id. Returns True on success."""
    global _index, _index_msg_id
    chat = await client.get_chat(chat_id)
    label = getattr(chat, "title", None) or getattr(chat, "first_name", str(chat_id))
    print(f"✅ Index channel: {label}")
    latest_msg = None
    async for msg in client.get_chat_history(chat_id, limit=50):
        if msg.document and msg.document.file_name == "index.json":
            latest_msg = msg
            break
    if latest_msg:
        _index_msg_id = latest_msg.id
        file_bytes = await client.download_media(latest_msg, in_memory=True)
        data = bytes(file_bytes.getbuffer())
        _index = json.loads(data.decode("utf-8"))
        print(f"✅ Loaded index msg {_index_msg_id}: {len(_index.get('files',[]))} files")
    else:
        print("⚠️  No index.json found, starting fresh")
        _index = {"files": [], "next_id": 1, "folders": [], "shares": {}}
    return True

async def load_index(client):
    global _index, _index_msg_id, INDEX_CHANNEL_ID
    # Try configured channel first; if it fails, fall back to "me" (Saved Messages)
    try:
        await _load_index_from(client, INDEX_CHANNEL_ID)
    except Exception as e:
        print(f"⚠️  Could not load index from {INDEX_CHANNEL_ID!r}: {e}")
        if INDEX_CHANNEL_ID != "me":
            print("↩️  Falling back to Saved Messages (me)")
            try:
                INDEX_CHANNEL_ID = "me"
                await _load_index_from(client, "me")
            except Exception as e2:
                print(f"❌ Fallback also failed: {e2}")
                _index = {"files": [], "next_id": 1, "folders": [], "shares": {}}
        else:
            _index = {"files": [], "next_id": 1, "folders": [], "shares": {}}
    _ensure_keys()

def cleanup_expired_shares():
    """Remove expired share tokens to keep index.json small."""
    now = int(time.time())
    expired = [k for k, v in _index.get("shares", {}).items() if v.get("expires_at", 0) < now]
    for k in expired:
        del _index["shares"][k]
    if expired:
        print(f"✅ Purged {len(expired)} expired shares")

async def save_index(client):
    global _index_msg_id
    cleanup_expired_shares()
    try:
        text = json.dumps(_index, ensure_ascii=False).encode("utf-8")
        bio = io.BytesIO(text)
        bio.name = "index.json"
        if _index_msg_id:
            try:
                from pyrogram.types import InputMediaDocument
                bio.seek(0)
                await client.edit_message_media(
                    chat_id=INDEX_CHANNEL_ID, message_id=_index_msg_id,
                    media=InputMediaDocument(media=bio, file_name="index.json"),
                )
                print(f"✅ Index updated msg {_index_msg_id}: {len(_index['files'])} files")
                return
            except Exception as e:
                print(f"⚠️  Edit failed: {e}, sending new")
        bio.seek(0)
        new_msg = await client.send_document(
            chat_id=INDEX_CHANNEL_ID, document=bio,
            file_name="index.json", caption="AirDrive Index",
        )
        old_id = _index_msg_id
        _index_msg_id = new_msg.id
        if old_id and old_id != new_msg.id:
            try: await client.delete_messages(INDEX_CHANNEL_ID, old_id)
            except: pass
        print(f"✅ Index saved new msg {_index_msg_id}")
    except Exception as e:
        print(f"❌ Save failed: {e}")

async def upsert_file(data: dict):
    msg_id = data.get("message_id")
    ch_id = data.get("channel_id")
    for i, f in enumerate(_index["files"]):
        if f.get("message_id") == msg_id and f.get("channel_id") == ch_id:
            _index["files"][i] = {**f, **data, "id": f["id"]}
            return
    _index["files"].append({"id": _index["next_id"], **data})
    _index["next_id"] += 1

# ── Filtering & sorting ──────────────────────────────────────────────────────

async def get_files_filtered(category=None, q=None, folder=None, favorites=False,
                             sort_by="date", sort_dir="desc", limit=50, offset=0):
    files = _index["files"]

    if favorites:
        files = [f for f in files if f.get("favorite")]
    if folder is not None:
        if folder == "":
            files = [f for f in files if not f.get("folder_id")]
        else:
            files = [f for f in files if f.get("folder_id") == folder]
    if category:
        files = [f for f in files if f.get("category") == category]
    if q:
        ql = q.lower()
        files = [f for f in files if ql in f.get("filename","").lower() or ql in f.get("caption","").lower()]

    reverse = (sort_dir == "desc")
    if sort_by == "name":
        files = sorted(files, key=lambda f: f.get("filename","").lower(), reverse=reverse)
    elif sort_by == "size":
        files = sorted(files, key=lambda f: f.get("size", 0), reverse=reverse)
    else:
        files = sorted(files, key=lambda f: f.get("date",""), reverse=reverse)

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
    favs = sum(1 for f in files if f.get("favorite"))
    return {
        "by_category": list(by_cat.values()),
        "total_files": len(files),
        "total_size": sum(f.get("size", 0) for f in files),
        "favorites_count": favs,
        "folders_count": len(_index.get("folders", [])),
    }

# ── Favorites ─────────────────────────────────────────────────────────────────

async def toggle_favorite(file_id: int):
    for f in _index["files"]:
        if f.get("id") == file_id:
            f["favorite"] = not f.get("favorite", False)
            return f["favorite"]
    return False

# ── Folders ───────────────────────────────────────────────────────────────────

async def create_folder(name: str):
    fid = uuid.uuid4().hex[:10]
    folder = {"id": fid, "name": name, "created_at": int(time.time())}
    _index.setdefault("folders", []).append(folder)
    return folder

async def delete_folder(folder_id: str):
    _index["folders"] = [f for f in _index.get("folders", []) if f["id"] != folder_id]
    # Remove folder_id from all files
    for f in _index["files"]:
        if f.get("folder_id") == folder_id:
            f["folder_id"] = None

async def move_file_to_folder(file_id: int, folder_id):
    for f in _index["files"]:
        if f.get("id") == file_id:
            f["folder_id"] = folder_id
            return

# ── Shares ────────────────────────────────────────────────────────────────────

async def add_share(token: str, file_id: int, expires_at: int):
    _index.setdefault("shares", {})[token] = {
        "file_id": file_id, "expires_at": expires_at,
    }

async def get_share(token: str):
    share = _index.get("shares", {}).get(token)
    if not share:
        return None
    if share.get("expires_at", 0) < int(time.time()):
        return None
    return share
