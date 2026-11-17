#!/usr/bin/env bash
# One command to set up Projet Lambda on a computer (macOS with Homebrew, or Debian/Ubuntu):
#   ./setup.sh
# 1. Python 3.11 or newer, and its packages in .venv (requirements.txt);
# 2. PostgreSQL: installed and started if it is missing (Homebrew: postgresql@18; apt: postgresql);
# 3. the database (server/db.py: lambda, or LAMBDA_DB):
#    made, its tables brought up to date (db/migrations), the old JSON saves brought in once (db/setup.py).
# Running it again only does what is missing. Then: python3 web/serve.py   (http://127.0.0.1:8643/)
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1m%s\033[0m\n' "$*"; }

# 1. Python
PY=$(command -v python3 || true)
if [ -z "$PY" ] || ! "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then
  echo "Python 3.11 or newer is needed (macOS: brew install python; Ubuntu: sudo apt install python3 python3-venv)" >&2
  exit 1
fi
say "Python: $("$PY" --version)"
if [ ! -x .venv/bin/python ]; then
  "$PY" -m venv .venv
fi
.venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt
say "Python packages: ready (.venv)"

# 2. PostgreSQL
pg_ready() { .venv/bin/python -c 'import psycopg; psycopg.connect(dbname="postgres", connect_timeout=3).close()' 2>/dev/null; }
if ! pg_ready; then
  if command -v brew >/dev/null; then
    brew list postgresql@18 >/dev/null 2>&1 || { say "Installing PostgreSQL 18 (Homebrew)"; brew install postgresql@18; }
    brew services start postgresql@18 >/dev/null
    export PATH="$(brew --prefix postgresql@18)/bin:$PATH"
  elif command -v apt-get >/dev/null; then
    command -v psql >/dev/null || { say "Installing PostgreSQL (apt)"; sudo apt-get update -q && sudo apt-get install -y -q postgresql; }
    sudo service postgresql start
    # a PostgreSQL role with the name of this user, allowed to make databases
    sudo -u postgres psql -tAc "select 1 from pg_roles where rolname = '$USER'" | grep -q 1 || sudo -u postgres createuser --createdb "$USER"
  else
    echo "Install PostgreSQL and start it, then run ./setup.sh again" >&2
    exit 1
  fi
  for _ in $(seq 1 20); do pg_ready && break; sleep 0.5; done
  pg_ready || { echo "PostgreSQL does not answer" >&2; exit 1; }
fi
say "PostgreSQL: running"

# 3. the database
.venv/bin/python db/setup.py
say "Ready. Start the game: python3 web/serve.py   then open http://127.0.0.1:8643/"
