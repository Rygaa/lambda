# Static server for the repo, with caching off: web/ reads ../assets and ../worlds.
# It writes one file: saves/admin.json, the settings of the Save button of the admin menu (web/systems/admin.js).
#   python3 web/serve.py [port]   then open http://127.0.0.1:8643/web/
import http.server, functools, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVE = os.path.join(ROOT, 'saves', 'admin.json')


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path.split('?')[0] != '/saves/admin.json':
            return self.send_error(404)
        try:
            data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        except ValueError:
            return self.send_error(400, 'not JSON')
        os.makedirs(os.path.dirname(SAVE), exist_ok=True)
        with open(SAVE, 'w') as f:
            json.dump(data, f, indent=1)
            f.write('\n')
        self.send_response(204)
        self.end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8643
print(f'http://127.0.0.1:{port}/web/', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', port),
                                functools.partial(Handler, directory=ROOT)).serve_forever()
