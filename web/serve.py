# Static server for the repo, with caching off: web/ reads ../assets and ../worlds.
# It writes two files, for the Save button of the admin menu (web/systems/admin.js): saves/admin.json (the settings and
# the stats of the human) and saves/monsters.json (the monster types changed in the admin menu).
#   python3 web/serve.py [port]   then open http://127.0.0.1:8643/web/
import http.server, functools, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVES = {'/saves/admin.json', '/saves/monsters.json'}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        path = self.path.split('?')[0]
        if path not in SAVES:
            return self.send_error(404)
        try:
            data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        except ValueError:
            return self.send_error(400, 'not JSON')
        save = os.path.join(ROOT, path.lstrip('/'))
        os.makedirs(os.path.dirname(save), exist_ok=True)
        with open(save, 'w') as f:
            json.dump(data, f, indent=1)
            f.write('\n')
        self.send_response(204)
        self.end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8643
print(f'http://127.0.0.1:{port}/web/', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', port),
                                functools.partial(Handler, directory=ROOT)).serve_forever()
