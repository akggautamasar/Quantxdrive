"""
Run this ONCE in Termux to get your SESSION_STRING for Render deployment.
Copy the output and paste it into Render's SESSION_STRING env var.

Usage:
    python3 get_session.py
"""
from pyrogram import Client

api_id = 26182818
api_hash = "e98cc55fabed0fce53269188fa3a0e63"

with Client("temp_session", api_id=api_id, api_hash=api_hash) as app:
    session_string = app.export_session_string()
    print("\n" + "="*60)
    print("YOUR SESSION STRING (copy everything below):")
    print("="*60)
    print(session_string)
    print("="*60)
    print("\nPaste this as SESSION_STRING in Render environment variables.\n")
