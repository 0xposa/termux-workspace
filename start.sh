#!/data/data/com.termux/files/usr/bin/bash

# Port dicadangkan untuk Termux Workspace
PORT=24817
TOKEN=""
RESTART=false

while [ $# -gt 0 ]; do
  case "$1" in
    --token)
      TOKEN="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --restart)
      RESTART=true
      shift 1
      ;;
    *)
      shift 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$HOME/.termux-workspace"
PID_FILE="$WORK_DIR/server.pid"
LOG_FILE="$WORK_DIR/server.log"

mkdir -p "$WORK_DIR"

if [ "$RESTART" = true ] && [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    for _ in {1..30}; do
      if ! kill -0 "$OLD_PID" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$OLD_PID" 2>/dev/null; then
      kill -9 "$OLD_PID" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
fi

URL_PRINT=false
if [ -z "$TOKEN" ]; then
  TOKEN=$(python -c "import secrets; print(secrets.token_hex(32))")
  URL_PRINT=true
fi

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock 2>/dev/null || true
fi

if command -v setsid >/dev/null 2>&1; then
  nohup setsid python -u "$SCRIPT_DIR/server/main.py" --token "$TOKEN" --port "$PORT" </dev/null >> "$LOG_FILE" 2>&1 &
else
  nohup python -u "$SCRIPT_DIR/server/main.py" --token "$TOKEN" --port "$PORT" </dev/null >> "$LOG_FILE" 2>&1 &
fi
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"
disown "$SERVER_PID" 2>/dev/null || true

if [ "$URL_PRINT" = true ]; then
  echo "http://127.0.0.1:${PORT}/?token=${TOKEN}"
fi
