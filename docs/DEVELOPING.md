# Developing XML Galaxy

The rules for every change are in [RULES.md](../RULES.md). This page covers how the code is laid out and how to check a change.

## Layout

```
index.html          the page: layout, styles, controls
src/fc-model.js     reads S-100 Feature Catalogues and the links between their types (an optional view)
src/sources.js      turns a document into bodies and orbits: the plain XML tree, or catalogue meaning
src/orbits.js       who orbits whom (fixed), ring sizes, and the physics of where bodies are right now
src/app.js          canvas drawing, labels, camera, hover, drag, search, side panel; VERSION lives here
samples/            example files used by the Examples menu and the smoke test
tools/smoke.mjs     the smoke test (rule 14)
serve.sh            local static server
```

Scripts are plain browser scripts loaded in order by `index.html`; each adds to the `window.XO` namespace. There is no build step.

### How the pieces talk

A **source** (`src/sources.js`) answers questions about a document: `node(id)`, `groups(id)` (what orbits a body, one group per kind), `refs(id)` (dashed cross links), `info(id)` (side panel), `search(q)` and `pathTo(id)`. The plain-XML source and the catalogue source answer the same questions, so the engine and the drawing never need to know which one they have.

The **engine** (`src/orbits.js`) builds the bodies breadth-first from the centre: each item appears once, with the body nearest the centre; other links to it become dashed lines. Big groups fold into one numbered body. Each level is drawn at half the scale of the one above, so deep files stay bounded. `step()` moves bodies toward their place on their parent's orbit; dragged bodies are left where the pointer puts them.

The **app** (`src/app.js`) draws in screen pixels worked out in full precision (the canvas's own transform loses precision at the zoom needed for deep moons), places labels most-important first and skips any that would overlap, and keeps the selected body centred.

## Checking a change

```bash
node tools/smoke.mjs
```

It serves the folder, opens the page in headless Chromium, and checks loading, references, open and fold, unique bodies, dragging, deep files, namespaces, broken references, malformed input, HTML injection, determinism, phone width and console errors. It needs Playwright (`npm i -g playwright && npx playwright install chromium`). Every change also gets a look in a real browser (`./serve.sh`).

When a change ships: bump `VERSION` in `src/app.js` and add a matching entry at the top of `CHANGELOG.md` (the smoke test checks they agree).
