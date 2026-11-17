# Static server for the repo, with caching off: web/ reads ../assets and ../worlds.
# It writes two files, for the Save button of the admin menu (web/systems/admin.js): saves/admin.json (the settings and
# the stats of the human) and saves/monsters.json (the monster types changed in the admin menu). And the cubes of a world
# made beforehand: worlds/baked/<world>.bin, sent by the page opened with ?bake (web/lib/voxelSaved.js).
# The network (web/systems/net.js): a WebSocket at /net?room=<world>&name=<name>. The players of one room (one world)
# are together: the server gives each one a number, says who comes and who goes, and passes each message on to the
# others of its room (or to one of them: "to"). The first player of a room is its host (it runs the monsters); when
# the host goes, the player who came next is the host. A 'ping' (a page alone sends one every 20 s, so a tunnel does
# not close the connection) goes to nobody. Each join and leave is printed.
# Accounts (web/lib/room.js): a username and a password, in saves/accounts.json (the password as a salted PBKDF2
# hash). POST /account/new or /account/login {username, password} logs the browser in: a cookie the page cannot read
# (COOKIE), kept until POST /account/logout. GET /account: {name} (null: not logged in). A wrong password waits 1 s.
# Rooms: a player logged in makes a room (POST /rooms {title}: its id) and sends its link (?room=<id>) to its friends.
# The room keeps the player of each account: saves/rooms/<id>.json {title, players: {username: player}}. A page reads
# its player (GET /rooms/<id>: {title, name, player}; name null: not logged in, player null the first time) and writes
# it (POST /rooms/<id>, every 10 s and when it closes). saves/ (but the two admin files) is not served as files.
# Logged in, a player has its username on the network too.
#   python3 web/serve.py [port] [--lan] [--prefix=/game_01]   then open http://127.0.0.1:8643/web/
#   --lan: other computers of the network can open it too (http://<this computer>:8643/web/)
#   --prefix=/game_01: also answers under /game_01/ (http://127.0.0.1:8701/game_01/web/), for a test branch online
import http.server, functools, json, os, re, shutil, sys, base64, hashlib, hmac, struct, threading, secrets, time
from http.cookies import SimpleCookie
from urllib.parse import urlparse, parse_qs, unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVES = {'/saves/admin.json', '/saves/monsters.json'}
BAKED = re.compile(r'^/worlds/baked/[A-Za-z0-9_-]+\.bin$')
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
ROOMS = os.path.join(ROOT, 'saves', 'rooms')
ROOM = re.compile(r'^/rooms/([a-z0-9]{8})$')
MAX_ROOMS = 1000           # rooms made, at most
MAX_PLAYER = 256 * 1024    # bytes of one saved player, at most
MAX_FRAME = 1 << 20        # bytes of one WebSocket message, at most: a bigger one closes the connection
files_lock = threading.Lock()
ACCOUNTS = os.path.join(ROOT, 'saves', 'accounts.json')
USERNAME = re.compile(r'^[A-Za-z0-9_]{3,20}$')
MAX_ACCOUNTS = 5000
# --prefix=/game_01: the server answers under that path too (a tunnel rule sends game.aissabenfodda.ca/game_01/ here),
# and its login cookie has its own name, so it does not mix with the one of the live game
PREFIX = next((a.split('=', 1)[1].rstrip('/') for a in sys.argv[1:] if a.startswith('--prefix=')), '')
COOKIE = 'lambda' + PREFIX.replace('/', '_')
YEAR = 365 * 24 * 3600

rooms = {}                 # room -> [Peer], the first one is the host
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


def room_file(room_id):
    return os.path.join(ROOMS, room_id + '.json')


def read_room(room_id):
    try:
        with open(room_file(room_id)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_room(room_id, room):
    os.makedirs(ROOMS, exist_ok=True)
    with open(room_file(room_id) + '.part', 'w') as f:
        json.dump(room, f, separators=(',', ':'))
    os.replace(room_file(room_id) + '.part', room_file(room_id))


def read_accounts():
    try:
        with open(ACCOUNTS) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {'users': {}, 'sessions': {}}


def write_accounts(accounts):
    os.makedirs(os.path.dirname(ACCOUNTS), exist_ok=True)
    with open(ACCOUNTS + '.part', 'w') as f:
        json.dump(accounts, f, separators=(',', ':'))
    os.replace(ACCOUNTS + '.part', ACCOUNTS)


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 200_000).hex()


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

    # with --prefix, /game_01/web/... is read as /web/... (the address without it works too)
    def parse_request(self):
        if not super().parse_request():
            return False
        if PREFIX and self.path.startswith(PREFIX) and self.path[len(PREFIX):len(PREFIX) + 1] in ('', '/', '?'):
            rest = self.path[len(PREFIX):]
            self.path = rest if rest.startswith('/') else '/' + rest
        return True

    # the address alone opens the game; no folder is listed, and no file or folder whose name starts with a dot (.git)
    # or of documentation/ is served
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/net' and self.headers.get('Upgrade', '').lower() == 'websocket':
            return self.network(parse_qs(url.query))
        if url.path == '/':
            self.send_response(302)
            self.send_header('Location', PREFIX + '/web/' + ('?' + url.query if url.query else ''))
            self.end_headers()
            return
        if url.path.startswith('/saves/') and url.path not in SAVES:
            return self.send_error(404)
        if url.path == '/account':
            return self.answer({'name': self.user()})
        found = ROOM.match(url.path)
        if found:
            room, name = read_room(found[1]), self.user()
            if room is None:
                return self.send_error(404, 'no room')
            return self.answer({'title': room['title'], 'name': name, 'player': room['players'].get(name) if name else None})
        return super().do_GET()

    # every file (GET and HEAD): none whose path has a part starting with a dot, none of documentation/
    def send_head(self):
        path = unquote(urlparse(self.path).path)
        if any(part.startswith('.') for part in path.split('/')) or path.startswith('/documentation'):
            self.send_error(404)
            return None
        if PREFIX and not path.endswith('/') and os.path.isdir(self.translate_path(self.path)):
            self.send_response(301)       # a folder without its last /: the address keeps the prefix
            self.send_header('Location', PREFIX + path + '/' + ('?' + urlparse(self.path).query if urlparse(self.path).query else ''))
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

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

    # the username of the account this browser is logged in, or None
    def user(self):
        token = self.token()
        if not token:
            return None
        with files_lock:
            return read_accounts()['sessions'].get(token)

    # POST /account/new, /account/login, /account/logout
    def account(self, path):
        if path == '/account/logout':
            token = self.token()
            with files_lock:
                accounts = read_accounts()
                if token and accounts['sessions'].pop(token, None):
                    write_accounts(accounts)
            return self.answer({'name': None}, cookie='')
        data = self.body(1024)
        if not isinstance(data, dict):
            if data is not None:
                self.send_error(400, 'not an object')
            return
        username, password = str(data.get('username', '')).strip(), str(data.get('password', ''))
        if path == '/account/new':
            if not USERNAME.match(username):
                return self.answer({'error': 'username: 3 to 20 letters, digits or _'}, 400)
            if not 6 <= len(password) <= 200:
                return self.answer({'error': 'password: 6 characters or more'}, 400)
        elif path != '/account/login':
            return self.send_error(404)
        key = username.lower()
        with files_lock:
            accounts = read_accounts()
            users = accounts['users']
            if path == '/account/new':
                if key in users:
                    return self.answer({'error': 'this username is taken'}, 409)
                if len(users) >= MAX_ACCOUNTS:
                    return self.answer({'error': 'too many accounts'}, 503)
                salt = secrets.token_hex(16)
                users[key] = {'name': username, 'salt': salt, 'hash': hash_password(password, salt), 'made': int(time.time())}
                print(f'[account] {username} made', flush=True)
            user = users.get(key)
            good = user is not None and hmac.compare_digest(user['hash'], hash_password(password[:200], user['salt']))
            if good:
                token = secrets.token_urlsafe(32)
                accounts['sessions'][token] = user['name']
                write_accounts(accounts)
        if not good:
            time.sleep(1)
            return self.answer({'error': 'wrong username or password'}, 401)
        return self.answer({'name': user['name']}, cookie=token)

    def body(self, most):
        n = int(self.headers.get('Content-Length', 0) or 0)
        if n > most:
            self.close_connection = True
            self.send_error(413)
            return None
        try:
            return json.loads(self.rfile.read(n))
        except ValueError:
            self.send_error(400, 'not JSON')
            return None

    # a new room (POST /rooms {title}), or the player of this account in a room (POST /rooms/<id>)
    def rooms(self, url):
        name = self.user()
        if not name:
            return self.answer({'error': 'log in first'}, 401)
        if url.path == '/rooms':
            data = self.body(1024)
            if not isinstance(data, dict):
                if data is not None:
                    self.send_error(400, 'not an object')
                return
            title = str(data.get('title', '')).strip()[:32] or 'Room'
            with files_lock:
                os.makedirs(ROOMS, exist_ok=True)
                if sum(1 for f in os.listdir(ROOMS) if f.endswith('.json')) >= MAX_ROOMS:
                    return self.send_error(503, 'too many rooms')
                room_id = ''.join(secrets.choice('abcdefghijkmnpqrstuvwxyz23456789') for _ in range(8))
                write_room(room_id, {'title': title, 'made': int(time.time()), 'players': {}})
            print(f'[room] {title} ({room_id}) made by {name}', flush=True)
            return self.answer({'id': room_id, 'title': title})
        found = ROOM.match(url.path)
        if not found:
            return self.send_error(404)
        data = self.body(MAX_PLAYER)
        if not isinstance(data, dict):
            if data is not None:
                self.send_error(400, 'not an object')
            return
        with files_lock:
            room = read_room(found[1])
            if room is None:
                return self.send_error(404, 'no room')
            room['players'][name] = data
            write_room(found[1], room)
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
        if path == '/rooms' or path.startswith('/rooms/'):
            return self.rooms(urlparse(self.path))
        if path.startswith('/account/'):
            return self.account(path)
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


args = [a for a in sys.argv[1:] if not a.startswith('--')]
port = int(args[0]) if args else 8643
host = '0.0.0.0' if '--lan' in sys.argv else '127.0.0.1'
print(f'http://127.0.0.1:{port}{PREFIX}/web/', flush=True)
http.server.ThreadingHTTPServer((host, port), functools.partial(Handler, directory=ROOT)).serve_forever()
