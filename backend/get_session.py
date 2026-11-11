"""Generate a dedicated Pyrogram StringSession without printing credentials.

Run on Oracle from backend directory:
    .venv/bin/python get_session.py

The session is saved to ~/.config/quantxdrive/session.txt (mode 0600).
Copy its contents securely into SESSION_STRING in the backend environment file.
"""
import getpass
import os
from pathlib import Path
from pyrogram import Client

def main():
    api_id = int(os.environ.get("API_ID") or input("Telegram API ID: ").strip())
    api_hash = os.environ.get("API_HASH") or getpass.getpass("Telegram API hash (hidden): ").strip()
    if not api_hash:
        raise SystemExit("API hash is required")
    directory = Path.home() / ".config" / "quantxdrive"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    target = directory / "session.txt"
    if target.exists():
        raise SystemExit(f"Session file already exists: {target}. Refusing to overwrite.")
    with Client("quantxdrive_session_generator", api_id=api_id, api_hash=api_hash, in_memory=True) as app:
        session = app.export_session_string()
    fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(session + "\n")
    print(f"Session securely saved to {target}. Do not share its contents.")

if __name__ == "__main__":
    main()
