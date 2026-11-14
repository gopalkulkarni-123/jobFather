#!/usr/bin/env python3
"""
CV Tailor Studio — Web UI Server & OpenCode Engine Bridge.

Responsibilities:
1. Spawns and manages a dedicated headless `opencode serve` instance rooted at `cv-tailor/`.
2. Serves the single-page CV Tailor Studio web UI (`ui/static/`).
3. Provides local workspace APIs:
   - Upload / paste CV, LinkedIn export, and fallback Job Description into `inputs/`
   - Save / load `inputs/profile.json` (GitHub handle, format preferences)
   - Browse, preview, edit, download, and `.zip`-export generated bundles in `outputs/`
   - Run deterministic `scripts/ats_lint.py` directly from the UI
   - 1-click `~/.cache/opencode` refresh (preserving `~/.local/share/opencode/auth.json`) if stale `@ai-sdk/google` triggers provider option errors
4. Proxies session, prompt, slash-command, interactive `question` reply, `permission` reply,
   provider/model listing, and live `/event` SSE stream to `opencode serve`.
"""

import argparse
import atexit
import base64
import io
import json
import mimetypes
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"
INPUTS_DIR = PROJECT_ROOT / "inputs"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
PROFILE_PATH = INPUTS_DIR / "profile.json"


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class OpenCodeEngineManager:
    """Manages the child `opencode serve` process."""

    def __init__(self, external_url: str | None = None) -> None:
        self._lock = threading.Lock()
        self.external_url = external_url.rstrip("/") if external_url else None
        self.port: int | None = None
        self.proc: subprocess.Popen | None = None
        self.last_error: str | None = None

    @property
    def base_url(self) -> str:
        if self.external_url:
            return self.external_url
        if not self.port:
            raise RuntimeError("OpenCode server port not initialized")
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> tuple[bool, str]:
        if self.external_url:
            return True, f"Using external OpenCode server at {self.external_url}"

        with self._lock:
            if self.proc and self.proc.poll() is None:
                return True, f"OpenCode running on {self.base_url}"

            opencode_bin = shutil.which("opencode") or str(Path.home() / ".opencode" / "bin" / "opencode")
            if not Path(opencode_bin).exists() and not shutil.which(opencode_bin):
                self.last_error = (
                    "Could not find `opencode` binary on PATH or `~/.opencode/bin/opencode`."
                )
                return False, self.last_error

            self.port = find_free_port()
            cmd = [
                opencode_bin,
                "serve",
                "--hostname",
                "127.0.0.1",
                "--port",
                str(self.port),
            ]
            self.proc = subprocess.Popen(
                cmd,
                cwd=str(PROJECT_ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )

            # Drain stdout/stderr in background so pipe never blocks
            threading.Thread(target=self._drain_logs, args=(self.proc,), daemon=True).start()

            deadline = time.time() + 25.0
            while time.time() < deadline:
                if self.proc.poll() is not None:
                    self.last_error = f"`opencode serve` exited prematurely with code {self.proc.returncode}."
                    return False, self.last_error
                if self._check_health_unlocked():
                    self.last_error = None
                    return True, f"OpenCode server ready at {self.base_url}"
                time.sleep(0.35)

            self.last_error = "Timed out waiting for `opencode serve` health check."
            return False, self.last_error

    def _drain_logs(self, proc: subprocess.Popen) -> None:
        if not proc.stdout:
            return
        for line in proc.stdout:
            line_s = line.rstrip()
            if line_s:
                sys.stderr.write(f"[opencode] {line_s}\n")

    def _check_health_unlocked(self) -> bool:
        try:
            url = f"http://127.0.0.1:{self.port}/global/health"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def health(self) -> dict:
        try:
            url = f"{self.base_url}/global/health"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="replace") or "{}")
                return {"healthy": True, "url": self.base_url, "details": data}
        except Exception as exc:
            return {"healthy": False, "error": self.last_error or str(exc)}

    def stop(self) -> None:
        with self._lock:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
            self.proc = None

    def clear_provider_cache_and_restart(self) -> tuple[bool, str]:
        self.stop()
        cache_dir = Path.home() / ".cache" / "opencode"
        if cache_dir.exists():
            shutil.rmtree(cache_dir, ignore_errors=True)
        return self.start()


ENGINE = OpenCodeEngineManager(os.environ.get("OPENCODE_SERVER_URL"))


def safe_resolve_under(base: Path, rel_path: str) -> Path:
    candidate = (base / rel_path.lstrip("/")).resolve()
    base_resolved = base.resolve()
    if candidate != base_resolved and base_resolved not in candidate.parents:
        raise PermissionError("Path escapes allowed workspace directory")
    return candidate


def load_profile() -> dict:
    if PROFILE_PATH.exists():
        try:
            return json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"github": "", "preferred_typeset_format": "both"}


def save_profile(updates: dict) -> dict:
    INPUTS_DIR.mkdir(parents=True, exist_ok=True)
    current = load_profile()
    current.update({k: v for k, v in updates.items() if v is not None})
    PROFILE_PATH.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    return current


def inspect_inputs() -> list[dict]:
    INPUTS_DIR.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "parse_document.py"), "--path", str(INPUTS_DIR), "--max-chars", "1200"],
        capture_output=True,
        text=True,
        timeout=25,
    )
    if proc.returncode == 0 and proc.stdout.strip():
        try:
            parsed = json.loads(proc.stdout)
            files = []
            for f in parsed.get("files", []):
                if f.get("filename") == "profile.json":
                    continue
                files.append(
                    {
                        "filename": f.get("filename"),
                        "extension": f.get("extension"),
                        "status": f.get("status"),
                        "word_count": f.get("word_count", 0),
                        "preview": (f.get("content") or "")[:500],
                        "error": f.get("error"),
                    }
                )
            return files
        except Exception:
            pass
    return []


def list_output_bundles() -> list[dict]:
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    bundles = []
    dirs = sorted(
        (p for p in OUTPUTS_DIR.iterdir() if p.is_dir() and not p.name.startswith(".")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for d in dirs:
        files = sorted(
            f.name for f in d.iterdir() if f.is_file() and not f.name.startswith(".")
        )
        fitness_summary = extract_fitness_scores_from_bundle(d)
        bundles.append(
            {
                "name": d.name,
                "modified_at": int(d.stat().st_mtime * 1000),
                "files": files,
                "fitness": fitness_summary,
            }
        )
    return bundles


def extract_fitness_scores_from_bundle(bundle_dir: Path) -> dict | None:
    report = bundle_dir / "fitness_report.md"
    if not report.exists():
        return None
    text = report.read_text(encoding="utf-8", errors="replace")
    baseline = None
    after = None

    m_base = re.search(
        r"(?:baseline|before|initial)[^\n\d]{0,35}(\d{1,3})\s*/\s*100",
        text,
        flags=re.IGNORECASE,
    )
    m_after = re.search(
        r"(?:tailored|after|post-tailoring|final)[^\n\d]{0,35}(\d{1,3})\s*/\s*100",
        text,
        flags=re.IGNORECASE,
    )
    if m_base:
        baseline = min(100, int(m_base.group(1)))
    if m_after:
        after = min(100, int(m_after.group(1)))

    if baseline is None and after is None:
        all_scores = [int(x) for x in re.findall(r"\b(\d{1,3})\s*/\s*100\b", text) if int(x) <= 100]
        if len(all_scores) >= 2:
            baseline, after = all_scores[0], all_scores[1]
        elif len(all_scores) == 1:
            after = all_scores[0]

    return {"baseline": baseline, "after": after}


class StudioRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        # Keep console logs concise; suppress noisy static polling
        msg = fmt % args
        if "/api/workspace" in msg or "/static/" in msg:
            return
        sys.stderr.write(f"[studio-ui] {msg}\n")

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def oc_url(self, path: str, extra_query: dict | None = None) -> str:
        q = {"directory": str(PROJECT_ROOT)}
        if extra_query:
            q.update({k: v for k, v in extra_query.items() if v is not None})
        return f"{ENGINE.base_url}{path}?{urllib.parse.urlencode(q)}"

    def proxy_json(self, method: str, oc_path: str, body: dict | None = None, query: dict | None = None) -> None:
        health = ENGINE.health()
        if not health.get("healthy"):
            ok, msg = ENGINE.start()
            if not ok:
                self.send_json({"error": msg}, status=503)
                return

        url = self.oc_url(oc_path, query)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                resp_bytes = resp.read()
                status = resp.status
                if status == 204 or not resp_bytes:
                    self.send_json({"ok": True}, status=200)
                    return
                self.send_response(status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(resp_bytes)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(resp_bytes)
        except urllib.error.HTTPError as exc:
            err_bytes = exc.read()
            err_text = err_bytes.decode("utf-8", errors="replace")
            try:
                parsed_err = json.loads(err_text)
            except Exception:
                parsed_err = {"error": err_text or exc.reason}
            self.send_json(parsed_err, status=exc.code)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=502)

    def handle_sse_events(self) -> None:
        health = ENGINE.health()
        if not health.get("healthy"):
            ok, msg = ENGINE.start()
            if not ok:
                self.send_json({"error": msg}, status=503)
                return

        url = self.oc_url("/event")
        req = urllib.request.Request(url, headers={"Accept": "text/event-stream"}, method="GET")
        try:
            upstream = urllib.request.urlopen(req, timeout=3600)
        except Exception as exc:
            self.send_json({"error": f"Failed to connect to OpenCode SSE stream: {exc}"}, status=502)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        try:
            while True:
                line = upstream.readline()
                if not line:
                    break
                self.wfile.write(line)
                if line in (b"\n", b"\r\n"):
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            pass
        finally:
            try:
                upstream.close()
            except Exception:
                pass

    def serve_static(self, rel_path: str) -> None:
        clean = "index.html" if rel_path in ("", "/") else rel_path.lstrip("/")
        try:
            target = safe_resolve_under(STATIC_DIR, clean)
        except PermissionError:
            self.send_json({"error": "Forbidden"}, status=403)
            return

        if not target.exists() or not target.is_file():
            self.send_json({"error": "Not found"}, status=404)
            return

        mime, _ = mimetypes.guess_type(str(target))
        content = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    # ---------- HTTP GET ----------
    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = dict(urllib.parse.parse_qsl(parsed.query))

        if path == "/api/workspace":
            self.send_json(
                {
                    "project_root": str(PROJECT_ROOT),
                    "engine": ENGINE.health(),
                    "profile": load_profile(),
                    "inputs": inspect_inputs(),
                    "outputs": list_output_bundles(),
                }
            )
            return

        if path == "/api/outputs":
            self.send_json({"outputs": list_output_bundles()})
            return

        if path == "/api/outputs/file":
            bundle = query.get("bundle", "")
            filename = query.get("file", "")
            if not bundle or not filename:
                self.send_json({"error": "Missing bundle or file parameter"}, status=400)
                return
            try:
                target = safe_resolve_under(OUTPUTS_DIR, f"{bundle}/{filename}")
            except PermissionError:
                self.send_json({"error": "Forbidden path"}, status=403)
                return
            if not target.exists() or not target.is_file():
                self.send_json({"error": "File not found"}, status=404)
                return
            content = target.read_text(encoding="utf-8", errors="replace")
            self.send_json(
                {
                    "bundle": bundle,
                    "filename": filename,
                    "extension": target.suffix.lower(),
                    "content": content,
                }
            )
            return

        if path == "/api/outputs/zip":
            bundle = query.get("bundle", "")
            if not bundle:
                self.send_json({"error": "Missing bundle parameter"}, status=400)
                return
            try:
                bundle_dir = safe_resolve_under(OUTPUTS_DIR, bundle)
            except PermissionError:
                self.send_json({"error": "Forbidden"}, status=403)
                return
            if not bundle_dir.exists() or not bundle_dir.is_dir():
                self.send_json({"error": "Bundle not found"}, status=404)
                return

            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for item in sorted(bundle_dir.rglob("*")):
                    if item.is_file() and not item.name.startswith("."):
                        zf.write(item, arcname=f"{bundle}/{item.relative_to(bundle_dir)}")
            raw_zip = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="{bundle}.zip"')
            self.send_header("Content-Length", str(len(raw_zip)))
            self.end_headers()
            self.wfile.write(raw_zip)
            return

        # OpenCode proxy GET endpoints
        if path == "/api/oc/events":
            self.handle_sse_events()
            return

        if path == "/api/oc/providers":
            self.proxy_json("GET", "/provider")
            return

        if path == "/api/oc/sessions":
            self.proxy_json("GET", "/session")
            return

        if path == "/api/oc/questions":
            self.proxy_json("GET", "/question")
            return

        m_msg = re.match(r"^/api/oc/session/([^/]+)/messages$", path)
        if m_msg:
            sid = urllib.parse.quote(m_msg.group(1), safe="")
            self.proxy_json("GET", f"/session/{sid}/message")
            return

        # Serve static frontend assets
        if path == "/" or path.startswith("/static/") or path in ("/index.html", "/styles.css", "/app.js"):
            rel = path[len("/static/") :] if path.startswith("/static/") else path
            self.serve_static(rel)
            return

        self.send_json({"error": f"Unknown endpoint: {path}"}, status=404)

    # ---------- HTTP POST ----------
    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            body = self.read_json_body()
        except Exception as exc:
            self.send_json({"error": f"Invalid JSON body: {exc}"}, status=400)
            return

        if path == "/api/profile":
            saved = save_profile(
                {
                    "github": str(body.get("github", "")).strip(),
                    "preferred_typeset_format": body.get("preferred_typeset_format", "both"),
                }
            )
            self.send_json({"status": "ok", "profile": saved})
            return

        if path == "/api/upload":
            category = str(body.get("category", "other")).lower()
            raw_filename = Path(str(body.get("filename", ""))).name
            text_content = body.get("text")
            b64_content = body.get("contentBase64")

            INPUTS_DIR.mkdir(parents=True, exist_ok=True)
            if category in ("cv", "linkedin", "job") and not raw_filename:
                raw_filename = f"{category}.txt"

            ext = Path(raw_filename).suffix.lower() or ".txt"
            # Normalize standard filenames for clean agent discovery while keeping extension
            if category == "cv":
                dest_name = f"cv{ext}"
                for old in INPUTS_DIR.glob("cv.*"):
                    if old.name != dest_name:
                        old.unlink(missing_ok=True)
            elif category == "linkedin":
                dest_name = f"linkedin{ext}"
                for old in INPUTS_DIR.glob("linkedin.*"):
                    if old.name != dest_name:
                        old.unlink(missing_ok=True)
            elif category == "job":
                dest_name = f"job{ext}"
                for old in INPUTS_DIR.glob("job.*"):
                    if old.name != dest_name:
                        old.unlink(missing_ok=True)
            else:
                dest_name = re.sub(r"[^A-Za-z0-9._-]", "_", raw_filename)

            dest = safe_resolve_under(INPUTS_DIR, dest_name)
            if b64_content is not None:
                dest.write_bytes(base64.b64decode(b64_content))
            elif text_content is not None:
                dest.write_text(str(text_content), encoding="utf-8")
            else:
                self.send_json({"error": "Provide either contentBase64 or text"}, status=400)
                return

            self.send_json({"status": "ok", "saved_as": dest_name, "inputs": inspect_inputs()})
            return

        if path == "/api/inputs/delete":
            filename = Path(str(body.get("filename", ""))).name
            if not filename or filename in ("README.md", "profile.example.json"):
                self.send_json({"error": "Invalid filename"}, status=400)
                return
            target = safe_resolve_under(INPUTS_DIR, filename)
            target.unlink(missing_ok=True)
            self.send_json({"status": "ok", "inputs": inspect_inputs()})
            return

        if path == "/api/ats-lint":
            bundle = str(body.get("bundle", ""))
            filename = str(body.get("filename", ""))
            keywords = str(body.get("keywords", ""))
            try:
                cv_file = safe_resolve_under(OUTPUTS_DIR, f"{bundle}/{filename}")
            except PermissionError:
                self.send_json({"error": "Forbidden"}, status=403)
                return
            if not cv_file.exists():
                self.send_json({"error": "CV file not found"}, status=404)
                return
            cmd = [sys.executable, str(SCRIPTS_DIR / "ats_lint.py"), "--cv", str(cv_file)]
            if keywords.strip():
                cmd.extend(["--keywords", keywords.strip()])
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            try:
                self.send_json(json.loads(proc.stdout))
            except Exception:
                self.send_json({"status": "error", "error": proc.stderr or proc.stdout}, status=500)
            return

        if path == "/api/reset-opencode-cache":
            ok, msg = ENGINE.clear_provider_cache_and_restart()
            self.send_json({"ok": ok, "message": msg}, status=200 if ok else 500)
            return

        # OpenCode proxy POST endpoints
        if path == "/api/oc/session":
            payload: dict = {
                "title": body.get("title") or "CV Tailor Session",
                "agent": body.get("agent") or "career-architect",
            }
            if body.get("model"):
                payload["model"] = body["model"]
            self.proxy_json("POST", "/session", payload)
            return

        m_prompt = re.match(r"^/api/oc/session/([^/]+)/prompt$", path)
        if m_prompt:
            sid = urllib.parse.quote(m_prompt.group(1), safe="")
            payload = {
                "agent": body.get("agent") or "career-architect",
                "parts": [{"type": "text", "text": str(body.get("text", ""))}],
            }
            if body.get("model"):
                payload["model"] = body["model"]
            self.proxy_json("POST", f"/session/{sid}/prompt_async", payload)
            return

        m_cmd = re.match(r"^/api/oc/session/([^/]+)/command$", path)
        if m_cmd:
            sid = urllib.parse.quote(m_cmd.group(1), safe="")
            payload = {
                "agent": body.get("agent") or "career-architect",
                "command": str(body.get("command", "tailor")),
                "arguments": str(body.get("arguments", "")),
            }
            if body.get("model"):
                payload["model"] = str(body["model"])
            self.proxy_json("POST", f"/session/{sid}/command", payload)
            return

        m_abort = re.match(r"^/api/oc/session/([^/]+)/abort$", path)
        if m_abort:
            sid = urllib.parse.quote(m_abort.group(1), safe="")
            self.proxy_json("POST", f"/session/{sid}/abort", {})
            return

        m_q_reply = re.match(r"^/api/oc/question/([^/]+)/reply$", path)
        if m_q_reply:
            req_id = urllib.parse.quote(m_q_reply.group(1), safe="")
            self.proxy_json("POST", f"/question/{req_id}/reply", {"answers": body.get("answers", [])})
            return

        m_q_reject = re.match(r"^/api/oc/question/([^/]+)/reject$", path)
        if m_q_reject:
            req_id = urllib.parse.quote(m_q_reject.group(1), safe="")
            self.proxy_json("POST", f"/question/{req_id}/reject", {})
            return

        m_perm = re.match(r"^/api/oc/permission/([^/]+)/reply$", path)
        if m_perm:
            req_id = urllib.parse.quote(m_perm.group(1), safe="")
            self.proxy_json(
                "POST",
                f"/permission/{req_id}/reply",
                {"reply": body.get("reply", "once")},
            )
            return

        self.send_json({"error": f"Unknown POST endpoint: {path}"}, status=404)

    # ---------- HTTP PUT ----------
    def do_PUT(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/outputs/file":
            body = self.read_json_body()
            bundle = str(body.get("bundle", ""))
            filename = str(body.get("filename", ""))
            content = str(body.get("content", ""))
            if not bundle or not filename:
                self.send_json({"error": "Missing bundle or filename"}, status=400)
                return
            try:
                target = safe_resolve_under(OUTPUTS_DIR, f"{bundle}/{filename}")
            except PermissionError:
                self.send_json({"error": "Forbidden"}, status=403)
                return
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            self.send_json({"status": "ok", "saved": f"{bundle}/{filename}"})
            return

        self.send_json({"error": "Unknown PUT endpoint"}, status=404)


def main() -> int:
    parser = argparse.ArgumentParser(description="Start CV Tailor Studio Web UI")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Port for Studio Web UI (default: 8765)")
    parser.add_argument(
        "--no-autostart-opencode",
        action="store_true",
        help="Skip starting `opencode serve` automatically on boot (starts lazily on first request)",
    )
    args = parser.parse_args()

    atexit.register(ENGINE.stop)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    if not args.no_autostart_opencode:
        print("Starting background OpenCode engine (`opencode serve`)...")
        ok, msg = ENGINE.start()
        print(f"  -> {msg}")

    httpd = ThreadingHTTPServer((args.host, args.port), StudioRequestHandler)
    url = f"http://{args.host}:{args.port}"
    print(f"\n====================================================")
    print(f"  CV Tailor Studio UI running at: {url}")
    print(f"  Workspace: {PROJECT_ROOT}")
    print(f"====================================================\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down CV Tailor Studio...")
    finally:
        httpd.server_close()
        ENGINE.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
