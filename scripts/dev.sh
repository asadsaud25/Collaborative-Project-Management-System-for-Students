#!/usr/bin/env bash
# Starts API (http://localhost:8000) and web app (http://localhost:5173). Ctrl+C stops both.
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT
(cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000) &
(cd frontend && npm run dev -- --host localhost) &
wait
