# XML Galaxy

See any XML file as a solar system. The root element is the sun; every element's children orbit it, each on an orbit of its own (no two bodies ever share one), and each child can open its own orbits of moons. The look follows GitNexus: flat glowing dots on a near-black background, thin curved lines, violet accents. What orbits what is fixed by the file and never changes. Bodies drift on their orbits, you can drag them about, and they drift back.

A file opens as one circle: its root element, named after the file (the root's `<…:name>` child, such as `Aids to Navigation(AtoN) Information`, or else the file name). The number inside each circle is how many direct child elements it has. A circle's size follows the same count on a 1–100 scale: the element with the most direct children in the file is 100, an element with none is 1, and the scale is the same at every depth (the side panel shows each element's size). Hover the centre to see the file's header fields (scope, version, date, product, producer …); the root element's tag is shown at the top of the page.

S-100 Feature Catalogues (such as the IALA S-201 `201_Feature_Catalogue_2.0.0.xml`) get a second view, **By meaning**, where types orbit by how they relate: inheritance, feature links, information links, links in, associations and roles, attributes and allowed values.

No build step, no install, no network at runtime (fonts fall back to system fonts offline).

## Try it online

<https://evilp0tat0.github.io/xml-galaxy/> (published from `main` by `.github/workflows/pages.yml`).

## Run it

```bash
./serve.sh
```

Then open <http://localhost:8080/>. Any static file server works. Opening `index.html` straight from disk also works for your own files; only the bundled examples need a server.

## Use it

| Do this | To |
|---|---|
| **Open XML…**, drop a file, or paste XML anywhere | load a file (nothing leaves the browser) |
| Hover the centre | see the file's header fields (scope, version, date, product, producer …) |
| Click a body (the centre too) | centre it (the camera follows it) |
| Click it again | show all its child elements, spread out; once more to fold them |
| Click a dashed circle with a number | spread a folded group (many children of one kind) into a full orbit |
| Drag a body | pull it off its orbit; its moons come with it; it drifts back when let go |
| Hover | light up the chain back to the sun, with the kind of each link |
| Type in the search box | find an element or type; choosing it opens every body on the way and flies there |
| **Make it the centre** (catalogues) | start the map from another type |
| **Display names** box | show tags in full (`S100FC:S100_FC_DefinitionSources`), shorter (`FC_DefinitionSources`) or shortest (`DefinitionSources`); or select an element and rename its tag. Only the display changes, never the file; choices are remembered in this browser |
| Scroll / pinch, drag empty space, double-click empty space | zoom, pan, fit |
| Keys on the map: `f` fit, space pause, `+` `-` zoom, `Esc` deselect; `Ctrl K` or `/` search | |

Colours:

- **Plain XML**: body, line and orbit colour is the element's tag (see the colour key). Every tag name gets its own colour: a high-contrast set first, then more colours picked to be as different as possible from all the others. Dashed cyan lines are id references (`ref`, `href`, `xlink:href="#…"`, `idref`, `…Ref`) to elements already on the map.
- **Catalogue view**: body colour is what the item is (feature type, information type, association, role, attribute); line and orbit colour is how it links to the body it circles. Dashed lines join a body to something it also links to elsewhere on the map; each item appears once, with the body nearest the sun.

## Files

```
index.html          the page: layout, styles, controls
src/fc-model.js     reads S-100 Feature Catalogues (types, bindings, attributes, values) and the links between them
src/sources.js      turns a document into bodies and orbits: plain XML tree, or catalogue meaning
src/orbits.js       who orbits whom (fixed), ring sizes, and the physics of where bodies are right now
src/app.js          canvas drawing, labels, camera, hover, drag, search, side panel
samples/            S-201 Feature Catalogue 2016 draft (OpenS100), and a made-up S-201 dataset with id links
serve.sh            local static server
```

## Notes

- The bundled catalogue is the public 2016 draft (v0.0.5) from the OpenS100 project, used as an example only. Load the current edition from the IHO Geospatial Information Registry for real work.
- Very large files: everything is parsed, but only opened bodies are drawn; big groups start folded.
