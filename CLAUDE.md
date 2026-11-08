# Rules for working on this repo

Follow these on every task without being asked. Housekeeping is part of every change, not a
separate job. When there is a clear best practice, use it; ask the owner only about real
choices (the look, licences, removing a feature).

## The project

A static page with no build step that shows any XML file as a solar system:

- `index.html`: layout and styles
- `src/sources.js`: XML to bodies and orbits
- `src/orbits.js`: layout and physics
- `src/app.js`: drawing and interaction

`.github/workflows/pages.yml` publishes `main` to https://evilp0tat0.github.io/xml-orbitree/.

Owner decisions; keep them:

- No app name. The page is "XML viewer"; the heading and browser tab show the open file's name.
- Only the plain XML tree view. The S-100 "By meaning" view is gone for good.
- The S-201 example files stay. The OpenS100 one keeps its MPL-2.0 notice.
- The dark, GitNexus-style look.

## Every change, before it is done

1. **Branch and pull request.** Work on your branch and open a pull request into `main`.
   Once the change is verified, merge it yourself with a merge commit, unless the owner asked
   to review it first. GitHub then deletes the branch through the repository's
   "Automatically delete head branches" setting. Never leave finished work unmerged. If your work is superseded or abandoned, close
   its pull request and tell the owner the branch can go.
2. **README in step.** Describe everything a user can see or do (controls, keys, panels,
   messages, scripts) correctly in `README.md`, in the same pull request. The same goes
   for the page's own help text: the welcome panel, tooltips, the colour key and the hints.
3. **No leftovers.** When something is removed or replaced, remove all of it: code, data
   fields, CSS rules and variables, element ids, and every comment or text that mentions it.
   Search the whole repo with `git grep` before calling it done. Leave no unused functions,
   fields, parameters or CSS.
4. **Comments say what the code does now**, never its history.
5. **Verify in a browser.**
   - Run `node --check` on every file in `src/`.
   - Serve the folder and open it in headless Chromium with Playwright. Check that both
     samples load, orbits open, search works and the console shows no errors.
   - For a cleanup or refactor: record the orbit layout, labels, side panel, search results
     and colour key before and after. They must be identical.
   - When anything visible changes, look at a screenshot.
6. **Scripts in step.** `start.bat` with `serve.ps1` (Windows) and `serve.sh` (macOS,
   Linux) serve this folder on localhost only, and the README describes them.
   `.gitattributes` keeps line endings right: CRLF for `.bat` and `.ps1`, LF for `.sh`.
7. **GitHub stays tidy.** Dependabot opens pull requests when the workflows' actions have
   new versions. Check that the deploy still works with them, then merge. Leave no stray
   branches, draft pull requests or stale issues behind.
