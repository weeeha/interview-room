"""Small HTTP server around Kokoro-82M (kokoro-onnx).

POST /tts {"text": "...", "voice": "af_heart"} -> audio/wav (mono, 16-bit)
GET  /health -> {"ok": true, "voices": [...]}

All synthesis runs on ONE dedicated worker thread: the phonemizer caches per
thread, and a new thread per request costs about a second.
"""
import io
import json
import os
import queue
import threading
from concurrent.futures import Future
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

MODEL_DIR = os.environ.get("KOKORO_DIR", os.path.expanduser("~/models/kokoro"))
PORT = int(os.environ.get("PORT", "8943"))
DEFAULT_VOICE = "af_heart"

kokoro = Kokoro(os.path.join(MODEL_DIR, "kokoro-v1.0.onnx"), os.path.join(MODEL_DIR, "voices-v1.0.bin"))
VOICES = set(kokoro.get_voices())
jobs: "queue.Queue[tuple[str, str, Future]]" = queue.Queue()


def lang_for(voice: str) -> str:
    return "en-gb" if voice.startswith("b") else "en-us"


def render(text: str, voice: str) -> bytes:
    samples, rate = kokoro.create(text, voice=voice, speed=1.0, lang=lang_for(voice))
    buf = io.BytesIO()
    sf.write(buf, np.asarray(samples), rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def worker() -> None:
    while True:
        text, voice, fut = jobs.get()
        try:
            fut.set_result(render(text, voice))
        except Exception as err:  # noqa: BLE001
            fut.set_exception(err)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: dict) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json(200, {"ok": True, "voices": sorted(VOICES)})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/tts":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "bad json"})
        text = str(req.get("text", "")).strip()
        voice = str(req.get("voice") or DEFAULT_VOICE)
        if not text:
            return self._json(400, {"error": "text is empty"})
        if voice not in VOICES:
            return self._json(400, {"error": f"unknown voice {voice}"})
        fut: Future = Future()
        jobs.put((text, voice, fut))
        try:
            self._send(200, fut.result(timeout=60), "audio/wav")
        except Exception as err:  # noqa: BLE001
            self._json(500, {"error": str(err)})

    def log_message(self, fmt: str, *args) -> None:
        pass


if __name__ == "__main__":
    threading.Thread(target=worker, daemon=True).start()
    jobs.put(("Warm up.", DEFAULT_VOICE, Future()))  # first call loads the phonemizer on the worker thread
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"kokoro server on http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
