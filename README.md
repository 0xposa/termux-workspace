# Termux Workspace

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/0xposa/termux-workspace)](https://github.com/0xposa/termux-workspace/stargazers)
[![Twitter Follow](https://img.shields.io/twitter/follow/0xposa?style=social)](https://x.com/0xposa)

An official add-on for Termux (F-Droid version, `com.termux`, unmodified) providing a modern web-based IDE and terminal workspace, along with a fullscreen immersive Android Kotlin WebView companion running native Termux PTY shells via tmux.

*Add-on resmi untuk Termux (versi F-Droid, `com.termux`, tanpa modifikasi) yang menyediakan lingkungan IDE dan Terminal Workspace modern berbasis web serta aplikasi Android WebView fullscreen immersive dengan PTY shell Termux asli melalui tmux.*

---

## 👨‍💻 Author & Maintainer
Created and maintained by:
* **Twitter / X**: [@0xposa](https://x.com/0xposa)
* **GitHub**: [@0xposa](https://github.com/0xposa)

---

## 🇬🇧 English

### 🌟 Overview & Purpose
**Termux Workspace** transforms your Android device into a complete, self-contained software engineering workstation. Tailored specifically for Termux on non-rooted Android devices, it delivers a desktop-grade IDE experience (resembling VS Code and macOS Finder) directly inside your web browser or via a companion Android WebView application.

The project is built on three core pillars:
1. **Backend Server (Python / FastAPI / Uvicorn)**: Orchestrates PTY shell processes, `tmux` sessions, constant-time token authentication, and the filesystem REST API.
2. **Web Frontend (Vanilla JS, CSS & HTML)**: A sleek *macOS Frosted Glass* dark-themed interface featuring CodeMirror 6, a Dual Storage File Manager, and responsive xterm.js terminal instances.
3. **Android Add-on App (Kotlin)**: A fullscreen immersive WebView container that triggers and manages the Termux background server via the Termux `RUN_COMMAND` Service.

---

### 🚀 Key Features

#### 1. Dual Storage File Manager
* **Termux Storage (`~`)**: Quick access to the internal Termux environment (`$HOME` / `/data/data/com.termux/files/home`) for all your coding projects, git repos, scripts, and Linux dotfiles.
* **Android Storage (`/sdcard`)**: Full access to Android shared internal storage (`/storage/emulated/0`) to manage files in *Download*, *Documents*, *Pictures*, *DCIM*, or external project folders.
* **Pill Storage Switcher**: Convenient pill toggle buttons on the explorer toolbar to instantly jump between Termux Storage and Android Storage.
* **Smart Breadcrumbs**: Clean, intuitive path segments anchored at `📦 Termux Storage` and `📱 Android Storage` with guardrails preventing navigation outside allowed sandbox roots (eliminating *403 Forbidden* errors).
* **Two View Modes**:
  * **List Mode**: Traditional structured table with file type icons, names, language badges, and action buttons.
  * **Grid Mode**: Modern *macOS Finder*-style icon cards with quick action buttons.
* **Hidden Files Toggle (Dotfiles)**: Hidden files (starting with `.`) are tucked away by default and can be toggled on/off with a single click on the toolbar eye button.
* **Real-time Search Filter**: Instant directory filtering as you type.
* **Complete Filesystem Operations**:
  * Create New File & Create New Folder.
  * Rename files and directories.
  * Move items to new destination paths.
  * Delete files and folders with safe confirmation dialogs.
  * Open in Terminal (`Open in Terminal`) or Open in Editor (`Open in Editor`).
* **Desktop-Grade Context Menus**:
  * Right-click on any file or folder to access item-specific actions.
  * Right-click on blank explorer background to create files/folders, open terminal at current path, refresh, or toggle hidden files.

#### 2. Full-View Code Editor (CodeMirror 6)
* **Distraction-Free Full View**: Focused, full-screen editing without split-screen clutter.
* **Syntax Highlighting**: Comprehensive support for JavaScript, TypeScript, Python, HTML, CSS, JSON, Markdown, Shell script (`.sh`, `.bash`, `.zsh`), YAML, TOML, SQL, and more.
* **One Dark Theme**: High-contrast, developer-friendly dark theme optimized for long coding sessions.
* **Multi-Tab Workspace**: Open multiple files simultaneously with unsaved change badges (`●`) and tab close handlers.
* **Desktop Right-Click Context Menu**:
  * **Cut** & **Copy** text selections.
  * **Paste** text from clipboard.
  * **Select All** text in the document.
  * **Save File** (`Ctrl + S`).
  * **Send Path to Terminal**: Types the active file's shell-escaped path into the running terminal.
  * **Close File**.
* **Informative Status Bar**: Real-time cursor position tracking (Line/Column - Ln/Col), character count, UTF-8 encoding, and active file format.

#### 3. Multi-Session Terminal (xterm.js & PTY/tmux)
* **Multi-Session Tabs**: Manage multiple concurrent shell sessions with ease.
* **Native tmux & PTY Integration**: Directly connects to native Termux shells via WebSocket and `pty.fork`, preserving full compatibility with CLI utilities (vim, nano, htop, git, python, etc.).
* **Desktop Terminal Context Menu**: Right-click on the terminal provides Copy, Paste, Select All, Clear screen, New session, Open Termux Storage, and Open Android Storage.
* **Zero Right-Click Conflict**: Cleanly suppresses default browser context menus and underlying tmux mouse popups.
* **Mobile Extra Keys Toolbar**: Dedicated soft keys for mobile keyboards (Esc, Tab, single-use Ctrl/Alt toggles, Arrow navigation ←, ↑, ↓, →).

#### 4. Security & High Performance
* **Localhost Binding**: Server binds exclusively to loopback address `127.0.0.1`.
* **Constant-Time Token Auth**: 64-character random hex token validated with `secrets.compare_digest` to eliminate timing attacks.
* **WebSocket Origin Verification**: Rejects any WebSocket requests originating from unexpected origins.
* **Path Traversal Sandboxing**: Validates and confines filesystem access strictly within Termux Home and Android Shared Storage.
* **100% Offline (Zero CDN)**: All vendor assets (xterm.js, FitAddon, CodeMirror 6, and SVG/PNG icons) are bundled locally.

---

### 📦 Prerequisites
1. Android device running Android 7.0+.
2. **Termux app from F-Droid** (package `com.termux`).
3. Android shared storage access: Run `termux-setup-storage` inside Termux to grant permission for `/storage/emulated/0`.
4. Required Termux packages: `python`, `tmux`, `nodejs`, and `git`.

---

### 🛠️ Installation & Setup

Execute the following commands inside Termux:
```bash
# Clone the repository
git clone https://github.com/0xposa/termux-workspace.git ~/termux-workspace
cd ~/termux-workspace

# Grant execution permissions
chmod +x setup.sh start.sh preview.sh

# Setup Android storage access if not done yet
termux-setup-storage

# Run the automated setup script
./setup.sh
```

---

### 🚦 Running the Workspace

#### Option A: Production Mode (start.sh)
```bash
./start.sh
```
The server will start on port `24817` and output the authenticated URL:
```text
http://127.0.0.1:24817/?token=<64_hex_token>
```
Open this URL in any modern Android browser.

To restart or stop the production server:
```bash
./start.sh --restart
```

#### Option B: Live Development & Preview Mode (preview.sh)
```bash
# Start preview server on port 8000
./preview.sh

# Or start and automatically open in default browser:
./preview.sh --open
```
- URL: `http://127.0.0.1:8000/` (no token needed, live reload enabled).
- Stop preview server: `./preview.sh --stop`.

#### Option C: Android Add-on App (APK)
1. **Download APK**: Download `app-debug.apk` generated automatically by GitHub Actions from the repository's **Actions** $\to$ **Artifacts** section.
2. **Grant Permission**: Go to **Android Settings** $\to$ **Apps** $\to$ **Termux Workspace** $\to$ **Permissions** $\to$ **Additional permissions** $\to$ Enable **"Run commands in Termux environment"**.
3. **Launch**: Open **Termux Workspace** from your app drawer. It will bootstrap the server and enter fullscreen mode automatically.

---

### ⌨️ Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| `Ctrl + K` | Open action popup menu & New Session search |
| `Ctrl + S` | Save active file in Code Editor |
| `Ctrl + L` | Clear active terminal screen |
| `Tab` | 2-space indentation in editor or autocompletion in terminal |
| `Right Click` (File/Folder) | Item context menu (Terminal, Editor, Rename, Move, Delete) |
| `Right Click` (Blank Area) | Directory context menu (New File, New Folder, Terminal, Refresh, Toggle Hidden) |
| `Right Click` (Terminal) | Desktop terminal menu (Copy, Paste, Select All, Clear, Storage shortcuts) |
| `Right Click` (Editor) | Desktop editor menu (Cut, Copy, Paste, Select All, Save, Send Path, Close) |

---

<br>

## 🇮🇩 Bahasa Indonesia

### 🌟 Gambaran Umum & Fungsi
**Termux Workspace** mengubah perangkat Android Anda menjadi stasiun kerja pemrograman (coding workstation) yang lengkap dan mandiri. Dirancang khusus untuk lingkungan Termux tanpa memerlukan root, aplikasi ini menghadirkan pengalaman layaknya desktop IDE (seperti VS Code / macOS Finder) langsung melalui browser web atau aplikasi pendamping Android.

Proyek ini terdiri dari 3 pilar utama:
1. **Backend Server (Python / FastAPI / Uvicorn)**: Mengelola sesi PTY shell, interaksi `tmux`, autentikasi token, serta API sistem berkas (Filesystem REST API).
2. **Web Frontend (Vanilla JS, CSS & HTML)**: Antarmuka modern bertema gelap *macOS Frosted Glass*, Code Editor CodeMirror 6, Dual Storage File Manager, dan terminal xterm.js responsif.
3. **Aplikasi Android Add-on (Kotlin)**: Wrapper WebView *fullscreen immersive* yang secara otomatis memicu server Termux di latar belakang menggunakan Termux `RUN_COMMAND` Service.

---

### 🚀 Fitur-Fitur Utama

#### 1. Dual Storage File Manager
* **Termux Storage (`~`)**: Akses cepat ke direktori home Termux (`$HOME` / `/data/data/com.termux/files/home`) untuk seluruh proyek, repositori git, script, dan konfigurasi Linux Anda.
* **Android Storage (`/sdcard`)**: Akses penuh ke penyimpanan bersama internal Android (`/storage/emulated/0`) untuk mengelola file di folder *Download*, *Documents*, *Pictures*, *DCIM*, atau project eksternal.
* **Pill Storage Switcher**: Tombol pengalih cepat berbentuk pill di toolbar explorer untuk berpindah antara Termux Storage dan Android Storage secara instan.
* **Smart Breadcrumbs**: Tampilan hierarki folder yang bersih berakar dari `📦 Termux Storage` dan `📱 Android Storage` dengan proteksi bawaan agar navigasi tidak melompat ke root sistem yang terlarang (mencegah error *403 Forbidden*).
* **Dua Mode Tampilan**:
  * **List Mode**: Tampilan tabel daftar tradisional dengan ikon tipe file, nama file, badge bahasa, dan menu aksi.
  * **Grid Mode**: Tampilan kartu ikon modern ala *macOS Finder* yang memudahkan visualisasi file dan folder.
* **Toggle File Tersembunyi (Dotfiles)**: File tersembunyi (diawali titik `.`) disembunyikan secara default untuk menjaga kebersihan visual, dan dapat ditampilkan/disembunyikan kapan saja melalui tombol mata di toolbar.
* **Filter Pencarian Cepat**: Filter pencarian *real-time* yang menyaring file dan folder di direktori aktif saat Anda mengetik.
* **Operasi Berkas Lengkap**:
  * Buat File Baru & Buat Folder Baru.
  * Ganti Nama (Rename) file/folder.
  * Pindahkan (Move) file/folder ke direktori lain.
  * Hapus (Delete) file/folder dengan dialog konfirmasi aman.
  * Buka di Terminal (`Open in Terminal`) atau Buka di Editor (`Open in Editor`).
* **Desktop Context Menu (Klik Kanan)**:
  * Klik kanan pada file atau folder menampilkan menu opsi lengkap.
  * Klik kanan pada area kosong explorer menampilkan menu untuk membuat file/folder baru, membuka terminal di lokasi tersebut, menyegarkan tampilan (refresh), atau mengalihkan file tersembunyi.

#### 2. Code Editor Modern (CodeMirror 6)
* **Full-View Editor**: Mode penyuntingan fokus layar penuh tanpa distraksi *split screen*.
* **Syntax Highlighting Lengkap**: Mendukung JavaScript, TypeScript, Python, HTML, CSS, JSON, Markdown, Shell script (`.sh`, `.bash`, `.zsh`), YAML, TOML, SQL, dan banyak lagi.
* **One Dark Theme**: Tema gelap kontras tinggi yang nyaman di mata untuk sesi coding jangka panjang.
* **Sistem Tab Editor**: Buka banyak file sekaligus dalam tab terpisah, dilengkapi indikator perubahan belum disimpan (*dirty indicator* `●`) dan tombol tutup tab.
* **Desktop Right-Click Context Menu**: Menu klik kanan desktop khusus di area editor dengan opsi:
  * **Potong (Cut)** & **Salin (Copy)** seleksi teks.
  * **Tempel (Paste)** teks dari clipboard.
  * **Pilih Semua (Select All)** teks dalam dokumen.
  * **Simpan File (Save)** (`Ctrl + S`).
  * **Kirim Path ke Terminal**: Mengetikkan path file yang sedang aktif ke terminal yang sedang berjalan secara instan.
  * **Tutup File**.
* **Status Bar Informatif**: Menampilkan posisi kursor (Baris/Kolom - Ln/Col), jumlah total karakter, encoding UTF-8, serta format bahasa file yang aktif.

#### 3. Terminal Multi-Sesi (xterm.js & PTY/tmux)
* **Manajemen Multi-Sesi**: Jalankan banyak sesi terminal independen sekaligus dengan tab navigasi.
* **Integrasi Native tmux & PTY**: Terminal terhubung langsung ke shell Termux asli melalui WebSocket dan `pty.fork`, memastikan kompatibilitas penuh dengan tool CLI (vim, nano, htop, git, python, dll.).
* **Desktop Terminal Context Menu**: Klik kanan pada terminal menampilkan menu desktop (Salin seleksi, Tempel dari clipboard, Pilih semua teks, Bersihkan layar / Clear, Sesi baru, Buka Termux Storage, dan Buka Android Storage).
* **Bebas Konflik Menu**: Seluruh menu klik kanan default browser dan popup mouse tmux dinonaktifkan secara bersih sehingga hanya menu desktop Termux Workspace yang muncul.
* **Mobile Extra Keys Bar**: Tombol bantu khusus keyboard mobile di bagian bawah (Esc, Tab, Ctrl toggle, Alt toggle, Panah Kiri, Atas, Bawah, Kanan).

#### 4. Keamanan & Performa Tinggi
* **Isolasi Localhost**: Server hanya melakukan binding secara eksklusif ke IP loopback `127.0.0.1`.
* **Autentikasi Token Aman**: Menggunakan token hex acak 64-karakter dengan verifikasi *constant-time* (`secrets.compare_digest`) guna mencegah serangan *timing attack*.
* **Proteksi WebSocket Origin**: Menolak koneksi WebSocket dari luar origin terpercaya (`http://127.0.0.1:24817`).
* **Path Traversal Sandboxing**: Endpoint sistem berkas memvalidasi dan membatasi akses direktori hanya ke lingkungan Termux Home (`$HOME`) dan Android Shared Storage (`/storage/emulated/0`).
* **100% Offline (Zero CDN)**: Seluruh pustaka JavaScript (xterm.js, FitAddon, CodeMirror 6) dan aset ikon SVG/PNG tersimpan secara lokal tanpa bergantung pada koneksi internet.

---

### 📦 Persyaratan Sistem
1. Perangkat Android (Android 7.0+ disarankan).
2. Aplikasi **Termux resmi dari F-Droid** (package `com.termux`).
3. Akses penyimpanan bersama Android: Jalankan `termux-setup-storage` di Termux untuk memberikan izin akses ke `/storage/emulated/0`.
4. Paket dasar: `python`, `tmux`, `nodejs`, dan `git`.

---

### 🛠️ Panduan Instalasi & Pengaturan

Jalankan perintah berikut di dalam Termux:
```bash
# Clone repositori
git clone https://github.com/0xposa/termux-workspace.git ~/termux-workspace
cd ~/termux-workspace

# Berikan izin eksekusi pada skrip
chmod +x setup.sh start.sh preview.sh

# Berikan izin akses penyimpanan Android jika belum
termux-setup-storage

# Jalankan skrip setup otomatis
./setup.sh
```

---

### 🚦 Cara Menjalankan

#### Opsi 1: Mode Produksi (start.sh)
Gunakan opsi ini untuk penggunaan harian dengan proteksi token keamanan:
```bash
./start.sh
```
Skrip akan menyalakan server latar belakang pada port `24817` dan mencetak tautan akses:
```text
http://127.0.0.1:24817/?token=<64_karakter_token_acak>
```
Buka tautan tersebut di browser web Android Anda (Chrome, Kiwi, Firefox, dsb.).

Untuk merestart atau menghentikan server produksi:
```bash
./start.sh --restart
```

#### Opsi 2: Mode Live Development & Preview (preview.sh)
```bash
# Jalankan server preview pada port 8000
./preview.sh

# Atau nyalakan dan langsung buka di browser:
./preview.sh --open
```
- URL Akses: `http://127.0.0.1:8000/` (Bebas token, auto-reload aktif).
- Menghentikan server preview: `./preview.sh --stop`.

#### Opsi 3: Menggunakan Aplikasi Android Add-on (APK)
1. **Dapatkan APK**:
   Setiap kali commit di-push ke branch `main`, GitHub Actions akan otomatis mengompilasi APK debug via workflow `.github/workflows/build-apk.yml`. Unduh file `app-debug.apk` dari tab **Actions** $\to$ **Artifacts** di repositori GitHub.
2. **Berikan Izin RUN_COMMAND**:
   Buka **Pengaturan Android** $\to$ **Aplikasi** $\to$ **Termux Workspace** $\to$ **Izin** $\to$ **Izin Tambahan** $\to$ Aktifkan **"Run commands in Termux environment"** (`com.termux.permission.RUN_COMMAND`).
3. **Buka Aplikasi**:
   Buka aplikasi dari app drawer perangkat Anda. Aplikasi akan otomatis menjalankan server di Termux dan membuka antarmuka workspace secara *fullscreen immersive*.

---

### 📂 Project Structure

```text
termux-workspace/
├── server/
│   ├── main.py              # FastAPI server, PTY WebSocket, Filesystem API
│   └── requirements.txt     # Python dependencies
├── web/
│   ├── index.html           # Main HTML workspace shell
│   ├── style.css            # macOS Frosted Glass dark theme styling
│   ├── app.js               # Frontend controller (Terminal, Editor, Dual Storage)
│   ├── icons/               # 64x64 SVG/PNG icons
│   └── vendor/              # Bundled xterm.js, CodeMirror 6, and FitAddon
├── android/                 # Android Kotlin WebView Add-on project
├── setup.sh                 # Idempotent setup and installation script
├── start.sh                 # Production launcher (port 24817 with auth token)
├── preview.sh               # Development launcher (port 8000 with live reload)
├── LICENSE                  # MIT License
└── README.md                # Documentation
```

---

### 👥 Contributors
Contributions, issues, and feature requests are welcome!

* **[0xposa](https://github.com/0xposa)** (Project Creator & Lead Maintainer)

Feel free to check the [issues page](https://github.com/0xposa/termux-workspace/issues) or submit pull requests.

---

### 📄 License
This project is licensed under the [MIT License](LICENSE) - see the [LICENSE](LICENSE) file for details.
