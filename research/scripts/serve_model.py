#!/usr/bin/env python3
"""Serve a Hugging Face checkpoint (optionally + LoRA adapter) over the same contract as the Node model server.

    python research/scripts/serve_model.py --model-id qwen3.5-0.8b-base --port 8790
    python research/scripts/serve_model.py --model-id egoversa-spatial-1b --adapter research/runs/A_geometry/adapter-best

    GET  /health   -> {"ok": true, "model": ..., "revision": ..., "adapter": ...}
    POST /predict  {"images": [<png/jpeg data URL>...], "prompt": "..."}  -> {"rawOutput", "latencyMs", ...}

Use it to try a freshly trained adapter before exporting it to GGUF. Binds to 127.0.0.1 only; accepts
nothing but base64 image data URLs and one prompt string (no paths, no URLs, no extra fields).
"""
import argparse
import base64
import io
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
DATA_URL = re.compile(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)$")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model-id", required=True)
    ap.add_argument("--adapter", type=Path)
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--device")
    a = ap.parse_args()

    from PIL import Image
    from egoversa_research.hf_runtime import HFVisionModel, registry_entry

    reg = registry_entry(a.model_id)
    model = HFVisionModel(reg["hf_id"], adapter=a.adapter, device=a.device)

    class H(BaseHTTPRequestHandler):
        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "http://localhost:5173")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):  # noqa: N802
            self._send(204, {})

        def do_GET(self):  # noqa: N802
            if self.path == "/health":
                return self._send(200, {"ok": True, "model": reg["id"], "hf_id": reg["hf_id"], "revision": model.revision, "adapter": model.adapter, "license": reg["license"], "track": reg["track"]})
            self._send(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802
            if self.path != "/predict":
                return self._send(404, {"error": "not found"})
            n = int(self.headers.get("Content-Length", 0))
            if n > 14_000_000:
                return self._send(413, {"error": "payload too large"})
            try:
                body = json.loads(self.rfile.read(n))
                images, prompt = body["images"], body["prompt"]
                assert isinstance(prompt, str) and 0 < len(prompt) <= 1200
                assert isinstance(images, list) and 1 <= len(images) <= 4
                pil = []
                for im in images:
                    m = DATA_URL.match(im)
                    assert m, "image must be a png/jpeg data URL"
                    pil.append(Image.open(io.BytesIO(base64.b64decode(m.group(2)))).convert("RGB"))
            except Exception as e:  # malformed request
                return self._send(400, {"error": f"bad request: {e}"})
            rep = model.ask(pil, prompt)
            self._send(200, {"model": reg["id"], "rawOutput": rep["raw"], "answer": rep["raw"].strip(), "latencyMs": rep["latency_ms"], "promptTokens": rep["prompt_tokens"], "outputTokens": rep["output_tokens"],
                             "modelRevision": model.revision, "quantization": str(model.dtype).replace("torch.", ""), "license": reg["license"], "track": reg["track"], "prompt": prompt})

        def log_message(self, *args):  # quiet
            pass

    print(f"serving {reg['label']} on http://127.0.0.1:{a.port} (device {model.device})")
    HTTPServer(("127.0.0.1", a.port), H).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
