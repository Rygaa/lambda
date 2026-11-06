# Static server for this folder with caching off (assets are rebuilt often).
# PUT /capture/<name>.png saves a frame into captures/ (used to compare with Blender).
import http.server, functools, os, sys, re

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_PUT(self):
        m = re.fullmatch(r'/capture/([\w-]+\.png)', self.path)
        if not m:
            self.send_error(404)
            return
        data = self.rfile.read(int(self.headers['Content-Length']))
        os.makedirs(os.path.join(HERE, 'captures'), exist_ok=True)
        with open(os.path.join(HERE, 'captures', m.group(1)), 'wb') as fh:
            fh.write(data)
        self.send_response(204)
        self.end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8643
http.server.ThreadingHTTPServer(('127.0.0.1', port),
                                functools.partial(Handler, directory=HERE)).serve_forever()
