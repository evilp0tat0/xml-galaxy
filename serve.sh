#!/usr/bin/env sh
# Serves this folder so the page can load its examples, then prints the address.
PORT="${1:-8080}"
cd "$(dirname "$0")" || exit 1
echo "XML Galaxy: http://localhost:$PORT/"
if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then exec npx --yes http-server -p "$PORT" -c-1 .
else echo "Needs python3 or Node.js (npx)." >&2; exit 1; fi
