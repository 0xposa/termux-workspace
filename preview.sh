#!/data/data/com.termux/files/usr/bin/bash

# ==============================================================================
# Port localhost khusus untuk Preview Realtime Pengembangan Termux Workspace
# Port 24817 tetap dicadangkan khusus untuk server utama (start.sh).
# ==============================================================================

PREVIEW_PORT=24818
PREVIEW_TOKEN="preview"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$HOME/.termux-workspace"
PID_FILE="$WORK_DIR/preview.pid"
LOG_FILE="$WORK_DIR/preview.log"

mkdir -p "$WORK_DIR"

# Perintah untuk mematikan server preview: ./preview.sh --stop
if [ "$1" = "--stop" ]; then
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      echo "Server preview telah dihentikan (PID: $PID)."
    else
      echo "Server preview tidak sedang berjalan."
    fi
    rm -f "$PID_FILE"
  else
    echo "Tidak ada proses preview yang tercatat."
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

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock 2>/dev/null || true
fi

# Jalankan server preview di latar belakang pada port 24818
if command -v setsid >/dev/null 2>&1; then
  nohup setsid python -u "$SCRIPT_DIR/server/main.py" --token "$PREVIEW_TOKEN" --port "$PREVIEW_PORT" </dev/null >> "$LOG_FILE" 2>&1 &
else
  nohup python -u "$SCRIPT_DIR/server/main.py" --token "$PREVIEW_TOKEN" --port "$PREVIEW_PORT" </dev/null >> "$LOG_FILE" 2>&1 &
fi
PREVIEW_PID=$!
echo "$PREVIEW_PID" > "$PID_FILE"
disown "$PREVIEW_PID" 2>/dev/null || true

PREVIEW_URL="http://127.0.0.1:${PREVIEW_PORT}/?token=${PREVIEW_TOKEN}"

echo "=========================================================="
echo " [LIVE PREVIEW] Termux Workspace Development Server"
echo "=========================================================="
echo "Port Khusus Preview : ${PREVIEW_PORT}"
echo "URL Preview         : ${PREVIEW_URL}"
echo "Log Preview         : ${LOG_FILE}"
echo "Hentikan Preview    : ./preview.sh --stop"
echo "=========================================================="

# Buka otomatis di browser perangkat jika opsi --open diberikan
if [ "$1" = "--open" ] || [ "$2" = "--open" ]; then
  if command -v termux-open-url >/dev/null 2>&1; then
    echo "Membuka browser perangkat..."
    sleep 1
    termux-open-url "$PREVIEW_URL"
  fi
fi
