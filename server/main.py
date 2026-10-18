import argparse
import asyncio
import fcntl
import json
import logging
import os
import pty
import re
import secrets
import shutil
import signal
import socket
import struct
import subprocess
import sys
import termios
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

DEFAULT_PORT = 24817
DEFAULT_HOST = "127.0.0.1"

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# Konfigurasi dari environment (agar diwariskan ke worker/reload process)
SERVER_HOST = os.environ.get("WORKSPACE_HOST", DEFAULT_HOST)
SERVER_PORT = int(os.environ.get("WORKSPACE_PORT", str(DEFAULT_PORT)))
NO_AUTH = os.environ.get("WORKSPACE_NO_AUTH", "0") == "1"
SERVER_TOKEN = os.environ.get("WORKSPACE_TOKEN", "")

# Konfigurasi logging tanpa mencatat token
class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = re.sub(r'token=[^& \t\n]+', 'token=[REDACTED]', record.msg)
        if hasattr(record, "args") and isinstance(record.args, tuple):
            new_args = []
            for arg in record.args:
                if isinstance(arg, str):
                    arg = re.sub(r'token=[^& \t\n]+', 'token=[REDACTED]', arg)
                new_args.append(arg)
            record.args = tuple(new_args)
        return True

logger = logging.getLogger("termux_workspace")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
for handler in logging.root.handlers:
    handler.addFilter(RedactingFilter())

def parse_args():
    parser = argparse.ArgumentParser(description="Termux Workspace Server")
    parser.add_argument("--token", default=None, help="Token autentikasi")
    parser.add_argument("--no-auth", action="store_true", help="Nonaktifkan autentikasi token (mode preview)")
    parser.add_argument("--host", default=None, help="Host server (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=None, help="Port server")
    parser.add_argument("--reload", action="store_true", help="Aktifkan live auto-reload")
    parsed = parser.parse_args()
    if not parsed.token and not parsed.no_auth and not NO_AUTH and not SERVER_TOKEN:
        parser.error("Argumen --token atau flag --no-auth harus disertakan")
    return parsed

def check_port_available(port: int, host: str = "127.0.0.1") -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((host, port))
    except OSError:
        sys.stderr.write(f"Port {port} sudah dipakai di {host}\n")
        sys.exit(1)
    finally:
        sock.close()

app = FastAPI(title="Termux Workspace Server", docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware("http")
async def token_auth_middleware(request: Request, call_next):
    is_no_auth = NO_AUTH or (os.environ.get("WORKSPACE_NO_AUTH", "0") == "1")
    if is_no_auth:
        return await call_next(request)

    active_token = SERVER_TOKEN or os.environ.get("WORKSPACE_TOKEN", "")
    # Ekstraksi token dari query parameter, header, atau cookie
    token = (
        request.query_params.get("token")
        or request.headers.get("X-Token")
        or request.cookies.get("ws_token")
    )
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()

    if not token or not active_token or not secrets.compare_digest(token, active_token):
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    response = await call_next(request)
    # Set cookie jika token valid disertakan di query param
    if request.query_params.get("token"):
        response.set_cookie(
            key="ws_token",
            value=active_token,
            httponly=True,
            samesite="strict",
            path="/"
        )
    return response

def set_winsize(fd: int, rows: int, cols: int):
    winsize = struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

def get_default_shell() -> str:
    shell = os.environ.get("SHELL")
    if shell and os.path.isfile(shell) and os.access(shell, os.X_OK):
        return shell
    for fallback in ["/data/data/com.termux/files/usr/bin/bash", "/data/data/com.termux/files/usr/bin/sh", "/bin/sh"]:
        if os.path.isfile(fallback) and os.access(fallback, os.X_OK):
            return fallback
    return shutil.which("bash") or "sh"

def disable_tmux_right_click_menus():
    """Nonaktifkan semua menu popup klik kanan bawaan tmux agar tidak tumpang tindih dengan context menu web."""
    keys = [
        "MouseDown3Pane", "M-MouseDown3Pane",
        "MouseDown3Status", "MouseDown3StatusLeft",
        "MouseDown3Empty", "M-MouseDown3Status",
        "M-MouseDown3StatusLeft", "M-MouseDown3Empty",
        "MouseDown1Control9"
    ]
    for key in keys:
        subprocess.run(["tmux", "unbind-key", "-n", key], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

disable_tmux_right_click_menus()

def list_tmux_sessions() -> list[dict]:
    res = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"], capture_output=True, text=True)
    if res.returncode != 0:
        return []
    sessions = []
    lines = [line.strip() for line in res.stdout.splitlines() if line.strip()]
    for sess_id in lines:
        if sess_id.startswith("ws-"):
            opt_res = subprocess.run(["tmux", "show-options", "-t", sess_id, "-v", "@ws_name"], capture_output=True, text=True)
            name = opt_res.stdout.strip()
            if not name:
                name = "Bash"
            sessions.append({"id": sess_id, "name": name})
    def sort_key(s):
        m = re.match(r"^ws-(\d+)$", s["id"])
        return int(m.group(1)) if m else 100000
    sessions.sort(key=sort_key)
    return sessions

@app.get("/health")
async def health_check():
    return {"ok": True}

@app.get("/api/sessions")
async def get_sessions():
    return list_tmux_sessions()

@app.post("/api/sessions")
async def create_session(cwd: Optional[str] = None):
    existing = list_tmux_sessions()
    used_numbers = set()
    for s in existing:
        m = re.match(r"^ws-(\d+)$", s["id"])
        if m:
            used_numbers.add(int(m.group(1)))
    
    next_num = 1
    while next_num in used_numbers:
        next_num += 1
    new_id = f"ws-{next_num}"

    shell = get_default_shell()
    base_name = os.path.basename(shell).capitalize()
    
    existing_names = [s["name"] for s in existing]
    if base_name not in existing_names:
        display_name = base_name
    else:
        idx = 2
        while f"{base_name} {idx}" in existing_names:
            idx += 1
        display_name = f"{base_name} {idx}"

    home_dir = os.path.realpath(os.environ.get("HOME", "/data/data/com.termux/files/home"))
    storage_dir = os.path.realpath("/storage/emulated/0")

    def is_subpath(p: str, parent: str) -> bool:
        try:
            return os.path.commonpath([p, parent]) == parent
        except ValueError:
            return False

    work_dir = home_dir
    if cwd:
        real_cwd = os.path.realpath(cwd)
        if (is_subpath(real_cwd, home_dir) or is_subpath(real_cwd, storage_dir)) and os.path.isdir(real_cwd):
            work_dir = real_cwd

    cmd = ["tmux", "new-session", "-d", "-s", new_id, "-c", work_dir, "-x", "120", "-y", "30", shell]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Gagal membuat sesi tmux: {res.stderr}")

    subprocess.run(["tmux", "set-option", "-t", new_id, "status", "off"], check=False)
    subprocess.run(["tmux", "set-option", "-t", new_id, "mouse", "on"], check=False)
    subprocess.run(["tmux", "set-option", "-t", new_id, "@ws_name", display_name], check=False)
    disable_tmux_right_click_menus()

    return {"id": new_id, "name": display_name}

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    if not session_id.startswith("ws-"):
        raise HTTPException(status_code=400, detail="ID sesi tidak valid")
    res = subprocess.run(["tmux", "kill-session", "-t", session_id], capture_output=True, text=True)
    return {"ok": True}

@app.get("/api/fs")
async def list_filesystem(response: Response, path: Optional[str] = None):
    home_dir = os.path.realpath(os.environ.get("HOME", "/data/data/com.termux/files/home"))
    target = path if path else home_dir
    real_target = os.path.realpath(target)

    storage_dir = os.path.realpath("/storage/emulated/0")

    def is_subpath(p: str, parent: str) -> bool:
        try:
            return os.path.commonpath([p, parent]) == parent
        except ValueError:
            return False

    if not (is_subpath(real_target, home_dir) or is_subpath(real_target, storage_dir)):
        raise HTTPException(status_code=403, detail="Akses direktori ditolak")

    if not os.path.exists(real_target) or not os.path.isdir(real_target):
        raise HTTPException(status_code=404, detail="Direktori tidak ditemukan")

    try:
        response.headers["X-Current-Path"] = real_target
        response.headers["Access-Control-Expose-Headers"] = "X-Current-Path"
        entries = []
        with os.scandir(real_target) as it:
            for entry in it:
                try:
                    is_dir = entry.is_dir(follow_symlinks=True)
                except OSError:
                    is_dir = False
                entries.append({
                    "name": entry.name,
                    "type": "dir" if is_dir else "file",
                    "path": entry.path
                })

        # Urutkan: folder di atas file, lalu alfabetis case-insensitive
        entries.sort(key=lambda x: (0 if x["type"] == "dir" else 1, x["name"].lower()))
        return entries
    except PermissionError:
        raise HTTPException(status_code=403, detail="Izin baca direktori ditolak")
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e))

class MkdirRequest(BaseModel):
    path: str

@app.post("/api/fs/mkdir")
async def create_directory(req: MkdirRequest):
    home_dir = os.path.realpath(os.environ.get("HOME", "/data/data/com.termux/files/home"))
    storage_dir = os.path.realpath("/storage/emulated/0")
    real_target = os.path.realpath(req.path)

    def is_subpath(p: str, parent: str) -> bool:
        try:
            return os.path.commonpath([p, parent]) == parent
        except ValueError:
            return False

    if not (is_subpath(real_target, home_dir) or is_subpath(real_target, storage_dir)):
        raise HTTPException(status_code=403, detail="Akses ditolak")

    if os.path.exists(real_target):
        raise HTTPException(status_code=400, detail="Folder sudah ada")

    try:
        os.makedirs(real_target, exist_ok=False)
        return {"ok": True, "path": real_target}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Izin membuat folder ditolak")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class FileSaveRequest(BaseModel):
    path: str
    content: str

@app.get("/api/fs/content")
async def get_file_content(path: str):
    home_dir = os.path.realpath(os.environ.get("HOME", "/data/data/com.termux/files/home"))
    storage_dir = os.path.realpath("/storage/emulated/0")
    real_target = os.path.realpath(path)

    def is_subpath(p: str, parent: str) -> bool:
        try:
            return os.path.commonpath([p, parent]) == parent
        except ValueError:
            return False

    if not (is_subpath(real_target, home_dir) or is_subpath(real_target, storage_dir)):
        raise HTTPException(status_code=403, detail="Akses file ditolak")

    if not os.path.exists(real_target) or not os.path.isfile(real_target):
        raise HTTPException(status_code=404, detail="File tidak ditemukan")

    if os.path.getsize(real_target) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File terlalu besar (> 5MB)")

    try:
        with open(real_target, "rb") as bf:
            chunk = bf.read(8192)
            if b"\x00" in chunk:
                raise HTTPException(status_code=400, detail="File adalah file biner dan tidak dapat diedit di editor")

        with open(real_target, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        return {
            "path": real_target,
            "name": os.path.basename(real_target),
            "content": content
        }
    except PermissionError:
        raise HTTPException(status_code=403, detail="Izin baca file ditolak")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/fs/content")
async def save_file_content(req: FileSaveRequest):
    home_dir = os.path.realpath(os.environ.get("HOME", "/data/data/com.termux/files/home"))
    storage_dir = os.path.realpath("/storage/emulated/0")
    real_target = os.path.realpath(req.path)

    def is_subpath(p: str, parent: str) -> bool:
        try:
            return os.path.commonpath([p, parent]) == parent
        except ValueError:
            return False

    if not (is_subpath(real_target, home_dir) or is_subpath(real_target, storage_dir)):
        raise HTTPException(status_code=403, detail="Akses file ditolak")

    try:
        with open(real_target, "w", encoding="utf-8") as f:
            f.write(req.content)
        return {"ok": True, "path": real_target}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Izin tulis file ditolak")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class RenameRequest(BaseModel):
    path: str
    new_name: str

@app.post("/api/fs/rename")
async def rename_fs_item(req: RenameRequest):
    home_dir = os.path.realpath(os.environ.get("HOME", "/data/data/com.termux/files/home"))
    storage_dir = os.path.realpath("/storage/emulated/0")
    real_target = os.path.realpath(req.path)

    def is_subpath(p: str, parent: str) -> bool:
        try:
            return os.path.commonpath([p, parent]) == parent
        except ValueError:
            return False

    if not (is_subpath(real_target, home_dir) or is_subpath(real_target, storage_dir)):
        raise HTTPException(status_code=403, detail="Akses ditolak")

    if real_target == home_dir or real_target == storage_dir:
        raise HTTPException(status_code=400, detail="Tidak dapat mengubah nama direktori root")

    if not os.path.exists(real_target):
        raise HTTPException(status_code=404, detail="File atau folder tidak ditemukan")

    clean_name = os.path.basename(req.new_name.strip())
    if not clean_name or clean_name != req.new_name.strip() or "/" in req.new_name or "\\" in req.new_name or ".." in req.new_name:
        raise HTTPException(status_code=400, detail="Nama baru tidak valid")

    parent_dir = os.path.dirname(real_target)
    dest_path = os.path.join(parent_dir, clean_name)

    if os.path.exists(dest_path):
        raise HTTPException(status_code=400, detail=f"'{clean_name}' sudah ada")

    try:
        os.rename(real_target, dest_path)
        return {"ok": True, "old_path": real_target, "new_path": dest_path}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Izin mengubah nama ditolak")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class MoveRequest(BaseModel):
    source: str
    destination: str

@app.post("/api/fs/move")
async def move_fs_item(req: MoveRequest):
    home_dir = os.path.realpath(os.environ.get("HOME", "/data/data/com.termux/files/home"))
    storage_dir = os.path.realpath("/storage/emulated/0")
    real_source = os.path.realpath(req.source)
    real_dest = os.path.realpath(req.destination)

    def is_subpath(p: str, parent: str) -> bool:
        try:
            return os.path.commonpath([p, parent]) == parent
        except ValueError:
            return False

    if not (is_subpath(real_source, home_dir) or is_subpath(real_source, storage_dir)):
        raise HTTPException(status_code=403, detail="Akses sumber ditolak")
    if not (is_subpath(real_dest, home_dir) or is_subpath(real_dest, storage_dir)):
        raise HTTPException(status_code=403, detail="Akses tujuan ditolak")

    if real_source == home_dir or real_source == storage_dir:
        raise HTTPException(status_code=400, detail="Tidak dapat memindahkan direktori root")

    if not os.path.exists(real_source):
        raise HTTPException(status_code=404, detail="File atau folder sumber tidak ditemukan")

    if os.path.isdir(real_dest):
        final_dest = os.path.join(real_dest, os.path.basename(real_source))
    else:
        final_dest = real_dest

    if os.path.exists(final_dest):
        raise HTTPException(status_code=400, detail="Target tujuan sudah ada")

    try:
        shutil.move(real_source, final_dest)
        return {"ok": True, "source": real_source, "destination": final_dest}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Izin memindahkan file ditolak")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/fs")
async def delete_fs_item(path: str):
    home_dir = os.path.realpath(os.environ.get("HOME", "/data/data/com.termux/files/home"))
    storage_dir = os.path.realpath("/storage/emulated/0")
    real_target = os.path.realpath(path)

    def is_subpath(p: str, parent: str) -> bool:
        try:
            return os.path.commonpath([p, parent]) == parent
        except ValueError:
            return False

    if not (is_subpath(real_target, home_dir) or is_subpath(real_target, storage_dir)):
        raise HTTPException(status_code=403, detail="Akses ditolak")

    if real_target == home_dir or real_target == storage_dir:
        raise HTTPException(status_code=400, detail="Tidak dapat menghapus direktori root")

    if not os.path.exists(real_target):
        raise HTTPException(status_code=404, detail="File atau folder tidak ditemukan")

    try:
        if os.path.isdir(real_target):
            shutil.rmtree(real_target)
        else:
            os.remove(real_target)
        return {"ok": True, "path": real_target}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Izin menghapus ditolak")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.websocket("/ws/terminal")
async def websocket_terminal(websocket: WebSocket, id: str = "", cols: int = 120, rows: int = 30):
    # Validasi header Origin: host yang dikonfigurasi, 127.0.0.1, atau localhost
    current_port = int(os.environ.get("WORKSPACE_PORT", str(SERVER_PORT)))
    current_host = os.environ.get("WORKSPACE_HOST", SERVER_HOST)
    origin = websocket.headers.get("origin")
    allowed_origins = {
        f"http://{current_host}:{current_port}",
        f"http://127.0.0.1:{current_port}",
        f"http://localhost:{current_port}",
    }
    if origin not in allowed_origins:
        await websocket.close(code=1008)
        return

    # Validasi token jika auth aktif
    is_no_auth = NO_AUTH or (os.environ.get("WORKSPACE_NO_AUTH", "0") == "1")
    if not is_no_auth:
        active_token = SERVER_TOKEN or os.environ.get("WORKSPACE_TOKEN", "")
        token = (
            websocket.query_params.get("token")
            or websocket.cookies.get("ws_token")
        )
        if not token or not active_token or not secrets.compare_digest(token, active_token):
            await websocket.close(code=1008)
            return

    # Validasi ID sesi
    if not id or not id.startswith("ws-"):
        await websocket.close(code=1008)
        return

    # Pastikan sesi tmux ada
    check_res = subprocess.run(["tmux", "has-session", "-t", id], capture_output=True)
    if check_res.returncode != 0:
        await websocket.close(code=1008)
        return

    await websocket.accept()

    loop = asyncio.get_running_loop()
    pid, master_fd = pty.fork()

    if pid == 0:
        # Proses anak: attach ke sesi tmux
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["LANG"] = "en_US.UTF-8"
        try:
            os.execvpe("tmux", ["tmux", "attach-session", "-t", id], env)
        except Exception:
            os._exit(1)

    # Proses induk: atur ukuran PTY awal
    try:
        set_winsize(master_fd, rows, cols)
    except Exception:
        pass

    pty_queue: asyncio.Queue = asyncio.Queue(maxsize=128)

    def on_pty_read():
        try:
            data = os.read(master_fd, 4096)
            if data:
                try:
                    pty_queue.put_nowait(data)
                except asyncio.QueueFull:
                    pass
            else:
                pty_queue.put_nowait(None)
        except (OSError, BlockingIOError):
            pass

    loop.add_reader(master_fd, on_pty_read)

    async def send_pty_to_ws():
        try:
            while True:
                chunk = await pty_queue.get()
                if chunk is None:
                    break
                await websocket.send_bytes(chunk)
        except Exception:
            pass

    async def receive_ws_to_pty():
        try:
            while True:
                msg = await websocket.receive()
                if "bytes" in msg and msg["bytes"]:
                    os.write(master_fd, msg["bytes"])
                elif "text" in msg and msg["text"]:
                    text = msg["text"]
                    if text.startswith("{") and "resize" in text:
                        try:
                            parsed = json.loads(text)
                            if parsed.get("type") == "resize":
                                r = int(parsed.get("rows", rows))
                                c = int(parsed.get("cols", cols))
                                set_winsize(master_fd, r, c)
                                continue
                        except Exception:
                            pass
                    os.write(master_fd, text.encode("utf-8"))
                elif msg.get("type") == "websocket.disconnect":
                    break
        except Exception:
            pass

    send_task = asyncio.create_task(send_pty_to_ws())
    recv_task = asyncio.create_task(receive_ws_to_pty())

    done, pending = await asyncio.wait(
        [send_task, recv_task],
        return_when=asyncio.FIRST_COMPLETED
    )
    for t in pending:
        t.cancel()

    try:
        loop.remove_reader(master_fd)
    except Exception:
        pass
    try:
        os.close(master_fd)
    except OSError:
        pass

    # Matikan hanya proses attach; sesi tmux tetap hidup
    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(10):
            res_pid, _ = os.waitpid(pid, os.WNOHANG)
            if res_pid != 0:
                break
            await asyncio.sleep(0.05)
        else:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    except (OSError, ProcessLookupError, ChildProcessError):
        pass

    try:
        await websocket.close()
    except Exception:
        pass

# Sajikan file statis dari folder web/
WEB_DIR = Path(__file__).resolve().parent.parent / "web"
if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")

def main():
    global SERVER_HOST, SERVER_PORT, NO_AUTH, SERVER_TOKEN
    try:
        os.setsid()
    except OSError:
        pass

    args = parse_args()
    SERVER_HOST = args.host or SERVER_HOST
    SERVER_PORT = args.port or SERVER_PORT
    NO_AUTH = args.no_auth or NO_AUTH
    SERVER_TOKEN = args.token or SERVER_TOKEN
    RELOAD = args.reload or (os.environ.get("WORKSPACE_RELOAD", "0") == "1")

    # Simpan ke env agar reloader worker mewarisi konfigurasi
    os.environ["WORKSPACE_HOST"] = SERVER_HOST
    os.environ["WORKSPACE_PORT"] = str(SERVER_PORT)
    os.environ["WORKSPACE_NO_AUTH"] = "1" if NO_AUTH else "0"
    os.environ["WORKSPACE_TOKEN"] = SERVER_TOKEN
    if RELOAD:
        os.environ["WORKSPACE_RELOAD"] = "1"

    check_port_available(SERVER_PORT, SERVER_HOST)

    try:
        if RELOAD:
            uvicorn.run("server.main:app", host=SERVER_HOST, port=SERVER_PORT, reload=True, access_log=False, log_level="warning")
        else:
            uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT, access_log=False, log_level="warning")
    except OSError:
        sys.stderr.write(f"Port {SERVER_PORT} sudah dipakai di {SERVER_HOST}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
