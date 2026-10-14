"""A copy of serve.py with a bigger listen backlog (the default of 5 refuses connections when the page loads ~100 pictures at once)."""
import os, sys, socketserver
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
import serve
os.environ["SERVE_QUIET"] = "1"
os.chdir(ROOT)
class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    request_queue_size = 256
    daemon_threads = True
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8741
with S(("127.0.0.1", port), serve.Handler) as httpd:
    httpd.serve_forever()
