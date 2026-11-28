#!/usr/bin/env bash
# Start the three local services the room needs, each only if its port is not already listening.
# LLM (llama.cpp, 4 parallel slots so the report can run its question calls side by side) on 8944, speech to text (whisper.cpp) on 8942, text to speech (Kokoro) on 8943.
# Logs go to media/logs/ (git-ignored). Prints one status line per service.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p media/logs

GGUF="${LOCAL_LLM_GGUF:-$HOME/models/gemma-4-E4B/gemma-4-E4B-it-Q8_0.gguf}"
WAIT_SEC="${SERVICES_WAIT_SEC:-120}"

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# name, port, url that answers once the service is ready
SERVICES=("LLM:8944:http://127.0.0.1:8944/health" "Speech to text:8942:http://127.0.0.1:8942/" "Text to speech:8943:http://127.0.0.1:8943/health")

started=""
if listening 8944; then :; else
  if [ ! -f "$GGUF" ]; then
    echo "LLM model not found at $GGUF. Set LOCAL_LLM_GGUF to a .gguf file." >&2
  else
    nohup llama-server -m "$GGUF" --port 8944 --host 127.0.0.1 -c 16384 -np 4 >media/logs/llm.log 2>&1 &
    started="$started 8944"
  fi
fi
if listening 8942; then :; else
  nohup scripts/whisper-server.sh >media/logs/whisper.log 2>&1 &
  started="$started 8942"
fi
if listening 8943; then :; else
  nohup scripts/kokoro-server.sh >media/logs/kokoro.log 2>&1 &
  started="$started 8943"
fi

status=0
for entry in "${SERVICES[@]}"; do
  IFS=: read -r name port url <<<"$entry"
  case " $started " in
    *" $port "*) was="started" ;;
    *) was="already up" ;;
  esac
  ok=0
  for ((i = 0; i < WAIT_SEC; i++)); do
    if curl -s -o /dev/null -m 2 "$url"; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" = 1 ]; then
    echo "$name (port $port): $was, answering"
  else
    echo "$name (port $port): not answering after ${WAIT_SEC}s, see media/logs/" >&2
    echo "$name (port $port): NOT READY"
    status=1
  fi
done
exit $status
