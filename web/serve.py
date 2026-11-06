# Static server for the repo, with caching off: web/ reads ../assets and ../worlds.
#   python3 web/serve.py [port]   then open http://127.0.0.1:8643/web/
import http.server, functools, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8643
print(f'http://127.0.0.1:{port}/web/', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', port),
                                functools.partial(Handler, directory=ROOT)).serve_forever()
