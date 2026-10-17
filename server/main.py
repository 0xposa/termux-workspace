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

DEFAULT_PORT = 24817

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
    parser.add_argument("--token", required=True, help="Token autentikasi")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port server")
    return parser.parse_args()

def check_port_available(port: int) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", port))
    except OSError:
        sys.stderr.write(f"Port {port} sudah dipakai\n")
        sys.exit(1)
    finally:
        sock.close()

try:
    os.setsid()
except OSError:
    pass

args = parse_args()
SERVER_TOKEN = args.token
SERVER_PORT = args.port

check_port_available(SERVER_PORT)

app = FastAPI(title="Termux Workspace Server", docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware("http")
async def token_auth_middleware(request: Request, call_next):
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

    if not token or not secrets.compare_digest(token, SERVER_TOKEN):
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    response = await call_next(request)
    # Set cookie jika token valid disertakan di query param
    if request.query_params.get("token"):
        response.set_cookie(
            key="ws_token",
            value=SERVER_TOKEN,
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
async def create_session():
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

    cmd = ["tmux", "new-session", "-d", "-s", new_id, "-x", "120", "-y", "30", shell]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Gagal membuat sesi tmux: {res.stderr}")

    subprocess.run(["tmux", "set-option", "-t", new_id, "status", "off"], check=False)
    subprocess.run(["tmux", "set-option", "-t", new_id, "mouse", "on"], check=False)
    subprocess.run(["tmux", "set-option", "-t", new_id, "@ws_name", display_name], check=False)

    return {"id": new_id, "name": display_name}

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    if not session_id.startswith("ws-"):
        raise HTTPException(status_code=400, detail="ID sesi tidak valid")
    res = subprocess.run(["tmux", "kill-session", "-t", session_id], capture_output=True, text=True)
    return {"ok": True}

@app.get("/api/fs")
async def list_filesystem(path: Optional[str] = None):
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


@app.websocket("/ws/terminal")
async def websocket_terminal(websocket: WebSocket, id: str = "", cols: int = 120, rows: int = 30):
    # Validasi header Origin: hanya http://127.0.0.1:<port>
    origin = websocket.headers.get("origin")
    expected_origin = f"http://127.0.0.1:{SERVER_PORT}"
    if origin != expected_origin:
        await websocket.close(code=1008)
        return

    # Validasi token
    token = (
        websocket.query_params.get("token")
        or websocket.cookies.get("ws_token")
    )
    if not token or not secrets.compare_digest(token, SERVER_TOKEN):
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
    try:
        uvicorn.run(app, host="127.0.0.1", port=SERVER_PORT, access_log=False, log_level="warning")
    except OSError:
        sys.stderr.write(f"Port {SERVER_PORT} sudah dipakai\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
