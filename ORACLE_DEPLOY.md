# Oracle ARM64 backend deployment (Quantxdrive)

This deploys **only the FastAPI backend** alongside YCT Driver. Do not reuse YCT's Telegram session, service, port or environment file.

## Prerequisites

- Ubuntu 24.04 ARM64 Oracle VM with SSH access
- Existing YCT Driver on port 8000
- Your own Telegram Pyrogram session string, API ID and API hash
- A separate HTTPS origin for the API and the deployed Vercel frontend origin
- **Do not publish port 8010 directly**. Bind to localhost and publish through a TLS reverse proxy or authenticated Cloudflare Tunnel.

## Install (run on Oracle)

```bash
sudo apt-get update
sudo apt-get install -y git python3-venv python3-pip ffmpeg
mkdir -p ~/apps ~/data/quantxdrive
cd ~/apps
git clone https://github.com/akggautamasar/Quantxdrive.git
cd Quantxdrive/backend
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
```

**ARM64 note:** `hls_service.py` currently expects the Render-specific FFmpeg binary and may attempt to download it. Before enabling HLS video transcoding, update its FFmpeg discovery to prefer `/usr/bin/ffmpeg` on Oracle and test seeking and byte ranges. Basic API installation does not establish HLS compatibility.

## Secrets

Create `/home/ubuntu/.config/quantxdrive/env` with restrictive permissions:

```bash
mkdir -p ~/.config/quantxdrive
chmod 700 ~/.config/quantxdrive
umask 077
nano ~/.config/quantxdrive/env
```

Use this template (replace every placeholder with real values, **never commit this file**):

```ini
API_ID=REPLACE_WITH_TELEGRAM_API_ID
API_HASH=REPLACE_WITH_TELEGRAM_API_HASH
SESSION_STRING=REPLACE_WITH_PYROGRAM_SESSION_STRING
APP_PASSWORD=REPLACE_WITH_LONG_RANDOM_PASSWORD
JWT_SECRET=REPLACE_WITH_RANDOM_SECRET_AT_LEAST_32_BYTES
INDEX_CHANNEL_ID=me
BOT_TOKEN=
PORT=8010
HLS_CACHE_DIR=/home/ubuntu/data/quantxdrive/hls
```

The current application has insecure fallback credentials in `main.py`; configure all required secrets before starting, and remove these fallbacks before public exposure. If credentials were published in repository history, rotate them.

## systemd service

```bash
sudo tee /etc/systemd/system/quantxdrive.service >/dev/null <<'EOF'
[Unit]
Description=Quantxdrive FastAPI backend
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/apps/Quantxdrive/backend
EnvironmentFile=/home/ubuntu/.config/quantxdrive/env
ExecStart=/home/ubuntu/apps/Quantxdrive/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8010
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now quantxdrive
sudo systemctl status quantxdrive --no-pager
curl -i --max-time 15 http://127.0.0.1:8010/ping
```

The backend requires a valid Pyrogram session at startup. A missing or invalid session can prevent it from becoming healthy. Inspect errors with `sudo journalctl -u quantxdrive -n 80 --no-pager`; never paste session strings or secrets into chat.

## Vercel frontend

Set `VITE_API_URL` to the **public HTTPS API origin** in the Vercel project settings and redeploy the frontend. A local Oracle URL such as `http://127.0.0.1:8010` is not reachable from Vercel visitors' browsers. Restrict FastAPI CORS to the exact Vercel frontend origin before publishing.

## Resource isolation and verification

- Keep YCT on port 8000, Quantxdrive on port 8010.
- Limit FFmpeg to one low-resolution encode at a time on the 2-core VM; monitor CPU, RAM and HLS cache disk use.
- Do not reuse the YCT Telegram session unless you explicitly intend to; simultaneous sessions and conflicting library indexes can cause surprises.
- Check `sudo systemctl is-active yct-driver quantxdrive`, `curl http://127.0.0.1:8000/healthz` and `curl http://127.0.0.1:8010/ping`.
- Test login, channel sync, file listing, range streaming, video playback, share expiry and Vercel CORS before declaring production readiness.
- Protect the public API with HTTPS, authentication and rate limiting. Public media URLs and Telegram bot file URLs can leak credentials if logged or shared.

This guide is a deployment preparation document, **not evidence that the backend has been deployed or tested on Oracle**.
