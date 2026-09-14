#!/usr/bin/env bash
set -euo pipefail

FFMPEG_DIR="$PWD/.render-ffmpeg"
FFMPEG="$FFMPEG_DIR/ffmpeg"
FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-09-14-51/ffmpeg-n9.0.1-27-g9b0578816c-linux64-gpl-9.0.tar.xz"

mkdir -p "$FFMPEG_DIR"

if [[ -x "$FFMPEG" ]]; then
  echo "🎬 Bundled Render FFmpeg already present: $FFMPEG"
  exit 0
fi

# Prefer the Python wheel because it is much smaller and is already installed
# with backend requirements. This avoids a slow/fragile large tarball download.
if python -c 'import imageio_ffmpeg' >/dev/null 2>&1; then
  packaged_ffmpeg="$(python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')"
  if [[ -x "$packaged_ffmpeg" ]]; then
    echo "📦 Installing packaged FFmpeg from imageio-ffmpeg: $packaged_ffmpeg"
    install -m 0755 "$packaged_ffmpeg" "$FFMPEG"
  fi
fi

# Last-resort fallback for environments where the Python wheel was not installed.
if [[ ! -x "$FFMPEG" ]]; then
  echo "🌐 Downloading static Render FFmpeg fallback..."
  mkdir -p .render-ffmpeg-tmp
  trap 'rm -rf .render-ffmpeg-tmp' EXIT
  curl --connect-timeout 15 --max-time 300 --retry 3 --retry-delay 2 \
    -L --fail --silent --show-error "$FFMPEG_URL" \
    -o .render-ffmpeg-tmp/ffmpeg.tar.xz
  tar -xJf .render-ffmpeg-tmp/ffmpeg.tar.xz -C .render-ffmpeg-tmp
  src_ffmpeg="$(find .render-ffmpeg-tmp -type f -path '*/bin/ffmpeg' -print -quit)"
  [[ -n "$src_ffmpeg" ]]
  install -m 0755 "$src_ffmpeg" "$FFMPEG"
fi

"$FFMPEG" -version | head -n 1
"$FFMPEG" -hide_banner -h protocol=http 2>&1 | grep -q request_size
"$FFMPEG" -hide_banner -h protocol=http 2>&1 | grep -q initial_request_size
"$FFMPEG" -hide_banner -h protocol=http 2>&1 | grep -q short_seek_size

echo "✅ Render FFmpeg installed at: $FFMPEG"
