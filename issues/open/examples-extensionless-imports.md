# Examples: extensionless relative imports break the static example server

**Found**: 2026-10-18, procedural e2e on `npm run serve` (the default Playwright `webServer`, as in CI).

`build-examples` compiles each example with tsc and keeps import specifiers as written. The static server (`ws -d .`)
serves files by exact path, so `import {x} from './terrain'` asks for `terrain` (404) and the page never finishes.
The vite dev server resolves extensionless imports, so runs with `PLAYWRIGHT_BASE_URL` pointing at vite hide it.

Fixed on modelling-editor: `procedural-terrain/script.ts` and `procedural-editor-assets/script.ts` now import
`./terrain.js` / `../procedural-terrain/terrain.js`, the convention other examples use (theatrejs-plugin).

Still open on dev (pre-existing, not touched here):
- `examples/monkey-type-3d/script.ts:23` `import {Fire} from './Fire'`
- `examples/tweakpane-editor/script.ts:3` `import {ThreeEditor} from './ThreeEditor'`

Proposal: fix both the same way in a core PR, and have a check (lint rule or a test over `examples/*/script.ts`)
that relative imports carry `.js`.
