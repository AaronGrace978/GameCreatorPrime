"""Loopback HTTP adapter for the official Hunyuan3D 2.1 pipelines.

Run this with the Hunyuan virtualenv's Python. No additional web framework is needed.
"""
import argparse
import base64
import binascii
import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_REQUEST = 40 * 1024 * 1024
MAX_MODEL = 256 * 1024 * 1024
BUSY = threading.Lock()


def validate_request(data):
    if not isinstance(data, dict) or not isinstance(data.get("image"), str):
        raise ValueError("An image is required")
    fields = {"seed": (0, 2**32 - 1), "num_inference_steps": (1, 50),
              "octree_resolution": (128, 384), "max_num_view": (6, 9),
              "texture_resolution": (512, 768)}
    for name, (low, high) in fields.items():
        value = data.get(name)
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f"Invalid {name}")
    if data.get("texture") is not True or data.get("type") != "glb":
        raise ValueError("This backend requires textured GLB output")
    try:
        image = base64.b64decode(data["image"], validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Invalid reference image encoding") from error
    if not image.startswith(b"\x89PNG\r\n\x1a\n") or len(image) > 30 * 1024 * 1024:
        raise ValueError("Expected a PNG image of at most 30 MB")
    return image, {key: data[key] for key in fields}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(60)

    def reply(self, status, payload, code=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        if code:
            self.send_header("X-GCP-Error", code)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            return self.reply(404, {"error": "Unknown endpoint"})
        self.reply(200, {"status": "busy" if BUSY.locked() else "ready", "backend": "hunyuan3d-2.1", "protocol": 1,
                         "memory_mode": self.server.memory_mode})

    def do_POST(self):
        if self.path != "/generate":
            return self.reply(404, {"error": "Unknown endpoint"})
        if self.headers.get("Origin") or self.headers.get_content_type() != "application/json":
            return self.reply(403, {"error": "Use the desktop JSON client"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > MAX_REQUEST:
                return self.reply(413, {"error": "Request too large"})
            data = json.loads(self.rfile.read(length))
            image, config = validate_request(data)
        except (ValueError, json.JSONDecodeError, TimeoutError):
            return self.reply(400, {"error": "Invalid generation request"})
        if not BUSY.acquire(blocking=False):
            return self.reply(409, {"error": "The GPU is already generating an asset"}, "busy")
        try:
            with tempfile.TemporaryDirectory(prefix="gcp-asset-") as folder:
                folder = Path(folder)
                (folder / "reference.png").write_bytes(image)
                (folder / "request.json").write_text(json.dumps(config), encoding="utf-8")
                for phase in ("shape", "texture"):
                    # Separate processes release ALL model memory between the stages.
                    # A texture failure aborts the request; no untextured fallback.
                    command = [sys.executable, str(Path(__file__).with_name("worker.py")), phase,
                               "--root", str(self.server.hunyuan_root), "--job", str(folder),
                               "--memory-mode", self.server.memory_mode]
                    result = subprocess.run(command, cwd=self.server.hunyuan_root, timeout=22 * 60, check=False,
                                            env={**os.environ, "PYTHONUNBUFFERED": "1"})
                    if result.returncode:
                        return self.reply(503, {"error": f"{phase} stage failed; see the server console"}, f"{phase}_failed")
                model = folder / "textured.glb"
                size = model.stat().st_size
                if size < 20 or size > MAX_MODEL:
                    return self.reply(502, {"error": "Invalid model output"})
                self.send_response(200)
                self.send_header("Content-Type", "model/gltf-binary")
                self.send_header("Content-Length", str(size))
                self.send_header("Connection", "close")
                self.end_headers()
                with model.open("rb") as handle:
                    while chunk := handle.read(1024 * 1024):
                        self.wfile.write(chunk)
        except subprocess.TimeoutExpired:
            self.reply(504, {"error": "GPU stage timed out"}, "timeout")
        except (BrokenPipeError, ConnectionResetError):
            pass  # Client cancellation; worker processes have already exited.
        except Exception:
            import traceback
            traceback.print_exc()
            self.reply(500, {"error": "Generation failed; see the server console"})
        finally:
            BUSY.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hunyuan-root", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--memory-mode", choices=("offload", "standard"), default="offload")
    args = parser.parse_args()
    root = args.hunyuan_root.resolve(strict=True)
    if not (root / "hy3dshape").is_dir() or not (root / "hy3dpaint").is_dir():
        parser.error("Expected the official Hunyuan3D-2.1 checkout")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.hunyuan_root, server.memory_mode = root, args.memory_mode
    print(f"GameCreator generation backend listening on 127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
