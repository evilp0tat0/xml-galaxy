# XML Orbitree

See any XML file as a solar system. The root element is the sun; every element's children orbit it, each on an orbit of its own (no two bodies ever share one), and each child can open its own orbits of moons. The look follows GitNexus: flat glowing dots on a near-black background, thin curved lines, violet accents. What orbits what is fixed by the file and never changes. Bodies drift on their orbits, you can drag them about, and they drift back.

No build step, no install, no network at runtime (fonts fall back to system fonts offline).

## Try it online

<https://evilp0tat0.github.io/xml-orbitree/> (published from `main` by `.github/workflows/pages.yml`).

## Run it

```bash
./serve.sh
```

Then open <http://localhost:8080/>. Any static file server works. Opening `index.html` straight from disk also works for your own files; only the bundled examples need a server.

## Use it

| Do this | To |
|---|---|
| **Open XML…**, drop a file, or paste XML anywhere | load a file (nothing leaves the browser) |
| Click a body | select it, open its own orbits, and follow it with the camera |
| Click it again | fold its orbits |
| Click a dashed circle with a number | spread a folded group (many children of one kind) into a full orbit |
| Drag a body | pull it off its orbit; its moons come with it; it drifts back when let go |
| Hover | light up the chain back to the sun, with the kind of each link |
| Type in the search box | find an element; choosing it opens every body on the way and flies there |
| Scroll / pinch, drag empty space, double-click empty space | zoom, pan, fit |
| Keys on the map: `f` fit, space pause, `+` `-` zoom, `Esc` deselect; `Ctrl K` or `/` search | |

Colours: body, line and orbit colour is the element's tag (see the colour key). Dashed cyan lines are id references (`ref`, `href`, `xlink:href="#…"`, `idref`, `…Ref`) to elements already on the map.

## Files

```
index.html          the page: layout, styles, controls
src/sources.js      turns a document into bodies and orbits, and finds id references
src/orbits.js       who orbits whom (fixed), ring sizes, and the physics of where bodies are right now
src/app.js          canvas drawing, labels, camera, hover, drag, search, side panel
samples/            S-201 Feature Catalogue 2016 draft (OpenS100), and a made-up S-201 dataset with id links
serve.sh            local static server
```

## Notes

- The bundled S-201 Feature Catalogue is the public 2016 draft (v0.0.5) from the OpenS100 project, included only as an example XML file.
- Very large files: everything is parsed, but only opened bodies are drawn; big groups start folded.
