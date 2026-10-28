#!/usr/bin/env python3
"""B2Buddy AI DJ service. Local HTTP wrapper around the real AI DJ modules (see core.py).

    python services/aidj/server.py [--port 8765]

GET  /v1/health                       runtime status, fork commit, what is and is not available
POST /v1/analyze   (body: WAV bytes)  measured BPM / beats / phrases / energy by the fork's librosa code
POST /v1/plan      {current, next}    the fork's transition decision, every candidate scored
POST /v1/rank      {previous, candidates, avoid}   next-track ranking by the fork's transition score
Listens on 127.0.0.1 only. No secrets are read except an optional OPENAI_API_KEY, which is never sent anywhere by this service.
"""
import argparse
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import core

MAX_BODY = 64 * 1024 * 1024
ALLOWED = [o.strip() for o in os.environ.get("AIDJ_ALLOW_ORIGIN", "").split(",") if o.strip()]
STARTED = {"count": 0, "errors": 0}


def origin_ok(origin):
    if not origin:
        return True
    if origin in ALLOWED:
        return True
    return origin.startswith(("http://localhost", "http://127.0.0.1", "https://localhost", "https://127.0.0.1"))


class Handler(BaseHTTPRequestHandler):
    server_version = "b2buddy-aidj/1"

    def log_message(self, fmt, *args):   # quiet
        pass

    def _cors(self):
        o = self.headers.get("Origin")
        if o and origin_ok(o):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Track-Id")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("body too large")
        return self.rfile.read(n)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/v1/health":
            return self._send(200, {
                "ok": True, "service": "b2buddy-aidj", "version": 1,
                "fork": {"repo": core.FORK_REPO, "commit": core.FORK_COMMIT},
                "librosa": core.librosa.__version__,
                "capabilities": {"analyze": core.analysis_ready(), "analyzeLocal": core.local_ready(), "plan": True, "rank": True, "structureGpt": False},
                "local": {"engine": "older_way/track_analysis_engine", "tensorflowStubbed": core.TF_STUBBED, "error": core.LOCAL_ERROR},
                "openai": core.openai_status(),
                "requests": STARTED,
            })
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not origin_ok(self.headers.get("Origin")):
            return self._send(403, {"error": "origin not allowed"})
        STARTED["count"] += 1
        try:
            path = self.path.split("?")[0]
            if path == "/v1/analyze":
                data = self._read()
                if len(data) < 44 or data[:4] != b"RIFF":
                    return self._send(400, {"error": "body must be a WAV file"})
                fd, tmp = tempfile.mkstemp(suffix=".wav", dir=core.DATA_DIR)
                try:
                    with os.fdopen(fd, "wb") as f:
                        f.write(data)
                    res = core.analyze_wav(tmp)
                finally:
                    os.unlink(tmp)
                res["trackId"] = self.headers.get("X-Track-Id", "")
                return self._send(200, res)
            body = json.loads(self._read() or b"{}")
            if path == "/v1/plan":
                return self._send(200, core.plan_transition(body.get("current"), body.get("next")))
            if path == "/v1/rank":
                return self._send(200, {"ranking": core.rank_next(body.get("previous"), body.get("candidates") or [], set(body.get("avoid") or []))})
            return self._send(404, {"error": "not found"})
        except core.AnalysisError as e:
            STARTED["errors"] += 1
            return self._send(422, {"error": str(e)})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            STARTED["errors"] += 1
            return self._send(400, {"error": str(e)})
        except Exception as e:   # analysis failure must never kill the service
            STARTED["errors"] += 1
            return self._send(500, {"error": type(e).__name__ + ": " + str(e)})


def make_server(port=0):
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("AIDJ_PORT", "8765")))
    a = ap.parse_args()
    srv = make_server(a.port)
    print(f"B2Buddy AI DJ service on http://127.0.0.1:{srv.server_address[1]}  (fork {core.FORK_COMMIT[:7]}, librosa {core.librosa.__version__})", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
