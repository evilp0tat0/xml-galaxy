# Changelog

## 2.0.0

- Removed the S-100 Feature Catalogue view ("By meaning"), its "Make it the centre" action and the view switch; every file now opens as a plain XML tree. Removed at the owner's request, without the two-version notice of RULES.md rule 8.
- Replaced the S-201 examples with three generic ones: a solar system (nested moons, missions linked by id), a library (books, authors, loans, one deliberately broken reference) and an SVG drawing (shapes reused with `<use href>`).
- Attributes whose names end in `Refs` (for example `targetRefs`) are now read as id references.
- The smoke test checks the new examples.
- Finding an element that has no open moons zooms only far enough to see it among its neighbours, not until it fills the screen.

## 1.1.0

- Added `RULES.md`, the engineering rules every change follows, and `CLAUDE.md` pointing to them.
- Added `tools/smoke.mjs`, a headless-browser smoke test, and `docs/DEVELOPING.md`.
- The version is shown in the status line; `README.md` is now for users only.

## 1.0.0

- Renamed from XML Orbit to XML Galaxy.
- Fixed 28 issues found in review: bounded deep files, no duplicate bodies, ring spacing by size, namespaced tags, own-id labels, broken references listed, full-precision drawing, follow camera, phone layout, input handling.
- First version: any XML file as a solar system with fixed orbits; S-100 Feature Catalogues also orbit by meaning.
