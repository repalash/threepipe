# PR Diff Viewer

A static page that shows a GitHub pull request (or a commit, or a compare) the way the JetBrains IDE diff does,
with the Material Darker theme, on a laptop or a phone. Deployed with the site at `https://threepipe.org/pr-viewer/`.

Open `?pr=owner/repo/123`, or paste a PR / commit / compare URL on the start page. Links keep the file:
`?pr=owner/repo/123&file=src/a.ts`; `&commit=<sha>` or `&commit=<sha1>..<sha2>` shows one commit or a range of the PR.

- **Changes**: the changed files grouped by directory (compacted, with file counts, names colored by status), and a
  full-file side-by-side diff: two editors that are not padded to line up, line numbers of both sides in the middle,
  curved connectors between matching changes, synced scrolling (`js/sbs.js`). F7 / Shift+F7 move between
  differences (on to the next file at the end), Alt+→ / Alt+← between files, Ctrl/⌘ + = / − / 0 the editor font.
- **Settings**: the titlebar gear holds the app's settings (theme, editor font, GitHub token, open another PR); the
  diff toolbar's gear holds the diff's own, as in the IDE: Align Changes In Side-by-Side Diff (Monaco's padded side-by-side), Synchronize
  Scrolling, Ignore Differences (none / trim / all whitespace), Highlighting Differences (lines / words / none),
  collapse unchanged fragments and soft-wrap (unified and aligned), font size.
- **PR view** (as in the IDE's Pull Requests tool window): the PR title and "Changes from N commits ▾" (searchable)
  over the tree, a blue dot on each file until it is viewed, and the repository's pull requests (the project badge or
  the strip) with a search and an Open / Closed / Merged / All filter. Added and deleted files show as one editor.
- **Search Everywhere** (double Shift, or the search button): the changed files, every action and setting (toggles
  show ON/OFF), the commits, and on its tab the repository's pull requests. Ctrl/⌘+Shift+A opens it on Actions,
  Ctrl/⌘+P on Files. Fuzzy matching as in the IDE: word starts and runs, e.g. `uas` → UseAutosave.
- **Themes**: the 10 Material Theme UI variants (Darker, Oceanic, Palenight, Deep Ocean, Forest, Space, Volcano,
  Lighter, Sandy Beach, Sky Blue), from the gear menu or Search Everywhere ("Theme: …"); remembered per browser.
- **Edit and commit**: the pencil over the diff makes the PR head editable (the bands follow the edit); the Commit
  panel (the strip's commit button, or Commit in the toolbar) lists the edited files with checkboxes, a message and
  *Amend last commit*, and *Commit and Push* makes one commit on the PR's branch (refused if the branch moved since,
  with Undo). Needs a token with *Contents: write*. Edits are kept for the tab's session.
- **Timeline** ("View Timeline" in the PR header): the description as GitHub renders it, comments, reviews with their
  inline comment threads, and the commits, in time order.
- **Markdown preview**: `.md` files show rendered in the diff, with the changed words highlighted: old | new with
  connectors between the changes and scrolling that keeps them side by side, or on a phone one page with the
  removed words and blocks struck through. F7 steps through the changes; *Preview | Code* in the toolbar switches. Commit message bodies in the Log are
  rendered as Markdown too.
- **Unified viewer**: Monaco's inline diff editor (the default on narrow screens).
- **Log**: the PR's commits with a graph line and a text/hash filter; select a commit, or shift-select a range, to see
  its changed files and details; double-click, Enter or Show Diff opens it.
- **Viewed**: per-file checkboxes (V). With a token they sync with GitHub's "Viewed" (GraphQL); without one they are
  kept in this browser.

Code is highlighted by TextMate grammars through [Shiki](https://shiki.style) (`material-theme-darker`, with the
diff, selection, gutter and main syntax colors taken from the IDE's own scheme, `colors/Material Darker.xml` of
[Material Theme UI Lite](https://github.com/AtomMaterialUI/material-theme-ui-lite), MIT) inside [Monaco](https://microsoft.github.io/monaco-editor/), both from CDNs; languages load
on demand. Diffs come from Monaco's diff algorithm (the one VS Code uses). No build step: the files here are served
as they are.

## Themes

`js/themes.js` is generated from the plugin's own files in a checkout of Material Theme UI Lite: each variant's UI
palette (`themes/regular/Material <Name>.theme.json`) colors the page, and its editor scheme
(`colors/Material <Name>.xml`) gives the diff, selection, gutter and caret colors and the syntax colors (JetBrains
attributes mapped to TextMate scopes in the script). To regenerate:

```sh
git clone --depth 1 https://github.com/AtomMaterialUI/material-theme-ui-lite /tmp/mtui
node tools/material-themes.mjs /tmp/mtui
```

## GitHub access

Public repositories work without a token (60 API requests an hour per IP). For private repositories and a higher
limit, add a token (the titlebar gear → GitHub token): a fine-grained token with *Contents: read* and *Pull requests: read and write*
(write is only for Viewed), plus *Contents: read and write* to commit edits, or a classic token with `repo`. It is stored in this browser's `localStorage` and sent
only to `api.github.com`. File contents at a commit never change, so they are cached in Cache Storage.

## Snapshots

To try the page without a token (e.g. on a phone), record a PR's API responses and open it with `&snap=<name>`:

```sh
node tools/record-snapshot.cjs http://localhost:8000/pr-viewer/ owner/repo/123 demo   # GITHUB_TOKEN for private repos
```

then `http://localhost:8000/pr-viewer/?snap=demo&pr=owner/repo/123`. It holds the PR, each of its commits with their
file contents, and the PR lists; anything else answers "Not in this snapshot". `snap/` is git-ignored: a snapshot of a
private repository contains its code. `?snap=` (empty) leaves snapshot mode.

## Develop

Serve the folder with any static server, e.g. `python3 -m http.server` in `website/public`, and open
`http://localhost:8000/pr-viewer/`.
