@echo off
REM Opens two windows: API on http://localhost:8000 and web app on http://localhost:5173
cd /d "%~dp0\.."
start "CPMS API" cmd /k "cd backend && .venv\Scripts\uvicorn app.main:app --reload --port 8000"
start "CPMS Web" cmd /k "cd frontend && npm run dev -- --host localhost"
echo Both servers are starting. Open http://localhost:5173
