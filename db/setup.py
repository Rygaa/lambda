# The database part of ./setup.sh: makes the database if it is missing, applies the migrations not applied yet
# (db/migrations), then brings in the old JSON saves of this folder (saves/accounts.json, saves/rooms/*.json,
# saves/admin.json, saves/monsters.json) once per database (marked 'json-saves' in schema_migrations, so accounts
# deleted later never come back). Running it again changes nothing.
#   .venv/bin/python db/setup.py            (LAMBDA_DB=<name> for another database: server/db.py)
import datetime, glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from server.db import ROOT, PLAYER, JSON_COLUMNS, Store, connect, db_name, migrate

SAVES = os.path.join(ROOT, 'saves')


def make_database(name):
    with connect('postgres') as conn:
        if conn.execute('select 1 from pg_database where datname = %s', (name,)).fetchone():
            return False
        conn.execute(sql.SQL('create database {}').format(sql.Identifier(name)))
        return True


def read(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def when(seconds):
    return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc) if seconds else datetime.datetime.now(datetime.timezone.utc)


def import_saves(conn):
    """the old JSON saves, once per database -> what was brought in (None: done before)"""
    if conn.execute("select 1 from schema_migrations where name = 'json-saves'").fetchone():
        return None
    users = (read(os.path.join(SAVES, 'accounts.json')) or {}).get('users', {})
    rooms = [(os.path.basename(p)[:-5], read(p)) for p in sorted(glob.glob(os.path.join(SAVES, 'rooms', '*.json')))]
    count = {'accounts': 0, 'rooms': 0, 'players': 0, 'settings': 0}
    with conn.transaction():
        ids = {}
        for u in users.values():
            row = conn.execute('insert into accounts (username, password_hash, salt, admin, created_at) values (%s, %s, %s, %s, %s) returning id',
                               (u['name'], u['hash'], u['salt'], bool(u.get('admin')), when(u.get('made')))).fetchone()
            ids[u['name'].lower()] = row['id']
            count['accounts'] += 1
        for code, room in rooms:
            if not room:
                continue
            players = [(name, data) for name, data in room.get('players', {}).items() if name.lower() in ids]
            owner = ids[players[0][0].lower()] if players else None
            conn.execute('insert into rooms (id, title, owner_id, created_at) values (%s, %s, %s, %s)', (code, room.get('title') or 'Room', owner, when(room.get('made'))))
            count['rooms'] += 1
            for name, data in players:
                values = [Jsonb(data.get(k)) if k in JSON_COLUMNS else data.get(k) for k in PLAYER]
                conn.execute(f'insert into room_players (room_id, account_id, {", ".join(PLAYER)}) values (%s, %s, {", ".join(["%s"] * len(PLAYER))})',
                             (code, ids[name.lower()], *values))
                count['players'] += 1
        for name in ('admin', 'monsters'):
            data = read(os.path.join(SAVES, name + '.json'))
            if data is not None:
                conn.execute('insert into settings (name, data) values (%s, %s) on conflict do nothing', (name, Jsonb(data)))
                count['settings'] += 1
        conn.execute("insert into schema_migrations (name) values ('json-saves')")
    return count


def main():
    name = db_name()
    try:
        made = make_database(name)
    except psycopg.OperationalError as err:
        sys.exit(f'PostgreSQL does not answer: {err}'.strip())
    print(f'database {name}: {"made" if made else "already there"}')
    with connect(name) as conn:
        applied = migrate(conn)
        print('migrations: ' + (', '.join(applied) if applied else 'all applied already'))
        brought = import_saves(conn)
        if brought:
            print('old JSON saves brought in: ' + ', '.join(f'{n} {k}' for k, n in brought.items()))
        n = conn.execute('select (select count(*) from accounts) a, (select count(*) from rooms) r').fetchone()
        print(f'{n["a"]} accounts, {n["r"]} rooms')


if __name__ == '__main__':
    main()
