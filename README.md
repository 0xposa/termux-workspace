# Termux Workspace

Add-on resmi untuk Termux (versi F-Droid, `com.termux`, tidak dimodifikasi) yang menyediakan lingkungan terminal modern berbasis web dan aplikasi Android WebView fullscreen immersive dengan PTY shell Termux asli melalui tmux.

*An official add-on for Termux (F-Droid version, `com.termux`, unmodified) providing a modern web-based terminal workspace and a fullscreen immersive Android Kotlin WebView add-on running native Termux PTY shells via tmux.*

---

## Bahasa Indonesia

### Gambaran Umum
Termux Workspace terdiri dari 3 komponen utama:
1. **Server Web Latar Belakang (Python)**:
   - Berjalan di Termux menggunakan FastAPI dan Uvicorn.
   - Bind strictly ke `127.0.0.1` pada port dicadangkan `24817`.
   - Autentikasi ketat berbasis token (64-karakter hex acak) untuk seluruh endpoint HTTP dan WebSocket dengan `secrets.compare_digest`.
   - Verifikasi header `Origin` pada WebSocket (`http://127.0.0.1:24817`).
   - Manajemen sesi terminal lewat `tmux` dan PTY (`pty.fork`).
2. **Antarmuka Web (Frontend Vanilla JS & CSS)**:
   - Layar tablet tema gelap (`#14161C`, `#1E222B`, `#E6E8EC`).
   - Terminal xterm.js dengan FitAddon lokal di `web/vendor/` (tanpa CDN).
   - Sidebar Explorer: pohon direktori yang bisa dilipat (`«`), mulai dari HOME, memuat saat folder dibuka, tombol titik tiga (`⋮`) untuk menu opsi (Open in terminal, Open in editor, Rename, Move, Delete).
   - Bar Tab: manajemen sesi shell (Bash, Zsh, dll.), tombol tutup `x`, tombol `+` dengan gradien `#5EF0B4` ke `#C86DFF`.
   - Menu Popup & Pencarian: aksi Terminal, Explorer, Split View, pencarian aksi / shortcut `Ctrl + K`.
   - Split View: membagi layar menjadi 2 terminal berdampingan.
   - Code Editor Full View (CodeMirror 6): Editor teks modern CodeMirror 6 dengan tema One Dark, syntax highlighting (JavaScript, Python, HTML, CSS, JSON, Markdown), pelacak kursor (Ln/Col), tombol & pintasan Simpan (`Ctrl+S`), indentasi tab cerdas, serta tampil secara full view (tanpa split screen).
   - Baris Tombol Ekstra: Esc, Tab, Ctrl (toggle sekali pakai), Alt (toggle sekali pakai), dan panah navigasi (←, ↑, ↓, →).
3. **Aplikasi Android Kotlin Add-on**:
   - Application ID: `com.workspace.termuxui`.
   - Fullscreen immersive (sembunyikan status dan navigation bar).
   - Penanganan otomatis tombol Back (`moveTaskToBack`) dan penyesuaian padding keyboard layar (IME insets).
   - Mengirim intent `RUN_COMMAND` ke `com.termux.app.RunCommandService` untuk menyalakan server di latar belakang secara otomatis.

---

### Persyaratan
- Perangkat Android dengan **Termux versi F-Droid** (package `com.termux`).
- Python 3, tmux, nodejs, dan git di Termux.

---

### Cara Pemasangan & Setup
Jalankan skrip setup otomatis di dalam Termux:
```bash
cd ~/termux-workspace
./setup.sh
```
Skrip ini bersifat idempoten dan akan:
1. Memperbarui paket Termux (`python`, `tmux`, `nodejs`, `git`).
2. Memasang dependensi Python (`fastapi`, `uvicorn`, `websockets`, `pydantic`).
3. Mengunduh pustaka `@xterm/xterm` dan `@xterm/addon-fit` terbaru ke folder `web/vendor/`.
4. Menambahkan konfigurasi `allow-external-apps=true` di `~/.termux/termux.properties`.
5. Memberikan izin eksekusi pada skrip penyala.

---

### Cara Penggunaan

#### Cara 1: Menggunakan Browser Web
1. Nyalakan server secara manual:
   ```bash
   ./start.sh
   ```
2. Skrip akan mencetak URL lengkap beserta token acak:
   ```text
   http://127.0.0.1:24817/?token=<64_hex_token>
   ```
3. Buka URL tersebut di browser web favorit Anda pada perangkat yang sama.

Untuk me-restart atau menghentikan server:
```bash
./start.sh --restart
```

#### Cara 2: Menggunakan Aplikasi Android Add-on (APK)
1. **Build APK**:
   Push kode ke repositori GitHub. GitHub Actions akan secara otomatis mengompilasi APK debug via workflow `.github/workflows/build-apk.yml`. Unduh file `app-debug.apk` dari bagian Artifacts di GitHub.
2. **Izin Tambahan**:
   Buka **Settings Android** $\to$ **Apps** $\to$ **Termux Workspace** $\to$ **Permissions** $\to$ **Additional permissions** $\to$ Izinkan **"Run commands in Termux environment"** (`com.termux.permission.RUN_COMMAND`).
3. **Buka Aplikasi**:
   Buka aplikasi dari launcher. Aplikasi akan otomatis membuat token, memicu `RUN_COMMAND` untuk menjalankan `start.sh`, dan menampilkan terminal fullscreen.

#### Cara 3: Live Development Preview (Port Khusus 24818)
Saat mengembangkan antarmuka atau fitur baru Termux Workspace tanpa mengganggu server utama (port 24817):
```bash
# Jalankan server preview
./preview.sh

# Atau langsung buka di browser perangkat:
./preview.sh --open
```
- Akses URL: `http://127.0.0.1:24818/?token=preview`
- Untuk menghentikan server preview: `./preview.sh --stop`

---

## English

### Overview
Termux Workspace consists of three core components:
1. **Background Web Server (Python)**:
   - Runs directly inside Termux using FastAPI and Uvicorn.
   - Strictly bound to `127.0.0.1` on reserved port `24817`.
   - Enforces token authentication (64-character random hex) on all HTTP and WebSocket endpoints via `secrets.compare_digest`.
   - Validates WebSocket `Origin` header (`http://127.0.0.1:24817`).
   - Manages tmux sessions and PTY processes (`pty.fork`).
2. **Web Interface (Vanilla JS, HTML, CSS)**:
   - Dark theme tablet interface (`#14161C`, `#1E222B`, `#E6E8EC`).
   - Powered by `@xterm/xterm` and `@xterm/addon-fit` stored locally in `web/vendor/` (100% offline, zero CDN).
   - Collapsible Sidebar Explorer (`«`), starting at HOME, folder on-demand loading, three-dots context menu (`⋮`) on files & folders (Open in terminal, Open in editor, Rename, Move, Delete).
   - Session Tab Bar: active tab close button `x`, gradient `+` button (`#5EF0B4` to `#C86DFF`).
   - Popup Menu with action filtering and `Ctrl + K` shortcut.
   - Split View: two side-by-side terminal panels with independent focus.
   - Full-View Code Editor (CodeMirror 6): Modern CodeMirror 6 text editor with One Dark theme, syntax highlighting (JavaScript, Python, HTML, CSS, JSON, Markdown), cursor position tracker (Ln/Col), save button & shortcut (`Ctrl+S`), smart tab indentation, opening in distraction-free full view (no split screen).
   - Extra Keys Toolbar: Esc, Tab, single-use toggle Ctrl/Alt, and navigation arrows (←, ↑, ↓, →).
3. **Android Kotlin Add-on Application**:
   - Application ID: `com.workspace.termuxui`.
   - Fullscreen immersive UI (hiding system status and navigation bars).
   - Smooth IME (virtual keyboard) insets handling and non-destructive Back button (`moveTaskToBack`).
   - Dispatches `com.termux.RUN_COMMAND` intent to `com.termux.app.RunCommandService` to automatically start the workspace server in the background.

---

### Setup Instructions
Run the setup script inside Termux:
```bash
cd ~/termux-workspace
./setup.sh
```

---

### How to Run

#### Option A: Run via Web Browser
```bash
./start.sh
```
Open the printed URL in your device's web browser:
```text
http://127.0.0.1:24817/?token=<64_hex_token>
```

#### Option B: Run via Android Add-on App (APK)
1. **Build APK**:
   Push the repository to GitHub. GitHub Actions builds the debug APK automatically via `.github/workflows/build-apk.yml`. Download `app-debug.apk` from the GitHub Actions Artifacts tab.
2. **Grant Permissions**:
   Open **Android Settings** $\to$ **Apps** $\to$ **Termux Workspace** $\to$ **Permissions** $\to$ **Additional permissions** $\to$ Enable **"Run commands in Termux environment"**.
3. **Launch the App**:
   Open **Termux Workspace** from your app drawer. It will bootstrap the server via Termux `RUN_COMMAND` and display the workspace in fullscreen.

#### Option C: Live Development Preview (Dedicated Port 24818)
When developing the UI or testing new features without interfering with the primary workspace server (port 24817):
```bash
# Start preview server
./preview.sh

# Or open directly in device browser:
./preview.sh --open
```
- Preview URL: `http://127.0.0.1:24818/?token=preview`
- Stop preview server: `./preview.sh --stop`

---

## Security & Architecture Details
- **Localhost Isolation**: The server binds exclusively to `127.0.0.1`.
- **Timing Attack Defense**: All tokens are compared in constant time with `secrets.compare_digest`.
- **Cross-Origin Protection**: WebSockets enforce Origin `http://127.0.0.1:24817`.
- **Zero Token Leakage**: Tokens are stripped from logs and URL history.
- **Port Reservation**: Port `24817` is reserved exclusively for Termux Workspace.
