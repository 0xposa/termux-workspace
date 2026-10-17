import argparse
import logging
import os
import re
import secrets
import socket
import sys
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
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

@app.get("/health")
async def health_check():
    return {"ok": True}

# Sajikan file statis dari folder web/
WEB_DIR = Path(__file__).resolve().parent.parent / "web"
if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")

def main():
    try:
        uvicorn.run(app, host="127.0.0.1", port=SERVER_PORT, access_log=False, log_level="warning")
    except OSError as e:
        sys.stderr.write(f"Port {SERVER_PORT} sudah dipakai\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
