#!/data/data/com.termux/files/usr/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Memulai Setup Termux Workspace ==="

# 1. Update pkg dan install paket dasar
pkg update -y
pkg install -y python tmux nodejs git

# 2. Pasang dependensi Python
pip install --no-cache-dir fastapi uvicorn websockets pydantic

# 3. Ambil @xterm/xterm dan @xterm/addon-fit ke web/vendor/
mkdir -p "$SCRIPT_DIR/web/vendor"
echo "Mengambil versi terbaru xterm dari npm..."
XTERM_VER=$(npm view @xterm/xterm version)
FIT_VER=$(npm view @xterm/addon-fit version)
echo "Versi: @xterm/xterm@$XTERM_VER, @xterm/addon-fit@$FIT_VER"

TMP_DIR=$(mktemp -d)
(
  cd "$TMP_DIR"
  npm pack "@xterm/xterm@$XTERM_VER"
  npm pack "@xterm/addon-fit@$FIT_VER"
  tar -xzf xterm-xterm-*.tgz
  cp package/lib/xterm.js "$SCRIPT_DIR/web/vendor/xterm.js"
  cp package/css/xterm.css "$SCRIPT_DIR/web/vendor/xterm.css"
  sed -i -E 's/-9{4}/-10000/g' "$SCRIPT_DIR/web/vendor/xterm.css"
  rm -rf package
  tar -xzf xterm-addon-fit-*.tgz
  cp package/lib/addon-fit.js "$SCRIPT_DIR/web/vendor/addon-fit.js"
  sed -i -E 's/-9{4}/-9998/g' "$SCRIPT_DIR/web/vendor/xterm.js"
)
rm -rf "$TMP_DIR"
echo "File vendor xterm berhasil disimpan di web/vendor/"

# 4. Tambahkan allow-external-apps=true ke ~/.termux/termux.properties jika belum ada
TERMUX_DIR="$HOME/.termux"
TERMUX_PROP="$TERMUX_DIR/termux.properties"
mkdir -p "$TERMUX_DIR"
if [ -f "$TERMUX_PROP" ]; then
  if ! grep -q "^allow-external-apps[[:space:]]*=[[:space:]]*true" "$TERMUX_PROP"; then
    echo "allow-external-apps=true" >> "$TERMUX_PROP"
    echo "Menambahkan allow-external-apps=true ke $TERMUX_PROP"
  fi
else
  echo "allow-external-apps=true" > "$TERMUX_PROP"
  echo "Membuat $TERMUX_PROP dengan allow-external-apps=true"
fi

# 5. Jalankan termux-reload-settings jika tersedia
if command -v termux-reload-settings >/dev/null 2>&1; then
  termux-reload-settings || true
fi

# 6. Set izin eksekusi untuk start.sh dan preview.sh
if [ -f "$SCRIPT_DIR/start.sh" ]; then
  chmod +x "$SCRIPT_DIR/start.sh"
fi
if [ -f "$SCRIPT_DIR/preview.sh" ]; then
  chmod +x "$SCRIPT_DIR/preview.sh"
fi

echo "=== Setup Selesai ==="
