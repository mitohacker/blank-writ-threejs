"""Static server for Blank Writ (three.js): no caching (the modules are edited all the time), JS served as text/javascript.

    python serve.py [port]        (default 8712, the port the register gives blank-writ-threejs)
"""
import http.server
import os
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.json': 'application/json', '.webp': 'image/webp', '.mp3': 'audio/mpeg'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if os.environ.get('SERVE_QUIET') != '1':
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8712
    os.chdir(ROOT)
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.request_queue_size = 256   # ~100 pictures are asked for at once on the first load
    socketserver.ThreadingTCPServer.daemon_threads = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', port), Handler) as httpd:
        print(f'serving {ROOT} on http://127.0.0.1:{port}/')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
