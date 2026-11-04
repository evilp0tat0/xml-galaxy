# XML Galaxy: notes for Claude

Follow the engineering rules in [RULES.md](RULES.md) for every change. They are the only copy; do not restate them here.

- How the code is laid out and how to verify a change: [docs/DEVELOPING.md](docs/DEVELOPING.md).
- Before calling a change done, run `node tools/smoke.mjs` (rule 14) and bump `VERSION` in `src/app.js` with a matching `CHANGELOG.md` entry (rules 16, 20).
- XML Galaxy is a general XML tool. Keep it independent of any one standard or domain: format-specific views are optional extras on top of the plain-XML view, never the other way round.
