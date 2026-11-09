# Rules for working on this repo

Follow these on every task without being asked. Housekeeping is part of every change, not a
separate job. When there is a clear best practice, use it; ask the owner only about real
choices (the look, licences, removing a feature).

## The project

A static page with no build step that shows any XML file as a solar system:

- `index.html`: layout, styles and controls, the welcome panel and the Display names text
- `src/explain.js`: plain-words helpers, the built-in glossary, and dictionaries (the terms an XML
  document defines)
- `src/sources.js`: XML to bodies and orbits, and the explanation of each element
- `src/orbits.js`: layout and physics
- `src/app.js`: drawing and interaction, tooltips, colour key, dictionary loading and messages

`.github/workflows/pages.yml` publishes `main` to https://evilp0tat0.github.io/xml-orbitree/
on every push to `main`.

Owner decisions; keep them:

- The project is XML Orbitree, like the repository (`xml-orbitree`). The top bar shows that
  name and, beside it, the open file's own name: its root's `<…:name>` child, else the file
  name. The browser tab shows both. The project had other names before; they were removed
  from the whole history, so never write them anywhere, not even as history.
- Only the plain XML tree view. The S-100 "By meaning" view is gone for good.
- The S-201 example files stay. The OpenS100 one is third-party (MPL-2.0): don't edit its
  content, and keep its notice comment and the README's licence note. Rules 3 and 4 don't
  apply to it.
- The dark, GitNexus-style look.

## Every change, before it is done

1. **Branch, pull request and merge, all without being asked.** Work on your branch, open
   a pull request into `main` as soon as your first commit is pushed, and merge it
   yourself. Never leave a pull request open for the owner, and never ask whether to
   merge: the owner has decided that pull requests and merges are automatic.
   - **When to merge.** Merge with a merge commit once every check in rule 5 passes on the
     branch as it will be merged. Fetch `origin` first; if `origin/main` has moved, merge it
     into your branch and check again. If a check cannot run in your session (cloud
     sessions have no PowerShell, so changes to `start.bat` or `serve.ps1` can't be tried
     there), merge anyway and say exactly what was not tried, in the pull request and in
     your last message.
   - **Real choices** (the look, licences, removing a feature) are asked about in chat
     before the work is done, never by leaving a pull request open.
   - **After merging.** Merging publishes the live site, so check that the "Deploy to GitHub
     Pages" run for the merge succeeded, then delete your branch (rule 7).
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
     `node_modules` here). If you can't install it, say which checks did not run, in the
     pull request and in your last message (rule 1). Keep check scripts and screenshots
     outside the repo.
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
7. **GitHub stays clean, all the time.** Look at the repository's open pull requests and
   its branches when you start a task and again before you finish, and leave nothing
   behind that is finished with.
   - **Dependabot.** It updates the workflows' actions, at most once a month. The deploy
     runs only on `main`, so it can't be tried on the pull request. Read the release notes
     in its description for breaking changes, merge it, then check that the deploy
     succeeded and the live site loads. If the deploy failed, revert the merge in a new
     pull request and tell the owner.
   - **Your own work.** Delete your branch once its pull request is merged (GitHub does it
     by itself only while the repository's "Automatically delete head branches" setting is
     on). Close your pull requests that are superseded or abandoned, and delete their
     branches.
   - **Everyone else's.** Delete every branch whose pull request is merged or closed, and
     every branch with no pull request whose commits are all in `main`. Never merge or
     close another session's open pull request, and never delete a branch that has one or
     that holds commits not in `main`: another session may still be working on it. List
     for the owner the open pull requests and the unmerged branches that have had no
     commits for a week, and any issues that look stale (anyone can open issues on this
     public repo).
   - **If a branch can't be deleted** from your session (a permission is refused), say so
     and name the branches, so the owner can delete them or turn the setting above on.
   - **Nothing but the app in the repository.** Check scripts, screenshots, logs,
     `package.json`, `node_modules` and scratch files are never committed; rule 5 keeps
     them outside this folder.
