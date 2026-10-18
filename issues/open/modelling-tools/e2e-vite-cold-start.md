# e2e against a cold vite dev server: first procedural runs time out

**Found**: 2026-10-18 (realism agent, then reproduced in the merge verification).

With `PLAYWRIGHT_BASE_URL` pointing at a freshly started `npm run vite`, the first procedural runs
(procedural-terrain, editor-assets terrain) can time out while vite is still discovering and optimising
dependencies (optimizeDeps runs on first request and reloads the page when it finds new deps). A rerun on the same
server passes. Runs against the static server (`npm run serve`, the default webServer, as in CI) do not have this.

Workaround used in verification scripts: request the example pages once before the tests (warm-up). Proper fix
options: list the plugin entry points in `optimizeDeps.include` of `vite.examples.config.js`, or have the
modelling/procedural e2e helpers use the static server. Not done yet.
