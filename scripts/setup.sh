#!/usr/bin/env bash
# One-time setup for macOS / Linux / WSL. Run from the repo root: ./scripts/setup.sh
set -e
cd "$(dirname "$0")/.."

command -v python3 >/dev/null || { echo "Python 3.10+ is required"; exit 1; }
command -v node >/dev/null || { echo "Node 18+ is required"; exit 1; }

echo "==> Backend: creating virtualenv and installing packages"
python3 -m venv backend/.venv
backend/.venv/bin/pip install -q --upgrade pip
backend/.venv/bin/pip install -q -r backend/requirements.txt

echo "==> Frontend: installing packages"
(cd frontend && npm install --no-audit --no-fund)

[ -f backend/.env ] || cp backend/.env.example backend/.env
[ -f frontend/.env ] || cp frontend/.env.example frontend/.env

KEY=$(backend/.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
if grep -q '^TOKEN_ENCRYPTION_KEY=$' backend/.env; then
  sed -i.bak "s|^TOKEN_ENCRYPTION_KEY=$|TOKEN_ENCRYPTION_KEY=$KEY|" backend/.env && rm -f backend/.env.bak
  echo "==> Generated TOKEN_ENCRYPTION_KEY in backend/.env"
fi

cat <<MSG

Setup finished. Two things left:
  1. Fill in backend/.env and frontend/.env with your Supabase URL and keys.
  2. Run database/schema.sql once in the Supabase SQL editor.
Then start everything with: ./scripts/dev.sh
MSG
