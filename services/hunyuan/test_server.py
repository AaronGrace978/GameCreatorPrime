import base64
import unittest
import json
import threading
import urllib.request
import urllib.error
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch
from http.server import ThreadingHTTPServer

from server import validate_request, Handler, BUSY


class RequestTests(unittest.TestCase):
    def request(self):
        return {"image": base64.b64encode(b"\x89PNG\r\n\x1a\nexample").decode(),
                "texture": True, "type": "glb", "seed": 42,
                "num_inference_steps": 50, "octree_resolution": 384,
                "max_num_view": 9, "texture_resolution": 768}

    def test_quality_controls_reach_the_worker_configuration(self):
        image, config = validate_request(self.request())
        self.assertTrue(image.startswith(b"\x89PNG"))
        self.assertEqual(config["num_inference_steps"], 50)
        self.assertEqual(config["max_num_view"], 9)

    def test_rejects_non_integer_seed_and_unsupported_memory_settings(self):
        for patch in ({"seed": True}, {"seed": -1}, {"octree_resolution": 1024}, {"max_num_view": 24}):
            with self.assertRaises(ValueError):
                validate_request({**self.request(), **patch})

    def test_requires_texture_and_glb(self):
        for patch in ({"texture": False}, {"type": "obj"}):
            with self.assertRaises(ValueError):
                validate_request({**self.request(), **patch})

    def test_rejects_invalid_image_data(self):
        for image in ("bad!", base64.b64encode(b"not a png").decode()):
            with self.assertRaises(ValueError):
                validate_request({**self.request(), "image": image})


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.hunyuan_root = Path(".")
        self.server.memory_mode = "offload"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_health_contract(self):
        with urllib.request.urlopen(self.url + "/health") as response:
            self.assertEqual(json.load(response), {"status": "ready", "backend": "hunyuan3d-2.1", "protocol": 1, "memory_mode": "offload"})

    def post(self, data):
        return urllib.request.urlopen(urllib.request.Request(self.url + "/generate", data=json.dumps(data).encode(), headers={"Content-Type": "application/json"}))

    def test_worker_failure_is_reported_instead_of_returning_a_model(self):
        with patch("server.subprocess.run", return_value=CompletedProcess([], 1)):
            with self.assertRaises(urllib.error.HTTPError) as result:
                self.post(RequestTests().request())
            self.assertEqual(result.exception.code, 503)
            self.assertEqual(result.exception.headers["X-GCP-Error"], "shape_failed")
            # The HTTP client can receive headers before the handler's finally
            # block runs. Verify it releases the GPU slot after cleanup.
            released = BUSY.acquire(timeout=1)
            self.assertTrue(released)
            if released:
                BUSY.release()

    def test_busy_gpu_rejects_a_second_request(self):
        BUSY.acquire()
        try:
            with self.assertRaises(urllib.error.HTTPError) as result:
                self.post(RequestTests().request())
            self.assertEqual(result.exception.code, 409)
        finally:
            BUSY.release()


if __name__ == "__main__":
    unittest.main()
