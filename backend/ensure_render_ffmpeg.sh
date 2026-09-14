#!/usr/bin/env bash
set -euo pipefail

FFMPEG_DIR="$PWD/.render-ffmpeg"
FFMPEG="$FFMPEG_DIR/ffmpeg"
FFPROBE="$FFMPEG_DIR/ffprobe"
FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-09-14-51/ffmpeg-n9.0.1-27-g9b0578816c-linux64-gpl-9.0.tar.xz"

if [[ -x "$FFMPEG" && -x "$FFPROBE" ]]; then
  echo "🎬 Bundled Render FFmpeg already present: $FFMPEG"
  exit 0
fi

mkdir -p "$FFMPEG_DIR" .render-ffmpeg-tmp
trap 'rm -rf .render-ffmpeg-tmp' EXIT

if ! command -v curl >/dev/null 2>&1; then
  echo "Installing curl for Render FFmpeg bootstrap..."
  apt-get update
  apt-get install -y curl xz-utils ca-certificates
fi

curl -L --fail --silent --show-error "$FFMPEG_URL" -o .render-ffmpeg-tmp/ffmpeg.tar.xz
tar -xJf .render-ffmpeg-tmp/ffmpeg.tar.xz -C .render-ffmpeg-tmp

src_ffmpeg="$(find .render-ffmpeg-tmp -type f -path '*/bin/ffmpeg' -print -quit)"
src_ffprobe="$(find .render-ffmpeg-tmp -type f -path '*/bin/ffprobe' -print -quit)"
[[ -n "$src_ffmpeg" && -n "$src_ffprobe" ]]

install -m 0755 "$src_ffmpeg" "$FFMPEG"
install -m 0755 "$src_ffprobe" "$FFPROBE"

"$FFMPEG" -version
"$FFMPEG" -hide_banner -h protocol=http 2>&1 | grep -q request_size
"$FFMPEG" -hide_banner -h protocol=http 2>&1 | grep -q initial_request_size
"$FFMPEG" -hide_banner -h protocol=http 2>&1 | grep -q short_seek_size

echo "✅ Render FFmpeg installed at: $FFMPEG"
