# The PostgreSQL database of the game (db/migrations/*.sql): accounts, logins, rooms, the player of each account in each
# room, and the admin settings. web/serve.py and db/setup.py use it.
# Which database: the environment variable LAMBDA_DB, else lambda. The server is the local PostgreSQL (or PGHOST, PGPORT, PGUSER... of libpq).
import json, os, secrets, threading
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATIONS = os.path.join(ROOT, 'db', 'migrations')
CODE = 'abcdefghijkmnpqrstuvwxyz23456789'   # the letters of a room code (no l, o, 0, 1: easy to read out)
PLAYER = ('world', 'x', 'z', 'stats', 'hp', 'mp', 'skills', 'bag', 'outfit', 'quests')   # the columns of a player
JSON_COLUMNS = {'stats', 'skills', 'bag', 'outfit', 'quests'}


def db_name():
    if os.environ.get('LAMBDA_DB'):
        return os.environ['LAMBDA_DB']
    return 'lambda'


def connect(name=None):
    return psycopg.connect(dbname=name or db_name(), autocommit=True, row_factory=dict_row)


def migrate(conn):
    """Applies the files of db/migrations not applied yet, in order, each in one transaction. -> their names"""
    conn.execute('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
    done = {r['name'] for r in conn.execute('select name from schema_migrations')}
    applied = []
    for name in sorted(f for f in os.listdir(MIGRATIONS) if f.endswith('.sql')):
        if name in done:
            continue
        with open(os.path.join(MIGRATIONS, name)) as f:
            sql = f.read()
        with conn.transaction():
            conn.execute(sql)
            conn.execute('insert into schema_migrations (name) values (%s)', (name,))
        applied.append(name)
    return applied


class Store:
    """The queries of the server. One connection per thread (the server answers each request in its own thread)."""

    def __init__(self, name=None):
        self.name = name or db_name()
        self.local = threading.local()

    def q(self, sql, args=()):
        for attempt in (0, 1):
            conn = getattr(self.local, 'conn', None)
            if conn is None or conn.closed:
                conn = self.local.conn = connect(self.name)
            try:
                return conn.execute(sql, args)
            except psycopg.OperationalError:
                conn.close()
                if attempt:
                    raise

    def one(self, sql, args=()):
        return self.q(sql, args).fetchone()

    def all(self, sql, args=()):
        return self.q(sql, args).fetchall()

    # accounts and logins
    def account_of(self, token):
        """the account a cookie token is logged in: {id, username, admin}, or None"""
        if not token:
            return None
        return self.one('select a.id, a.username, a.admin from sessions s join accounts a on a.id = s.account_id where s.token = %s', (token,))

    def account_named(self, username):
        return self.one('select * from accounts where lower(username) = lower(%s)', (username,))

    def count_accounts(self):
        return self.one('select count(*) as n from accounts')['n']

    def add_account(self, username, salt, password_hash):
        """-> the new account, or None when the name is taken"""
        return self.one('insert into accounts (username, salt, password_hash) values (%s, %s, %s) on conflict do nothing returning id, username, admin',
                        (username, salt, password_hash))

    def log_in(self, account_id):
        token = secrets.token_urlsafe(32)
        self.q('insert into sessions (token, account_id) values (%s, %s)', (token, account_id))
        return token

    def log_out(self, token):
        self.q('delete from sessions where token = %s', (token,))

    def accounts(self):
        return self.all('select username as name, admin from accounts order by lower(username)')

    def set_admin(self, username, admin):
        return self.one('update accounts set admin = %s where lower(username) = lower(%s) returning username as name, admin', (admin, username))

    # rooms
    def add_room(self, owner_id, title):
        """a new room with a free code; its owner joins it -> its code"""
        while True:
            code = ''.join(secrets.choice(CODE) for _ in range(8))
            if self.one('insert into rooms (id, title, owner_id) values (%s, %s, %s) on conflict do nothing returning id', (code, title, owner_id)):
                self.join(code, owner_id)
                return code

    def room(self, code):
        return self.one('select r.id, r.title, r.created_at, r.last_played, o.username as owner from rooms r left join accounts o on o.id = r.owner_id where r.id = %s', (code,))

    def count_rooms(self, owner_id):
        return self.one('select count(*) as n from rooms where owner_id = %s', (owner_id,))['n']

    def join(self, code, account_id):
        self.q('insert into room_players (room_id, account_id) values (%s, %s) on conflict do nothing', (code, account_id))

    def my_rooms(self, account_id):
        """the rooms of an account (made or joined), the last played first, with its player there and the members"""
        return self.all('''
            select r.id, r.title, o.username as owner, r.owner_id = %(me)s as mine, r.created_at, r.last_played,
                   p.world, p.level, p.updated_at as my_last_played,
                   (select count(*) from room_players m where m.room_id = r.id) as members
            from room_players p join rooms r on r.id = p.room_id left join accounts o on o.id = r.owner_id
            where p.account_id = %(me)s
            order by greatest(r.last_played, p.joined_at) desc''', {'me': account_id})

    def player(self, code, account_id):
        """the player of an account in a room (None: not a member; {} : a member that has not played yet)"""
        row = self.one(f'select {", ".join(PLAYER)} from room_players where room_id = %s and account_id = %s', (code, account_id))
        if row is None:
            return None
        return {k: v for k, v in row.items() if v is not None}

    def save_player(self, code, account_id, data):
        values = [Jsonb(data.get(k)) if k in JSON_COLUMNS else data.get(k) for k in PLAYER]
        sets = ', '.join(f'{k} = %s' for k in PLAYER)
        # one statement: the player and the last played time of its room together
        self.q(f'''with p as (update room_players set {sets}, updated_at = now() where room_id = %s and account_id = %s returning room_id)
                   update rooms set last_played = now() where id in (select room_id from p)''', (*values, code, account_id))

    def leave(self, code, account_id):
        self.q('delete from room_players where room_id = %s and account_id = %s', (code, account_id))

    def delete_room(self, code):
        self.q('delete from rooms where id = %s', (code,))

    # admin settings
    def setting(self, name):
        row = self.one('select data from settings where name = %s', (name,))
        return row['data'] if row else None

    def set_setting(self, name, data):
        self.q('insert into settings (name, data) values (%s, %s) on conflict (name) do update set data = excluded.data, updated_at = now()', (name, Jsonb(data)))


def as_json(value):
    """a row for an answer: the dates as ISO text"""
    return json.loads(json.dumps(value, default=lambda v: v.isoformat() if hasattr(v, 'isoformat') else str(v)))
