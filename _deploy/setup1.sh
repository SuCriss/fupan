#!/bin/bash
set -e
APP=/opt/fupan
echo "=== 1. clone ==="
if [ -d "$APP/.git" ]; then
  cd "$APP" && git pull --ff-only && echo updated
else
  rm -rf "$APP"
  git clone --depth=1 https://github.com/SuCriss/fupan.git "$APP"
fi
cd "$APP"
git log --oneline -1

echo
echo "=== 2. venv ==="
if [ ! -d "$APP/server/.venv" ]; then
  python3 -m venv "$APP/server/.venv"
fi
"$APP/server/.venv/bin/pip" install -q --upgrade pip
"$APP/server/.venv/bin/pip" install -q -r "$APP/server/requirements.txt"

echo
echo "=== 3. deps check ==="
"$APP/server/.venv/bin/python" --version
"$APP/server/.venv/bin/python" -c 'import fastapi, uvicorn; print("fastapi", fastapi.__version__)'

echo
echo "=== 4. data dir ==="
mkdir -p "$APP/data"
ls -ld "$APP/data"
