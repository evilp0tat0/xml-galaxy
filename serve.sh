#!/usr/bin/env sh
# Serves this folder so the page can load its examples, then prints the address.
# Only this computer can reach it (localhost), as with serve.ps1 on Windows.
PORT="${1:-8080}"
cd "$(dirname "$0")" || exit 1
echo "XML viewer: http://localhost:$PORT/"
if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server --bind 127.0.0.1 "$PORT"
elif command -v npx >/dev/null 2>&1; then exec npx --yes http-server -a 127.0.0.1 -p "$PORT" -c-1 .
else echo "Needs python3 or Node.js (npx)." >&2; exit 1; fi
