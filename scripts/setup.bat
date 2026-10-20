@echo off
REM One-time setup for Windows. Run from the repo root: scripts\setup.bat
cd /d "%~dp0\.."
where py -3.12 >nul 2>nul || (echo Python 3.10+ is required & exit /b 1)
where node >nul 2>nul || (echo Node 18+ is required & exit /b 1)

echo ==^> Backend: creating virtualenv and installing packages
py -3.12 -m venv backend\.venv || exit /b 1
backend\.venv\Scripts\py -3.12 -m pip install -q --upgrade pip
backend\.venv\Scripts\pip install -q -r backend\requirements.txt || exit /b 1

echo ==^> Frontend: installing packages
pushd frontend
call npm install --no-audit --no-fund || exit /b 1
popd

if not exist backend\.env copy backend\.env.example backend\.env >nul
if not exist frontend\.env copy frontend\.env.example frontend\.env >nul

for /f %%K in ('backend\.venv\Scripts\py -3.12 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"') do set KEY=%%K
backend\.venv\Scripts\py -3.12 -c "import re,sys;p='backend/.env';s=open(p).read();s=re.sub(r'(?m)^TOKEN_ENCRYPTION_KEY=$','TOKEN_ENCRYPTION_KEY='+sys.argv[1],s);open(p,'w').write(s)" %KEY%

echo.
echo Setup finished. Two things left:
echo   1. Fill in backend\.env and frontend\.env with your Supabase URL and keys.
echo   2. Run database\schema.sql once in the Supabase SQL editor.
echo Then start everything with: scripts\dev.bat
