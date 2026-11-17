-- The accounts, their logins, the rooms (the worlds of Don't Starve Together: a name, an owner, a code to join), the
-- player of each account in each room, and the admin settings. server/db.py reads and writes them; db/setup.py applies
-- this file once (table schema_migrations).

-- an account: the password as a salted PBKDF2-SHA256 hash (200 000 rounds, hex), never the password itself
create table accounts (
  id            bigserial primary key,
  username      text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  password_hash text not null,
  salt          text not null,
  admin         boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index accounts_username_key on accounts (lower(username));

-- a browser logged in: the token of its cookie
create table sessions (
  token      text primary key,
  account_id bigint not null references accounts on delete cascade,
  created_at timestamptz not null default now()
);
create index sessions_account_idx on sessions (account_id);

-- a room: its code (in the link, ?room=<id>), its name and the account that made it
create table rooms (
  id          text primary key check (id ~ '^[a-z0-9]{8}$'),
  title       text not null,
  owner_id    bigint references accounts on delete set null,
  created_at  timestamptz not null default now(),
  last_played timestamptz not null default now()
);

-- the player of an account in a room: a row as soon as it joins (the room is then in its list), its game once it
-- has played (world null before): where it is, its stats, HP, MP, skills, bag, outfit and quests
create table room_players (
  room_id    text not null references rooms on delete cascade,
  account_id bigint not null references accounts on delete cascade,
  world      text,
  x          double precision,
  z          double precision,
  stats      jsonb,
  level      integer generated always as ((stats ->> 'level')::integer) stored,
  hp         double precision,
  mp         double precision,
  skills     jsonb,
  bag        jsonb,
  outfit     jsonb,
  quests     jsonb,
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, account_id)
);
create index room_players_account_idx on room_players (account_id);

-- the admin settings: 'admin' (look, speeds, outfit, stats of the admin menu) and 'monsters' (the changed monster types)
create table settings (
  name       text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
