#!/usr/bin/env bash
# Start the Homebrew whisper.cpp server so it answers the OpenAI transcription API.
# Model: env WHISPER_MODEL, else the first large-v3-turbo ggml file found below.
set -euo pipefail

PORT="${WHISPER_PORT:-8942}"
MODEL="${WHISPER_MODEL:-}"

if [ -z "$MODEL" ]; then
  for dir in "$HOME/whisper.cpp/models" "$HOME/models" "$HOME/.cache" "/opt/homebrew/share"; do
    [ -d "$dir" ] || continue
    found="$(find "$dir" -iname 'ggml-large-v3-turbo*.bin' 2>/dev/null | head -n 1)"
    if [ -n "$found" ]; then MODEL="$found"; break; fi
  done
fi

if [ -z "$MODEL" ] || [ ! -f "$MODEL" ]; then
  echo "No whisper model found. Set WHISPER_MODEL to a ggml .bin file." >&2
  exit 1
fi

echo "whisper-server on 127.0.0.1:${PORT} with ${MODEL}"
exec whisper-server \
  --host 127.0.0.1 \
  --port "$PORT" \
  --model "$MODEL" \
  --inference-path /v1/audio/transcriptions \
  --language en \
  --no-timestamps
