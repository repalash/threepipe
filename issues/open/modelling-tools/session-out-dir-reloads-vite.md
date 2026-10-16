# A modelling session writing into the vite root reloads its own page mid-build

Found running `demos/stair/build.mjs` against the examples dev server
(`npm run vite`, `modelling:session --url http://127.0.0.1:<port>/examples/modelling-api/index.html --no-serve`).

When `--out` is inside the worktree (e.g. `tmp/stair/run`) and a re-run overwrites a capture from
the previous run, vite's watcher reports the change and full-reloads every open page:

```
1:20:53 pm [vite] (client) page reload tmp/stair/run/001-column-one-lathe.png
```

The session's page is one of them, so the next command fails with
`page.evaluate: Execution context was destroyed, most likely because of a navigation`, and the build
is lost. The same applies to `export {path}` inside the root. The e2e suite hit this for its
screenshots and `vite.examples.config.js` now ignores `tests/snapshots/**`, `test-results/**` and
`playwright-report/**`; session output dirs are not covered.

## Expected

A session never reloads itself. Either add `**/tmp/**` (and other output folders) to
`server.watch.ignored` in `vite.examples.config.js`, or have `modelling-session.mjs` warn when `--out`
is under the served root while `--url` points at a dev server.

## Workaround used

`demos/stair` sessions write to `/tmp/stair-out/...` and the results are copied into the worktree
after the browser closes.
