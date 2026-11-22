# PR Diff Viewer

A static page that shows a GitHub pull request (or a commit, or a compare) the way the JetBrains IDE diff does,
with the Material Darker theme, on a laptop or a phone. Deployed with the site at `https://threepipe.org/pr-viewer/`.

Open `?pr=owner/repo/123`, or paste a PR / commit / compare URL on the start page. Links keep the file:
`?pr=owner/repo/123&file=src/a.ts`; `&commit=<sha>` or `&commit=<sha1>..<sha2>` shows one commit or a range of the PR.

- **Changes**: the changed files grouped by directory (compacted, with file counts, names colored by status), and a
  full-file side-by-side diff: two editors that are not padded to line up, line numbers of both sides in the middle,
  curved connectors between matching changes, synced scrolling (`js/sbs.js`). F7 / Shift+F7 move between
  differences (on to the next file at the end), Alt+→ / Alt+← between files.
- **Settings** (gear), as in the IDE: Align Changes In Side-by-Side Diff (Monaco's padded side-by-side), Synchronize
  Scrolling, Ignore Differences (none / trim / all whitespace), Highlighting Differences (lines / words / none),
  collapse unchanged fragments and soft-wrap (unified and aligned), font size.
- **Unified viewer**: Monaco's inline diff editor (the default on narrow screens).
- **Log**: the PR's commits with a graph line and a text/hash filter; select a commit, or shift-select a range, to see
  its changed files and details; double-click, Enter or Show Diff opens it.
- **Viewed**: per-file checkboxes (V). With a token they sync with GitHub's "Viewed" (GraphQL); without one they are
  kept in this browser.

Code is highlighted by TextMate grammars through [Shiki](https://shiki.style) (`material-theme-darker`, adjusted
toward the IDE's colors) inside [Monaco](https://microsoft.github.io/monaco-editor/), both from CDNs; languages load
on demand. Diffs come from Monaco's diff algorithm (the one VS Code uses). No build step: the files here are served
as they are.

## GitHub access

Public repositories work without a token (60 API requests an hour per IP). For private repositories and a higher
limit, add a token (the lock button): a fine-grained token with *Contents: read* and *Pull requests: read and write*
(write is only for Viewed), or a classic token with `repo`. It is stored in this browser's `localStorage` and sent
only to `api.github.com`. File contents at a commit never change, so they are cached in Cache Storage.

## Develop

Serve the folder with any static server, e.g. `python3 -m http.server` in `website/public`, and open
`http://localhost:8000/pr-viewer/`.
