import aiosqlite
import os
from typing import Optional

DB_PATH = os.getenv("DB_PATH", "airdrive.db")

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER,
                channel_id INTEGER,
                category TEXT,
                filename TEXT,
                file_id TEXT UNIQUE,
                size INTEGER,
                mime TEXT,
                date TEXT,
                caption TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_category ON files(category)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_filename ON files(filename)")
        await db.commit()
    print("✅ Database initialized")

async def upsert_file(data: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO files (message_id, channel_id, category, filename, file_id, size, mime, date, caption)
            VALUES (:message_id, :channel_id, :category, :filename, :file_id, :size, :mime, :date, :caption)
            ON CONFLICT(file_id) DO UPDATE SET
                filename = excluded.filename,
                caption = excluded.caption
        """, data)
        await db.commit()

async def get_files(category: Optional[str], limit: int, offset: int):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if category:
            cursor = await db.execute(
                "SELECT * FROM files WHERE category = ? ORDER BY date DESC LIMIT ? OFFSET ?",
                (category, limit, offset)
            )
            count_cursor = await db.execute(
                "SELECT COUNT(*) FROM files WHERE category = ?", (category,)
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM files ORDER BY date DESC LIMIT ? OFFSET ?",
                (limit, offset)
            )
            count_cursor = await db.execute("SELECT COUNT(*) FROM files")

        rows = await cursor.fetchall()
        count_row = await count_cursor.fetchone()
        total = count_row[0] if count_row else 0
        return [dict(r) for r in rows], total

async def search_files(q: str, category: Optional[str], limit: int, offset: int):
    pattern = f"%{q}%"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if category:
            cursor = await db.execute(
                "SELECT * FROM files WHERE (filename LIKE ? OR caption LIKE ?) AND category = ? ORDER BY date DESC LIMIT ? OFFSET ?",
                (pattern, pattern, category, limit, offset)
            )
            count_cursor = await db.execute(
                "SELECT COUNT(*) FROM files WHERE (filename LIKE ? OR caption LIKE ?) AND category = ?",
                (pattern, pattern, category)
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM files WHERE filename LIKE ? OR caption LIKE ? ORDER BY date DESC LIMIT ? OFFSET ?",
                (pattern, pattern, limit, offset)
            )
            count_cursor = await db.execute(
                "SELECT COUNT(*) FROM files WHERE filename LIKE ? OR caption LIKE ?",
                (pattern, pattern)
            )

        rows = await cursor.fetchall()
        count_row = await count_cursor.fetchone()
        total = count_row[0] if count_row else 0
        return [dict(r) for r in rows], total

async def get_file_by_id(file_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM files WHERE id = ?", (file_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

async def get_stats():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT category, COUNT(*) as count, SUM(size) as total_size
            FROM files GROUP BY category
        """)
        rows = await cursor.fetchall()
        total_cursor = await db.execute("SELECT COUNT(*), SUM(size) FROM files")
        total_row = await total_cursor.fetchone()
        return {
            "by_category": [dict(r) for r in rows],
            "total_files": total_row[0] or 0,
            "total_size": total_row[1] or 0,
        }
