# XML viewer

See any XML file as a solar system. The root element is the sun; every element's children orbit it, each on an orbit of its own (no two bodies ever share one), and each child can open its own orbits of moons. The look follows GitNexus: flat glowing dots on a near-black background, thin curved lines, violet accents. What orbits what is fixed by the file and never changes. Bodies drift on their orbits, you can drag them about, and they drift back.

A file opens as one circle: its root element, named after the file (the root's `<…:name>` child, such as `Aids to Navigation(AtoN) Information`, or else the file name). The number inside each circle is how many direct child elements it has. A circle's size follows the same count on a 1–100 scale: the element with the most direct children in the file is 100, an element with none is 1, and the scale is the same at every depth (the side panel shows each element's size). Hover the centre to see the file's header fields (scope, version, date, product, producer …); the root element's tag is shown at the top of the page.

No build step, no install. Apart from its own files, the page fetches only two Google Fonts (Exo 2, Orbitron); offline it uses system fonts instead. Your XML never leaves the browser.

## Try it online

<https://evilp0tat0.github.io/xml-orbitree/>

`.github/workflows/pages.yml` publishes it to GitHub Pages on every push to `main`.

## Run it

```bash
./serve.sh
```

Then open <http://localhost:8080/>. It needs python3 (or Node.js, for npx). If port 8080 is taken, pass another one, such as `./serve.sh 8081`, and open that port instead.

On Windows, double-click **`start.bat`**. It starts a small local server with the PowerShell that comes with Windows (nothing to install) and opens the app in your browser. Keep its window open while you use the app; close it to stop. If the server cannot start, it opens `index.html` straight from disk instead. Any static file server works. Opening `index.html` straight from disk also works for your own files; only the bundled examples need a server.

## Use it

| Do this | To |
|---|---|
| **Open XML**, drop a file, or paste XML anywhere | load a file (nothing leaves the browser) |
| **Examples** menu | open one of the bundled example files |
| Hover the centre | see the file's header fields (scope, version, date, product, producer …) |
| Click a body (the centre too) | centre it (the camera follows it) and open the side panel: its path from the root, text, attributes, child tags, id links both ways, broken references, and a box to rename its tag. Click a step of the path or a link to go there |
| Click it again | show all its child elements, spread out; once more to fold them |
| Click a dashed circle with a number | spread a folded group: the number is how many children of one kind it holds, and each gets an orbit of its own |
| Drag a body | pull it off its orbit; its moons come with it; it drifts back when let go |
| Hover | light up the chain back to the sun, with the kind of each link |
| Type in the search box | find an element; choosing it opens every body on the way and flies there |
| **Display names** box | type the parts of the name you don't want to see (for example `S100FC: S100_FC_`; separate several with spaces or commas) and press **Hide**: they are taken out of every name, so `S100FC:S100_FC_SimpleAttributes` shows as `SimpleAttributes`. Hidden parts show as chips; × shows a part again. Or select an element and rename its tag. Only the display changes, never the file; choices are remembered in this browser |
| Scroll / pinch, drag empty space, double-click empty space | zoom, pan, fit |
| Buttons at the bottom right | zoom in, zoom out, fit, fold every orbit back into one circle, pause or play the orbits |
| Keys on the map | `f` fit, space pause, `+` `-` zoom, `Esc` deselect, `Enter` show or fold the selected body's child elements; `Ctrl K` (`⌘K` on a Mac) or `/` search |

Colours: body, line and orbit colour is the element's tag (see the colour key). Every tag name gets its own colour: a high-contrast set first, then more colours picked to be as different as possible from all the others. Dashed cyan lines are id references (`ref`, `href`, `xlink:href="#…"`, `idref`, `…Ref`) to elements already on the map.

## Files

```
index.html          the page: layout, styles, controls
src/sources.js      turns a document into bodies and orbits, and finds id references
src/orbits.js       who orbits whom (fixed), ring sizes, and the physics of where bodies are right now
src/app.js          canvas drawing, labels, camera, hover, drag, search, side panel
samples/            S-201 Feature Catalogue 2016 draft (OpenS100), and a made-up S-201 dataset with id links
serve.sh            local static server (macOS, Linux)
start.bat           double-click on Windows: runs serve.ps1 and opens the app
serve.ps1           local static server in PowerShell (used by start.bat)
```

## Notes

- The bundled S-201 Feature Catalogue is `ProgramData/FC/S-201_FC.xml` from [OpenS100](https://github.com/S-100ExpertTeam/OpenS100), the public 2016 draft (v0.0.5), converted to UTF-8. It is under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/) and included only as an example XML file.
- Very large files: everything is parsed, but only the centre and the children of opened bodies are drawn. Opening a body shows all of its children, which gets slow with many thousands of them. A search opens only the bodies on the way; other big groups of children beside that path start folded.
