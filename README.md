# XML Orbitree

See any XML file as a solar system. The root element is the sun; every element's children orbit it, each on an orbit of its own (no two bodies ever share one), and each child can open its own orbits of moons. The look follows GitNexus: flat glowing dots on a near-black background, thin curved lines, violet accents. What orbits what is fixed by the file and never changes. Bodies drift on their orbits, you can drag them about, and they drift back.

That is the **Orbit view**. The **Tree view** shows the same elements as a tree: the root element at the bottom, and each open element's children fanned out above it. The lines are branches, not straight lines: a branch leaves its parent leaning outward, turns upward and comes to its child from below, and how sharply it turns, where along its length, and how long it is are its own (always the same for the same element, so the tree does not change from one look to the next). Where many children crowd together their branches differ less and run side by side, and those nearest the middle are close to straight. An only child's branch sways, left and right at alternate levels, so a chain of them climbs like a stem. Every branch rises at between 45° and 135° all the way along. Branches are thickest at the root, thinner at each level up, and thinner in their upper half than their lower. Each child's whole subtree has a column of its own, so branches never cross. Switch between the two in the top bar; what is open and what is selected stay as they are, and the choice is remembered in this browser.

A file opens as one circle: its root element, named after the file (the root's `<…:name>` child, such as `Aids to Navigation(AtoN) Information`, or else the file name). That name also appears in the top bar, beside the XML Orbitree name, and in the browser tab. The number inside each circle is how many direct child elements it has. A circle's size follows the same count on a 1–100 scale: the element with the most direct children in the file is 100, an element with none is 1, and the scale is the same at every depth (the side panel shows each element's size). Hover the centre to see the file's header fields (scope, version, date, product, producer …); the root element's tag is shown at the top of the page.

It also explains. The side panel says in plain words what the selected element is (a list of 7 `<BuoyLateral>` elements, a link, a field holding a number, a container with 8 parts …) and, when its name is defined somewhere, shows the definition: from the file itself when it is a dictionary (a feature catalogue, an XML Schema), or from one you open beside it. See [Explanations](#explanations).

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
| **Examples** menu | open one of the bundled example files; the dataset opens with the catalogue as its dictionary |
| Hover the centre | see the file's header fields (scope, version, date, product, producer …) |
| **Orbit view** / **Tree view** in the top bar | show the file as orbits round the root, or as a tree growing up from it; the status bar names the view |
| Click a body (the centre too) | centre it (the camera follows it) and open the side panel: its path from the root, **What this is** (see below), text, attributes (each with what its name means, when known), child tags, id links both ways, references whose code a dictionary defines (**Defined in a dictionary**), broken references, and a box to rename its tag. Click a step of the path or a link to go there |
| **What this is** box | what the element is, in plain words, built from the file's structure; then its definition when its name is defined, with where it comes from (this file, or a dictionary by name), its aliases and facts such as its value type or unit; for a value, which listed value it is (`Red` → `red`, code 3) or that it is none of them, with the listed values and what they mean; and a **Go to the definition** chip when the definition is in this file. When nothing defines the name, a link to open a dictionary |
| **Open a schema or catalogue that defines it…** (in the What this is box) | open another XML file as a dictionary: a feature catalogue, an XML Schema (`.xsd`), any file whose elements have a code or name with a definition. Several can be open; the one opened last is asked first. They stay open when you open another file |
| **Dictionary** pill in the top bar | the open dictionaries (hover for their sizes); × closes them all |
| Hover a body | light up the chain back to the sun, with the kind of each link; the tooltip shows the first sentence of the definition |
| Click it again | show all its child elements, spread out (in the Tree view: above it, on branches that curve upward); once more to fold them |
| Click a dashed circle with a number | spread a folded group: the number is how many children of one kind it holds, and each gets an orbit of its own |
| Drag a body | pull it off its orbit (or its place in the tree); its moons come with it; it drifts back when let go |
| Type in the search box | find an element by its tag, name, key or attribute values, or by what a dictionary calls it (`Buoy, lateral`, `lateral buoy` or the alias `BOYLAT` find `<BuoyLateral>`); each result shows the definition's first sentence. Choosing one opens every body on the way and flies there |
| **Display names** box | type the parts of the name you don't want to see (for example `S100FC: S100_FC_`; separate several with spaces or commas) and press **Hide**: they are taken out of every name, so `S100FC:S100_FC_SimpleAttributes` shows as `SimpleAttributes`. Hidden parts show as chips; × shows a part again. Or select an element and rename its tag. Only the display changes, never the file; choices are remembered in this browser |
| Scroll / pinch, drag empty space, double-click empty space | zoom, pan, fit |
| Buttons at the bottom right | zoom in, zoom out, fit, show every orbit at once (every element in the file), fold every orbit back into one circle, pause or play the orbits (Orbit view only: nothing turns in the tree) |
| Keys on the map | `f` fit, space pause (Orbit view), `+` `-` zoom, `Esc` deselect, `Enter` show or fold the selected body's child elements, `a` show every orbit, `c` fold every orbit; `Ctrl K` (`⌘K` on a Mac) or `/` search |

Colours: body, line and orbit colour is the element's tag (see the colour key). Every tag name gets its own colour: a high-contrast set first, then more colours picked to be as different as possible from all the others. Dashed cyan lines are id references (`ref`, `href`, `xlink:href="#…"`, `idref`, `…Ref`) to elements already on the map.

## Explanations

Every element gets a **What this is** text, from four sources, all inside the browser:

1. **The structure**, for every element: the root (how many children, of how many kinds, and which schema the file names in `xsi:schemaLocation`), a list (`A list of 7 <BuoyLateral> elements`), a link (`A link: it points at Topmark · TM.001`, or `A link to “X”, which is not in this file`), a field (`A field: holds the value “4.1”, a number`; dates, yes/no, web addresses and coordinates are named too), a container (`A container with 8 parts: <featureName>, <AtoNNumber>, …`), then its name, its id and how many elements point at it, and its place among siblings of the same tag.
2. **Definitions in the file itself.** A file is a dictionary when its elements have a term (a `<code>` or `<name>` child, or a `name`, `code`, `id` or `value` attribute) together with a definition (a `<definition>`, `<description>`, `<documentation>`, `<remarks>` … child, or one a wrapper down, as in `xs:annotation/xs:documentation`), or with values that have one (an `xs:simpleType` whose `xs:enumeration`s are documented). A feature catalogue and an XML Schema both are; the root element itself is never a term. Terms are matched as written first, then ignoring case, so a catalogue's `NavigationLine` (a feature type) and `navigationLine` (a role) stay apart. The root says so (`This file is a dictionary: it defines 173 terms (112 simple attributes, 41 feature types …)`, the eight most numerous kinds); clicking a definition says what it defines; a reference such as `<attribute ref="beaconShape"/>` becomes a link to the definition instead of a broken reference; a permitted `<value>3</value>` is read against the listed values of the attribute it belongs to, while the bounds of a multiplicity (`<lower>`, `<upper>`, `minOccurs`) are counts and never read as values.
3. **Dictionaries you open** beside the file (the link in the What this is box). Their definitions explain the file's tags by local name, its reference attributes by code, its attribute names (an `xs:attribute`), and its short values by the listed values of the tag's entry or of the type its `type` names (an `xs:element type="colourType"` → the `xs:simpleType` colourType enumerations). A reference whose code a dictionary defines (`ref="beaconShape"`) is listed under **Defined in a dictionary** instead of as a broken reference. The bundled dataset example opens with the bundled catalogue as its dictionary.
4. **A small built-in glossary** of universal names: `xmlns`, `xsi:schemaLocation`, `xsi:type`, `xsi:nil`, `xml:lang`, ids, `xlink:href` and the other XLink attributes, `ref`/`idref`, `srsName`, `srsDimension`, `uom`, `codeSpace`, and GML's `gml:pos`, `gml:posList`, `gml:Point`, `gml:LineString`, `gml:Polygon`, `gml:Envelope`, `gml:name` … It never guesses at a file's own vocabulary; that is what dictionaries are for.

Nothing is fetched and nothing leaves the browser: a dictionary is a file you opened (or a bundled example).

## Files

```
index.html          the page: layout, styles, controls
src/explain.js      plain-words helpers, the built-in glossary, and dictionaries: the terms any XML document defines
src/sources.js      turns a document into bodies and orbits, finds id references, and explains each element
src/orbits.js       who orbits whom (fixed), ring sizes or the tree's branch places, and the physics of where bodies are right now
src/app.js          canvas drawing, labels, camera, the view switch, hover, drag, search, side panel, dictionary loading
samples/            S-201 Feature Catalogue 2016 draft (OpenS100), and a made-up S-201 dataset with id links
serve.sh            local static server (macOS, Linux)
start.bat           double-click on Windows: runs serve.ps1 and opens the app
serve.ps1           local static server in PowerShell (used by start.bat)
```

## Notes

- The bundled S-201 Feature Catalogue is `ProgramData/FC/S-201_FC.xml` from [OpenS100](https://github.com/S-100ExpertTeam/OpenS100), the public 2016 draft (v0.0.5), converted to UTF-8. It is under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/) and included only as an example XML file.
- Very large files: everything is parsed, but only the centre and the children of opened bodies are drawn. Opening a body shows all of its children, which gets slow with many thousands of them, and showing every orbit at once draws the whole file. A search opens only the bodies on the way; other big groups of children beside that path start folded.
