# Rules for working on this repo

Follow these on every task without being asked. Housekeeping is part of every change, not a
separate job. When there is a clear best practice, use it; ask the owner only about real
choices (the look, licences, removing a feature).

## The project

A static page with no build step that shows any XML file as a solar system:

- `index.html`: layout, styles and controls, the welcome panel and the Display names text
- `src/sources.js`: XML to bodies and orbits
- `src/orbits.js`: layout and physics
- `src/app.js`: drawing and interaction, tooltips, colour key and messages

`.github/workflows/pages.yml` publishes `main` to https://evilp0tat0.github.io/xml-galaxy/
on every push to `main`.

Owner decisions; keep them:

- No app name, and none of the old ones (XML Orbit, XML Galaxy, XML Orbitree), although the
  repository is called xml-galaxy. The page is "XML viewer". The heading and browser tab show
  the open file's own name: its root's `<…:name>` child, else the file name.
- Only the plain XML tree view. The S-100 "By meaning" view is gone for good.
- The S-201 example files stay. The OpenS100 one is third-party (MPL-2.0): don't edit its
  content, and keep its notice comment and the README's licence note. Rules 3 and 4 don't
  apply to it.
- The dark, GitNexus-style look.

## Every change, before it is done

1. **Branch and pull request.** Work on your branch and open a pull request into `main`.
   - **When to merge.** Merge it yourself with a merge commit once every check in rule 5
     passes on the branch as it will be merged. Fetch `origin` first; if `origin/main` has
     moved, merge it into your branch and check again.
   - **After merging.** Merging publishes the live site, so check that the "Deploy to GitHub
     Pages" run for the merge succeeded.
   - **Leave it open instead**, saying why, if the owner asked to review it, if it makes one
     of the real choices above, or if a check could not run. For example, cloud sessions
     have no PowerShell, so the owner must try changes to `start.bat` or `serve.ps1` on
     Windows.
   - **Branches.** GitHub deletes a merged branch only while the repository's
     "Automatically delete head branches" setting is on. Don't change repository settings
     or delete branches yourself. If merged branches pile up, tell the owner.
2. **README and page text in step.** In the same pull request, make `README.md` match the
   app: every control, key, panel and script described, and nothing out of date. The same
   goes for the page's own text. In `index.html`: the welcome panel, the Display names text
   and button titles. In `src/app.js`: the hover tooltip (`tipHtml`), the colour key
   (`renderLegend`), the rename help (`renameForm`) and the messages (`note`, `showErr`,
   `loadSample`).
3. **No leftovers.** When something is removed or replaced, remove all of it: code, data
   fields, CSS rules and variables, element ids, and every comment or text that mentions it.
   Search the whole repo with `git grep` before calling it done. Leave no unused functions,
   fields, parameters or CSS. One exception: keep the test hooks on the last line of
   `src/app.js` (`window.XO.app` with `loadText`, `reveal` and `clickBody`). The checks in
   rule 5 use them.
4. **Comments say what the code does now**, never its history.
5. **Verify in a browser.**
   - **Syntax.** Run `for f in src/*.js; do node --check "$f" || echo "FAILED $f"; done`.
     A plain `node --check` reads only the first file it is given.
   - **Serve on localhost only.** Run `./serve.sh 8081` in the background, or use a small
     server inside your check script bound to 127.0.0.1. Never use a server that listens on
     every interface, such as a bare `python3 -m http.server`.
   - **Open it with Playwright.** Use headless Chromium with Playwright for Node. It is
     preinstalled in Claude cloud sessions; load it with `require("playwright")`. If it is
     missing, install it outside this folder, never into it (no `package.json` or
     `node_modules` here). If you can't install it, say which checks did not run and leave
     the pull request open. Keep check scripts and screenshots outside the repo.
   - **Basic check.** Both samples load, orbits open, search works, and the console shows
     no errors.
   - **Cleanups and refactors change nothing.** Run the same steps before and after in a
     Playwright context with `reducedMotion: "reduce"`, so the orbits stand still. Let the
     layout settle. Then compare the bodies (`window.XO.app.O.order`: id, label, size,
     orbit radii), the side panel, the search results and the colour key. They must be
     identical.
   - **Visible changes.** Look at a screenshot.
6. **Scripts in step.** `start.bat` with `serve.ps1` (Windows) and `serve.sh` (macOS,
   Linux) serve this folder on localhost only, and the README describes them.
   `.gitattributes` keeps line endings right: CRLF for `.bat` and `.ps1`, LF for `.sh`.
7. **GitHub stays tidy.**
   - **Dependabot.** When you start a task, look for an open Dependabot pull request. It
     updates the workflows' actions, at most once a month. The deploy runs only on `main`,
     so it can't be tried on the pull request. Read the release notes in its description
     for breaking changes, merge it, then check that the deploy succeeded and the live site
     loads. If the deploy failed, revert the merge in a new pull request and tell the owner.
   - **Your own work only.** Close your pull requests that are superseded or abandoned.
     Apart from Dependabot's, never merge or close other pull requests or issues, and never
     delete branches: other sessions may still be working on them, and anyone can open
     issues on this public repo. If some look stale, list them for the owner.
