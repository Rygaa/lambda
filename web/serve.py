# The game server: the files of the game, the PostgreSQL database (server/db.py) and the network.
# Set up once with ./setup.sh; then   python3 web/serve.py [port] [--lan] [--prefix=/test]   (it runs itself with
# the Python of .venv). http://127.0.0.1:8643/ opens the home page (web/home.html): log in or make an account, then the
# worlds (rooms) of the account: join one, make one, join a friend's with its code. The game is /web/?room=<code>.
#   --lan: other computers of the network can open it too (http://<this computer>:8643/)
#   --prefix=/test: also answers under /test/ (a tunnel rule sends game.aissabenfodda.ca/test/ here), for another
#   test branch online; its login cookie has its own name
# Files: only web/, assets/ and worlds/ are served (never a .py file or a name starting with a dot), with caching off.
# Accounts: POST /account/new or /account/login {username, password} logs the browser in (a cookie the page cannot
# read, a row of the table sessions), POST /account/logout logs it out, GET /account: {name, admin}. A wrong password
# waits 1 s. The password is kept as a salted PBKDF2-SHA256 hash.
# Rooms: GET /rooms: the rooms of the account (made or joined), with its player there and the players online; POST
# /rooms {title}: a new room (its code); GET /rooms/<code>: joins it (it is then in the list) -> {title, owner, name,
# player}; POST /rooms/<code> {player}: saves the player of the account there (the page: every 10 s, when it closes, at
# a portal); POST /rooms/<code>/leave: takes it out of the list (its owner: deletes the room).
# Admins: an account with admin true. They read and write the admin settings (GET/POST /saves/admin.json and
# /saves/monsters.json, now in the table settings), the cubes of a world made beforehand (POST /worlds/baked/<w>.bin),
# list the accounts (GET /accounts) and make one admin or not (POST /account/admin {username, admin}), not themselves.
# A request that did not come through the Cloudflare tunnel (no Cf-Connecting-Ip header: this computer) counts as admin.
# The network (web/systems/net.js): a WebSocket at /net?room=<room>/<world>&name=<name>. The players of one room and
# world are together: the server gives each one a number, says who comes and who goes, and passes each message on to
# the others (or to one of them: "to"). The first player is the host (it runs the monsters); when it goes, the player
# who came next is the host. A 'ping' (a page alone sends one every 20 s, so a tunnel does not close the connection)
# goes to nobody. Each join and leave is printed.
import http.server, functools, json, os, re, shutil, sys, base64, hashlib, hmac, struct, threading, secrets, time
from http.cookies import SimpleCookie
from urllib.parse import urlparse, parse_qs, unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
try:
    import psycopg
except ModuleNotFoundError:
    # started with the Python of the computer: again with the one of .venv (./setup.sh made it)
    VENV = os.path.join(ROOT, '.venv')
    if os.path.exists(os.path.join(VENV, 'bin', 'python')) and os.path.realpath(sys.prefix) != os.path.realpath(VENV):
        os.execv(os.path.join(VENV, 'bin', 'python'), [os.path.join(VENV, 'bin', 'python'), os.path.abspath(__file__), *sys.argv[1:]])
    sys.exit('psycopg is missing: run ./setup.sh first')
from server.db import Store, as_json, db_name

SERVED = ('/web/', '/assets/', '/worlds/')      # the folders served as files
SETTINGS = {'/saves/admin.json': 'admin', '/saves/monsters.json': 'monsters'}
BAKED = re.compile(r'^/worlds/baked/[A-Za-z0-9_-]+\.bin$')
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
ROOM = re.compile(r'^/rooms/([a-z0-9]{8})(/leave)?$')
USERNAME = re.compile(r'^[A-Za-z0-9_]{3,20}$')
MAX_ROOMS = 20             # rooms one account makes, at most
MAX_ACCOUNTS = 5000
MAX_PLAYER = 256 * 1024    # bytes of one saved player, at most
MAX_FRAME = 1 << 20        # bytes of one WebSocket message, at most: a bigger one closes the connection
PREFIX = next((a.split('=', 1)[1].rstrip('/') for a in sys.argv[1:] if a.startswith('--prefix=')), '')
COOKIE = 'lambda' + PREFIX.replace('/', '_')
YEAR = 365 * 24 * 3600

store = Store()
rooms = {}                 # network room (<code>/<world>) -> [Peer], the first one is the host
rooms_lock = threading.Lock()
next_id = [1]


class Peer:
    def __init__(self, sock, name):
        self.sock, self.name, self.lock = sock, name, threading.Lock()
        self.id = next_id[0]
        next_id[0] += 1

    def send(self, message):
        data = json.dumps(message, separators=(',', ':')).encode()
        n = len(data)
        head = b'\x81' + (bytes([n]) if n < 126 else struct.pack('!BH', 126, n) if n < 65536 else struct.pack('!BQ', 127, n))
        try:
            with self.lock:
                self.sock.sendall(head + data)
        except OSError:
            pass


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 200_000).hex()


def online_in(code):
    """the players on the network now in a room (any of its worlds)"""
    with rooms_lock:
        return sum(len(peers) for key, peers in rooms.items() if key.startswith(code + '/'))


def read_frame(f):
    """One WebSocket frame from the client: (opcode, payload), or None when the connection is closed."""
    head = f.read(2)
    if len(head) < 2:
        return None
    opcode, n = head[0] & 0x0F, head[1] & 0x7F
    if n == 126:
        n = struct.unpack('!H', f.read(2))[0]
    elif n == 127:
        n = struct.unpack('!Q', f.read(8))[0]
    if n > MAX_FRAME:
        return None
    mask = f.read(4) if head[1] & 0x80 else b'\0\0\0\0'
    data = bytearray(f.read(n))
    if len(data) < n:
        return None
    for i in range(n):
        data[i] ^= mask[i % 4]
    return opcode, bytes(data)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    # with --prefix, /test/web/... is read as /web/... (the address without it works too)
    def parse_request(self):
        if not super().parse_request():
            return False
        self.__dict__.pop('account', None)
        self.bare_prefix = bool(PREFIX) and self.path.split('?')[0] == PREFIX
        if PREFIX and self.path.startswith(PREFIX) and self.path[len(PREFIX):len(PREFIX) + 1] in ('', '/', '?'):
            rest = self.path[len(PREFIX):]
            self.path = rest if rest.startswith('/') else '/' + rest
        return True

    # a database error answers 503 (the database is missing or stopped: ./setup.sh)
    def handle_one_request(self):
        try:
            super().handle_one_request()
        except psycopg.Error as err:
            print(f'[db] {type(err).__name__}: {err}'.strip(), flush=True)
            try:
                self.answer({'error': f'database {db_name()}: run ./setup.sh'}, 503)
            except OSError:
                pass

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/net' and self.headers.get('Upgrade', '').lower() == 'websocket':
            return self.network(parse_qs(url.query))
        if url.path == '/':
            if self.bare_prefix:          # /test -> /test/, so the links of the page stay under it
                return self.go(PREFIX + '/' + ('?' + url.query if url.query else ''))
            self.path = '/web/home.html'
            return super().do_GET()
        if url.path in SETTINGS:
            data = store.setting(SETTINGS[url.path])
            return self.answer(data) if data is not None else self.send_error(404)
        if url.path == '/account':
            me = self.me()
            return self.answer({'name': me and me['username'], 'admin': self.admin()})
        if url.path == '/accounts':
            return self.answer(store.accounts()) if self.admin() else self.send_error(403)
        if url.path == '/rooms':
            me = self.me()
            if not me:
                return self.answer({'error': 'log in first'}, 401)
            mine = [{**as_json(r), 'online': online_in(r['id'])} for r in store.my_rooms(me['id'])]
            return self.answer(mine)
        found = ROOM.match(url.path)
        if found and not found[2]:
            me, room = self.me(), store.room(found[1])
            if room is None:
                return self.answer({'error': 'no such room'}, 404)
            if not me:
                return self.answer({'error': 'log in first', 'title': room['title']}, 401)
            store.join(room['id'], me['id'])
            return self.answer({'title': room['title'], 'owner': room['owner'], 'name': me['username'], 'player': store.player(room['id'], me['id']) or None})
        return super().do_GET()

    # the files (GET and HEAD): only web/, assets/ and worlds/, no .py file and no name starting with a dot
    def send_head(self):
        path = unquote(urlparse(self.path).path)
        if not path.startswith(SERVED) or path.endswith('.py') or any(part.startswith('.') for part in path.split('/')):
            self.send_error(404)
            return None
        if PREFIX and not path.endswith('/') and os.path.isdir(self.translate_path(self.path)):
            query = urlparse(self.path).query      # a folder without its last /: the address keeps the prefix
            self.go(PREFIX + path + '/' + ('?' + query if query else ''), 301)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def go(self, location, status=302):
        self.send_response(status)
        self.send_header('Location', location)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def answer(self, data, status=200, cookie=None):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        if cookie is not None:
            secure = '; Secure' if self.headers.get('X-Forwarded-Proto') == 'https' else ''
            age = YEAR if cookie else 0
            self.send_header('Set-Cookie', f'{COOKIE}={cookie}; Path={PREFIX or "/"}; Max-Age={age}; HttpOnly; SameSite=Lax{secure}')
        self.end_headers()
        self.wfile.write(body)

    def token(self):
        try:
            jar = SimpleCookie(self.headers.get('Cookie', ''))
        except Exception:
            return None
        return jar[COOKIE].value if COOKIE in jar else None

    # the account this browser is logged in: {id, username, admin}, or None (read once per request)
    def me(self):
        if not hasattr(self, 'account'):
            self.account = store.account_of(self.token())
        return self.account

    # the username, or None
    def user(self):
        me = self.me()
        return me['username'] if me else None

    # an admin account, or this computer (not through the tunnel)
    def admin(self):
        return 'Cf-Connecting-Ip' not in self.headers or bool(self.me() and self.me()['admin'])

    def body(self, most):
        n = int(self.headers.get('Content-Length', 0) or 0)
        if n > most:
            self.close_connection = True
            self.send_error(413)
            return None
        try:
            data = json.loads(self.rfile.read(n))
        except ValueError:
            self.send_error(400, 'not JSON')
            return None
        if not isinstance(data, dict):
            self.send_error(400, 'not an object')
            return None
        return data

    # POST /account/new, /account/login, /account/logout
    def account_post(self, path):
        if path == '/account/logout':
            if self.token():
                store.log_out(self.token())
            return self.answer({'name': None}, cookie='')
        data = self.body(1024)
        if data is None:
            return
        username, password = str(data.get('username', '')).strip(), str(data.get('password', ''))[:200]
        if path == '/account/new':
            if not USERNAME.match(username):
                return self.answer({'error': 'username: 3 to 20 letters, digits or _'}, 400)
            if len(password) < 6:
                return self.answer({'error': 'password: 6 characters or more'}, 400)
            if store.count_accounts() >= MAX_ACCOUNTS:
                return self.answer({'error': 'too many accounts'}, 503)
            salt = secrets.token_hex(16)
            user = store.add_account(username, salt, hash_password(password, salt))
            if user is None:
                return self.answer({'error': 'this username is taken'}, 409)
            print(f'[account] {username} made', flush=True)
        elif path == '/account/login':
            row = store.account_named(username)
            user = row if row and hmac.compare_digest(row['password_hash'], hash_password(password, row['salt'])) else None
            if user is None:
                time.sleep(1)
                return self.answer({'error': 'wrong username or password'}, 401)
        else:
            return self.send_error(404)
        return self.answer({'name': user['username'], 'admin': user['admin']}, cookie=store.log_in(user['id']))

    # POST /account/admin {username, admin}: only an admin, and not for itself
    def make_admin(self):
        if not self.admin():
            return self.send_error(403)
        data = self.body(1024)
        if data is None:
            return
        username = str(data.get('username', '')).strip()
        if username.lower() == (self.user() or '').lower():
            return self.answer({'error': 'you cannot change your own admin'}, 400)
        user = store.set_admin(username, bool(data.get('admin')))
        if user is None:
            return self.answer({'error': 'no such account'}, 404)
        print(f'[account] {user["name"]} admin: {user["admin"]} (by {self.user() or "this computer"})', flush=True)
        return self.answer(user)

    # POST /rooms {title}, /rooms/<code> {player}, /rooms/<code>/leave
    def rooms_post(self, path):
        me = self.me()
        if not me:
            return self.answer({'error': 'log in first'}, 401)
        if path == '/rooms':
            data = self.body(1024)
            if data is None:
                return
            if store.count_rooms(me['id']) >= MAX_ROOMS:
                return self.answer({'error': f'{MAX_ROOMS} worlds at most'}, 403)
            title = str(data.get('title', '')).strip()[:32] or 'World'
            code = store.add_room(me['id'], title)
            print(f'[room] {title} ({code}) made by {me["username"]}', flush=True)
            return self.answer({'id': code, 'title': title})
        found = ROOM.match(path)
        room = found and store.room(found[1])
        if not room:
            return self.answer({'error': 'no such room'}, 404)
        if found[2]:
            if room['owner'] == me['username']:
                store.delete_room(room['id'])
                print(f'[room] {room["title"]} ({room["id"]}) deleted by {me["username"]}', flush=True)
            else:
                store.leave(room['id'], me['id'])
            return self.answer({'left': room['id']})
        data = self.body(MAX_PLAYER)
        if data is None:
            return
        store.join(room['id'], me['id'])
        store.save_player(room['id'], me['id'], data)
        self.send_response(204)
        self.end_headers()

    def network(self, query):
        key = self.headers.get('Sec-WebSocket-Key', '')
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        self.wfile.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                          f'Sec-WebSocket-Accept: {accept}\r\n\r\n').encode())
        self.wfile.flush()
        self.close_connection = True
        room = query.get('room', ['?'])[0]
        me = Peer(self.connection, self.user() or query.get('name', [''])[0][:24])
        me.name = me.name or f'Player {me.id}'
        with rooms_lock:
            peers = rooms.setdefault(room, [])
            others = list(peers)
            peers.append(me)
        print(f'[net] {me.name} (#{me.id}) joins {room}: {len(others) + 1} player(s)', flush=True)
        me.send({'t': 'welcome', 'id': me.id, 'name': me.name, 'host': (others or [me])[0].id,
                 'peers': [{'id': p.id, 'name': p.name} for p in others]})
        for p in others:
            p.send({'t': 'join', 'id': me.id, 'name': me.name})
        try:
            while True:
                frame = read_frame(self.rfile)
                if frame is None or frame[0] == 0x8:
                    break
                if frame[0] == 0x9:       # ping: pong
                    with me.lock:
                        self.connection.sendall(b'\x8a' + bytes([len(frame[1])]) + frame[1])
                    continue
                if frame[0] != 0x1:
                    continue
                try:
                    message = json.loads(frame[1])
                except ValueError:
                    continue
                if message.get('t') == 'ping':
                    continue
                message['from'] = me.id
                to = message.pop('to', None)
                with rooms_lock:
                    targets = [p for p in rooms.get(room, []) if p is not me and (to is None or p.id == to)]
                for p in targets:
                    p.send(message)
        except OSError:
            pass
        finally:
            with rooms_lock:
                peers = rooms.get(room, [])
                if me in peers:
                    peers.remove(me)
                left = list(peers)
                if not peers:
                    rooms.pop(room, None)
            print(f'[net] {me.name} (#{me.id}) leaves {room}: {len(left)} player(s)', flush=True)
            for p in left:
                p.send({'t': 'leave', 'id': me.id, 'host': left[0].id})

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/account/admin':
            return self.make_admin()
        if path.startswith('/account/'):
            return self.account_post(path)
        if path == '/rooms' or path.startswith('/rooms/'):
            return self.rooms_post(path)
        if (BAKED.match(path) or path in SETTINGS) and not self.admin():
            return self.send_error(403, 'admins only')
        if path in SETTINGS:
            data = self.body(4 << 20)
            if data is None:
                return
            store.set_setting(SETTINGS[path], data)
            self.send_response(204)
            self.end_headers()
            return
        if BAKED.match(path):
            save = os.path.join(ROOT, path.lstrip('/'))
            os.makedirs(os.path.dirname(save), exist_ok=True)
            with open(save + '.part', 'wb') as f:
                left = int(self.headers.get('Content-Length', 0))
                while left > 0:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    f.write(chunk)
                    left -= len(chunk)
            if left > 0:
                os.remove(save + '.part')
                return self.send_error(400, 'cut short')
            shutil.move(save + '.part', save)
            self.send_response(204)
            self.end_headers()
            return
        return self.send_error(404)


args = [a for a in sys.argv[1:] if not a.startswith('--')]
port = int(args[0]) if args else 8643
host = '0.0.0.0' if '--lan' in sys.argv else '127.0.0.1'
print(f'http://127.0.0.1:{port}{PREFIX}/   (database {db_name()})', flush=True)
http.server.ThreadingHTTPServer((host, port), functools.partial(Handler, directory=ROOT)).serve_forever()
