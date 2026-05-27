# AirDrive

Browse, search, stream and download your Telegram-backed file library from a web interface.

## Project Structure

```
airdrive/
├── backend/          # FastAPI + Pyrogram
│   ├── main.py
│   ├── db.py
│   ├── requirements.txt
│   ├── .env
│   ├── render.yaml
│   └── get_session.py
└── frontend/         # React + Vite
    ├── src/
    │   ├── App.jsx
    │   ├── index.css
    │   └── main.jsx
    ├── index.html
    ├── package.json
    └── .env
```

## Setup

### Step 1 — Get Session String (run in Termux once)

```bash
cd ~/airdrive/backend
pip install pyrogram tgcrypto
python3 get_session.py
```

Copy the long session string printed at the end.

### Step 2 — Deploy Backend to Render

1. Push the `backend/` folder to a GitHub repo.
2. Go to [render.com](https://render.com) → New Web Service → connect repo.
3. Set these environment variables in Render dashboard:
   - `API_ID` = 26182818
   - `API_HASH` = e98cc55fabed0fce53269188fa3a0e63
   - `APP_PASSWORD` = your chosen password
   - `JWT_SECRET` = any random 32-char string
   - `SESSION_STRING` = the string from Step 1
4. Build command: `pip install -r requirements.txt`
5. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

Note your Render URL (e.g. `https://airdrive-api.onrender.com`)

### Step 3 — Deploy Frontend to Vercel/Netlify

1. Edit `frontend/.env`:
   ```
   VITE_API_URL=https://your-airdrive-api.onrender.com
   ```
2. Push `frontend/` to GitHub.
3. Deploy to Vercel → it auto-detects Vite.

### Step 4 — Sync your files

1. Open your AirDrive website → login with your password.
2. Click **⟳ Sync** in the sidebar.
3. This scans all 7 Telegram channels and indexes files into the local DB.
4. Sync takes a few minutes depending on file count.

## Features

- 🔒 Password protected
- 📂 Browse by category (Photos, Videos, PDFs, Audio, etc.)
- 🔍 Search by filename
- 🖼️ Inline image preview
- 🎬 Video streaming
- 🎵 Audio playback
- ⬇️ Direct file download
- 📊 Stats (total files, size per category)
- 🔄 Sync button to pull new uploads from Telegram

## Local Development

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```
