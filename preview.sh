#!/data/data/com.termux/files/usr/bin/bash

# ==============================================================================
# Preview Realtime Pengembangan Termux Workspace
# Host: 127.0.0.1 | Port: 8000 | Live Reload: Aktif (--reload)
# ==============================================================================

PREVIEW_HOST="127.0.0.1"
PREVIEW_PORT=8000
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$HOME/.termux-workspace"
PID_FILE="$WORK_DIR/preview.pid"
LOG_FILE="$WORK_DIR/preview.log"

export PYTHONPATH="$SCRIPT_DIR:$PYTHONPATH"

mkdir -p "$WORK_DIR"

# Perintah untuk mematikan server preview: ./preview.sh --stop
if [ "$1" = "--stop" ]; then
  STOPPED=false
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      STOPPED=true
      echo "Server preview telah dihentikan (PID: $PID)."
    fi
    rm -f "$PID_FILE"
  fi
  # Fallback: cari proses preview jika PID_FILE tidak sinkron
  PIDS=$(pgrep -f "server/main.py.*--port $PREVIEW_PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    kill $PIDS 2>/dev/null || true
    STOPPED=true
    echo "Server preview (port $PREVIEW_PORT) telah dihentikan."
  fi
  if [ "$STOPPED" = false ]; then
    echo "Server preview tidak sedang berjalan."
  fi
  exit 0
fi

# Hentikan proses server preview lama jika masih aktif
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    for _ in {1..20}; do
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

OLD_PIDS=$(pgrep -f "server/main.py.*--port $PREVIEW_PORT" 2>/dev/null || true)
if [ -n "$OLD_PIDS" ]; then
  kill $OLD_PIDS 2>/dev/null || true
  sleep 0.2
fi

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock 2>/dev/null || true
fi

# Jalankan server preview di latar belakang tanpa token pada host 127.0.0.1 port 8000 dengan --reload
if command -v setsid >/dev/null 2>&1; then
  nohup setsid python -u "$SCRIPT_DIR/server/main.py" --no-auth --host "$PREVIEW_HOST" --port "$PREVIEW_PORT" --reload </dev/null >> "$LOG_FILE" 2>&1 &
else
  nohup python -u "$SCRIPT_DIR/server/main.py" --no-auth --host "$PREVIEW_HOST" --port "$PREVIEW_PORT" --reload </dev/null >> "$LOG_FILE" 2>&1 &
fi
PREVIEW_PID=$!
echo "$PREVIEW_PID" > "$PID_FILE"
disown "$PREVIEW_PID" 2>/dev/null || true

PREVIEW_URL="http://${PREVIEW_HOST}:${PREVIEW_PORT}/"

echo "=========================================================="
echo " [LIVE PREVIEW] Termux Workspace Development Server"
echo "=========================================================="
echo "Host Preview        : ${PREVIEW_HOST}"
echo "Port Preview        : ${PREVIEW_PORT}"
echo "Auto Reload         : Aktif (--reload)"
echo "URL Preview         : ${PREVIEW_URL}"
echo "Log Preview         : ${LOG_FILE}"
echo "Hentikan Preview    : ./preview.sh --stop"
echo "=========================================================="

# Buka otomatis di browser perangkat jika opsi --open diberikan
if [ "$1" = "--open" ] || [ "$2" = "--open" ]; then
  if command -v termux-open-url >/dev/null 2>&1; then
    echo "Membuka browser perangkat..."
    sleep 2
    termux-open-url "$PREVIEW_URL"
  fi
fi
