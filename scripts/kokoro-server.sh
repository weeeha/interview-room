#!/usr/bin/env bash
# Starts the local Kokoro-82M text-to-speech server on port 8943.
set -euo pipefail
cd "$(dirname "$0")/.."
exec uv run --python 3.12 --with kokoro-onnx --with soundfile python scripts/kokoro_server.py
