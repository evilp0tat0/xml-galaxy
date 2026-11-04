# Engineering rules

These rules govern every change to XML Galaxy. They are not tied to any standard or domain; they work for any project. This file is their only home: other documents point here instead of repeating them.

## Facts and sources

**1. Primary sources are the facts.**
Behaviour that depends on a published specification (XML 1.0, Namespaces in XML, XPath, XLink, or the format of a file being shown) is checked against that specification *before* the code is written, and the code carries a note naming the section it rests on. Notes, comments, blog posts and memory describe; they do not decide.

**2. Zero fabrications.**
Nothing ships that the source does not say: no invented element or attribute names, no made-up section numbers, no guessed defaults presented as rules. If a claim cannot be traced to a source, it does not ship.

**3. The file's own words, verbatim.**
Tag names, attribute names, values, namespace prefixes and text are shown exactly as they appear in the file: no renaming, no "friendly" synonyms, no case changes. A label may add context around the file's words, never replace them.

## The user's data

**4. Data custody.**
XML Galaxy reads files; it never changes them. Anything that leaves the tool (a copy, an export, a download) is byte-identical to the input, or goes through a transform the user chose and is told about. Read-only actions are byte-neutral.

**5. No silent passes, no silent drops.**
Every check asserts that a thing is present before it judges whether it is valid; an empty value must never pass by being empty. Anything the tool does not show (folded groups, unresolved references, skipped content) is counted and said, never quietly left out.

**6. One source of truth.**
The parsed document and the orbit model are the state. The canvas, the side panel and the legend are views of that state; nothing is stored only in the DOM or only on screen.

**7. Determinism.**
The same file gives the same model, the same orbits and the same labels every time. No randomness, clock or network in parsing, layout or checks. Decoration (the star field) is the only exception, and it never touches the data.

**8. Backward compatibility.**
A file, link or setting that worked in one version keeps working in the next. A renamed or moved behaviour keeps a fallback path until two major versions have announced its removal.

## Quality

**9. Best outcome.**
A solution that does not follow good practice is not acceptable. Time and effort are not reasons to ship the weaker one.

**10. Messages teach.**
Every message to the user says what happened, why, and what to do next. "Invalid", "error" or "failed" alone is not a message.

**11. Data before prose.**
Findings and reports carry their facts as structured fields (what was found, what was expected, where). The sentence shown to the user is built from those fields, not the other way round.

**12. Notes on every line of code.**
Every line written or changed carries a note that explains it from its author's point of view: what it is for, why it is done this way (the decision, the constraint, the alternative ruled out) and what it rests on. A function opens with a note on its purpose, inputs, result and effects; each step inside it, at most six lines, is headed by a note. Notes are plain language for a teammate, stay true to the code beside them, and carry no history. Code written before this rule is not retrofitted, but any line a change touches is brought up to it.

## Process

**13. Say how it will be verified, first.**
Before starting any piece of work, state how it will be checked: which test, which assertion, which file and invariant. If something cannot be verified here, say so up front so the decision to go ahead is made knowingly.

**14. Not done until verified.**
No change is done until the smoke test (`node tools/smoke.mjs`, see [docs/DEVELOPING.md](docs/DEVELOPING.md)) passes with zero errors and the change has been seen working in a real browser.

**15. Review big changes before and after.**
A change that spans several features or subsystems gets independent reviews of the plan before code and of the result after it, each finding reproduced before it is acted on, and a check that earlier fixes are still intact.

**16. Atomic delivery.**
Code, version number, changelog, documentation and tests ship together as one unit. "I'll do it later" is not allowed.

**17. Keep documents in step.**
A change that alters anything a user or developer can observe updates every document and code note that describes it, in the same change.

**18. One role per document, kept short.**

- `README.md` is for people using the tool: what it is and how to use it.
- `docs/DEVELOPING.md` is for people changing it: how the code is laid out and how to verify a change.
- `CHANGELOG.md` holds facts only: what changed in each version. No conversation, no recaps.
- `RULES.md` (this file) holds the rules.

**19. Single source, or a gate.**
A fact that appears in more than one place (a count, a version, a file list, a line number) is either kept in exactly one place that the others point to, or every copy is checked by an automated test. Unchecked duplicates are not allowed; when in doubt, delete the copy and point to the source.

**20. Version every change.**
`VERSION` in `src/app.js` changes with every change that ships, using semantic versioning: MAJOR when a file that used to open no longer does, or a link or setting stops working; MINOR for new features or views; PATCH for fixes. The changelog entry carries the same number.

**21. The working copy tracks main.**
Work happens on a branch, lands on `main` through a reviewed pull request once the smoke test passes, and the local `main` is fast-forwarded to the remote in the same step. A change is not landed until local `main` equals remote `main`.
