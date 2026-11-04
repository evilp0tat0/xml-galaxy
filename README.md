# XML Galaxy

See any XML file as a solar system. The root element is the sun; every element's children orbit it, and each child can open its own orbits of moons. What orbits what is fixed by the file and never changes. Bodies drift on their orbits, you can drag them about, and they drift back.

No build step, no install, no network at runtime (fonts fall back to system fonts offline).

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
| Type in the search box | find an element by tag, name, id or attribute value; choosing it opens every body on the way and flies there |
| Scroll / pinch, drag empty space, double-click empty space | zoom, pan, fit |
| Keys on the map: `f` fit, space pause, `+` `-` zoom, `Esc` deselect | |

Colours: body, line and orbit colour is the element's tag (see the colour key). Dashed white lines are id references (`ref`, `href`, `xlink:href="#…"`, `idref`, `idrefs`, names ending in `Ref` or `Refs`) to elements already on the map. References to ids that are not in the file are listed in the side panel as broken.

## Notes

- The **Examples** menu has a solar system, a small library (with one deliberately broken link) and an SVG drawing.
- Very large files: everything is parsed, but only opened bodies are drawn; big groups start folded.

Changing the code? See [docs/DEVELOPING.md](docs/DEVELOPING.md) and the engineering rules in [RULES.md](RULES.md).
