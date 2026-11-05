# Contributing to Threepipe

We welcome contributions to Threepipe. Please read the following guidelines to start working on the code and creating pull request.

## Setting up the project

Requires Node.js `^20.19` or `>=22.12` (Vite 8) and npm 10 or newer.

1. Clone the repository
2. Run `npm install`
3. Run `npm start`

The repository is an npm workspace: one install at the root sets up the core and every package in `plugins/` (one `package-lock.json`, hoisted `node_modules`). Nothing is built during install, `npm start` runs the examples from the sources.

## Development

1. Run `npm start` (same as `npm run dev`). It starts the vite dev server and opens the examples at
   http://localhost:5173/examples/index.html. No build is needed.
2. Pick the example you are working on. The examples use the sources of the core and the plugins, so a change in
   `src/`, `plugins/*/src` or `examples/` reloads the page.

OR, to work on the built files (as the deployed site and the e2e tests use them):
1. Run `npm run build:all` once to build the core, all plugins and the examples.
2. If changing the `src/` folder - Run `npm run watch` to rebuild the core on every change
3. If changing the `plugins/` folder - `cd` to the plugin directory and run `npm run watch` to rebuild the package on every change.
4. Run `npm run watch-examples` to start the examples build in watch mode and run `npm run serve` to start the development server, and navigate to http://localhost:9229/index.html

## Commands

Run them in the repository root, unless the table says otherwise.

| Command | What it does | When |
|---|---|---|
| `npm install` | Installs the dependencies of the core and of every plugin (npm workspace), builds nothing | After cloning, and after pulling changes to dependencies |
| `npm start` / `npm run dev` | Examples dev server (vite) on http://localhost:5173, opens `/examples/index.html` | Day to day: run and edit the examples, the core and the plugins |
| `npm run vite` | Same as `npm run dev` (the old name) | — |
| `npm run watch` | Rebuilds the core bundle (`dist/`) on every change. In a plugin folder: rebuilds that plugin's `dist/` | When another project links this build |
| `npm run build` | Builds the core into `dist/` and `lib/` | Before publishing, or to test the built files |
| `npm run build-plugins` | Builds every plugin (turbo, in dependency order, cached) | To test the built plugins |
| `npm run build:all` | Builds the core, every plugin and the examples (turbo, cached) | To test everything as it is deployed |
| `npm run build-examples` / `npm run watch-examples` | Compiles the examples to JavaScript (once / on change), for `npm run serve` | To test the examples as they are deployed |
| `npm run serve` | Static server for the built files on http://localhost:9229 | With `build:all`, `build-examples` or `watch-examples` |
| `npm run lint` | Oxlint with the rules in `.oxlintrc.json` (every rule is an error, the code passes them all) | Before a pull request |
| `npm run typecheck` | Type-checks the core (TypeScript 7) | Before a pull request |
| `npm run test:unit` | Unit tests (vitest) | Before a pull request |
| `npm run test:e2e` | Browser tests (playwright), against the built files | Before a pull request that changes rendering |
| `npm run check-bundles` | Checks the built bundles: every import is declared, no package is bundled twice | After `build:all`, when a vite config or a dependency changes |
| `npm run website:dev` | The website (vitepress) | Docs changes |
| `npm run docs` / `npm run docs-all` | API docs of the core and the website build / the same plus the API docs of every plugin | Docs changes |

Check manually, the linter cannot: a function that returns a Promise is `async` (a sync `throw` in it then rejects the Promise instead of throwing to the caller).

Different from other projects:
- `dev` starts the dev server (as in vite projects); the watch build of the library is `watch`. Before this change,
  `dev` was the watch build and `vite` the dev server.

For website(vitepress) development -
- Run `npm run website:dev` to start the website server.

**Note**: If you see `Cannot access 'X' before initialization` errors after adding or moving source files, delete the `.vite/` cache folder and reload. Vite's transform cache can become stale when the module graph changes.

Some examples requires env variables.
- Run `cp examples/sample.env examples/.env` and set the required tokens/keys in the `examples/.env` file, and build the examples again.

To add a dependency to a plugin, run `npm install <package> -w plugins/<plugin-name>` from the root (`-D` for a devDependency).

## Testing

- `npm run test:unit` runs the unit tests (vitest), from source.
- `npm run test:e2e` runs the example tests (playwright) against the built bundles, run `npm run build:all` first.
  The screenshots it compares against are not in this repository. On a fresh clone the first run writes them to
  `tests/snapshots/` and reports each test as failed; the next run compares against them.
- `npm run test:types` type-checks the published declarations as a consumer, run `npm run build` first.
- `npm run check-bundles` checks the built bundles of the core and every plugin, run `npm run build:all` first. It fails
  on an import that is not `threepipe` or a peerDependency (a bare `three` that the examples cannot resolve), and on a
  package bundled twice from different `node_modules` folders (fix: `resolve.dedupe` in that plugin's vite config).
  After a cache restore, a stale file from an earlier build can remain in `dist/`; `npx turbo run build --force` rebuilds.

No workflow runs on pull requests. Before a pull request, run `test:unit`, and for build or dependency changes
`build:all`, `check-bundles` and `test:types`.

For a pull request that changes the examples or rendering, add a link to a preview of it. Two separate steps:

1. `npm run build:all`: builds the core, the plugins and the examples (nothing is uploaded).
2. `npm run cloud:upload-preview -- pr-<number>`: uploads what step 1 built (`dist/`, `examples/`, `plugins/*/dist/`)
   to threepipe cloud and prints the link; put it in the pull request. The preview stays until cleaned up.

Step 2 needs a threepipe cloud key (`TP_CLOUD_KEY`): sign in at https://cloud.threepipe.org with GitHub, create an access
link, and follow it. See `services/cloud/README.md`.

### The dev site and old versions

https://dev.threepipe.org is the site, examples and docs of the `dev` branch, on Cloudflare Pages. Every merge into `dev`
deploys it (`npm run build-site`). Use it to try what is about to be released, or to compare it with a pull request's
preview above. https://threepipe.org is `master`.

Cloudflare keeps each deployment at its own address, `https://<hash>.threepipe.pages.dev`, so you can open an old version
to find when something changed. The hash is random, not the commit's. Find it on the commit's `Cloudflare Pages` check on
GitHub, or in the project's deployments on the Cloudflare dashboard, or with:

```bash
gh api repos/repalash/threepipe/commits/<commit>/check-runs -q '.check_runs[] | select(.name == "Cloudflare Pages") | .output.summary' | grep -o 'https://[a-z0-9]*\.threepipe\.pages\.dev'
```

- Only `dev` is deployed: branches and pull requests have no Cloudflare address (their builds are skipped), so use the
  preview above for those.
- A commit whose build failed has no address (for example `dev` from 2026-10-30 to 2026-11-05).
- All of these are public, and marked `noindex` so that search engines skip them.

## Building

Builds run through [Turborepo](https://turborepo.com): packages build in parallel in dependency order, and a package whose inputs did not change is restored from the cache in `.turbo/` instead of being built again.

1. Run `npm run build` to build the core (`dist/` and `lib/`), or in a specific package directory to build the package
2. Run `npm run build-plugins` to build all the plugins
3. Run `npm run build-examples` to compile the examples (`tsc`, against the built bundles)
4. Run `npm run build:all` to build the core, plugins and examples
5. Run `npm run website:build` to build the website
6. Run `npm run docs` to build the API docs and the website, `npm run docs-all` to also build the API docs of every plugin

Turbo options can be passed through, for example `npx turbo run build --filter=@threepipe/plugin-tweakpane` builds one plugin and what it depends on, `--force` ignores the cache.

## Publishing

For core and for each package -
- Update the package version in `package.json` and add a `## [<version>]` entry to its `CHANGELOG.md`.
- Merge to `master` on github. The "Publish packages to npm" workflow ([repalash/release-tools](https://github.com/repalash/release-tools)) builds and checks every package whose version is not on npm, posts to Discord with the approval link and a Claude review, waits for the `npm-publish` environment approval, publishes with npm trusted publishing, and pushes the release tags (`v0.0.1` for core, `@threepipe/plugin-name-0.0.1` for a plugin).
- Each package builds with its docs (`npm run build && npm run docs`), in dependency order. A package whose build fails is left out of that release, with the packages that depend on it; the notice lists them and the others are published. `npm run test:types` must pass for any release (it checks the core with plugin-tweakpane); the examples' type check only warns.

## Creating a Core Plugin

Checklist 
- Create a class in a subfolder at `./src/plugins`
- Inherit from `AViewerPluginSync`
- Set a unique `PluginType`
- Write plugin
- If the plugin adds DOM UI over the canvas, pick its `z-index` from [UI layers](#ui-layers-z-index)
- Add jsdoc comments to the class
- If the plugin loads a library or a file at runtime from a URL (a CDN), keep the URL in a static property that a user can set (like `DRACOLoader2.DRACO_LIBRARY_PATH`), and add it to `./website/notes/dynamically-loaded-files.md`
- Export classes, functions in `./src/plugins/index.ts`
- Optionally, use plugin in `./examples/tweakpane-editor/script.ts`
- Optionally, use plugin in `./examples/model-viewer/script.ts`
- Optionally, use plugin in `threepipe-blueprint-editor`
- Create an example in `./examples` by duplicating any existing one
- Add example to `./examples/index.html`
- Add example and any other tests to `tests/`
- Add info to `README.md`
- Add info to `./website/guide/core-plugins.md`
- Add info to `./website/plugin/PluginName.md`
- Add entry to sidebar in `./website/.vitepress/config.ts`
- Update CHANGELOG.md

## UI layers (z-index)

Plugins that add DOM elements over the canvas use these layers, so the UI stacks the same way with any set of plugins. Use the lowest layer that fits, and do not go above the menu layer.

| z-index | Layer | Examples |
|---|---|---|
| `auto` to 49 | Overlays drawn on the canvas | selection overlay, `Object3DWidgetsPlugin` DOM icons (8), `PerfPanelPlugin` pill (12), editor camera frame (40) |
| 50 | Loading screen | `LoadingScreenPlugin` |
| 100 to 199 | Viewer UI over the scene | `GridItemList` (100), editor camera pill and card (120), sticky notes and open `PerfPanelPlugin` card (150 + `--ui-raise`: the one pressed last is in front, see `raiseOnPress`) |
| 200 to 999 | Panels and bars | tweakpane editor `.button-bar` (200), editor frame mode bar (200) and title or status bar (210) |
| 1000 to 1999 | Floating tools | `TimelineUiPlugin`, `RenderTargetPreviewPlugin`, `GeometryUVPreviewPlugin` (1000) |
| 2000 to 9998 | Popups and dropdown menus | editor layout menu (2000), sticky notes menus (2000) |
| 9999 and up | Context menus | `CustomContextMenu` |

Floating panels in the same layer that can overlap (the sticky notes and the open perf card in the same corner) register with `raiseOnPress(element)` (core `utils`) and use `z-index: calc(<layer base> + var(--ui-raise, 0))` in their CSS: a press on one brings it in front of the others, and all stay in their layer.

A layer counts only between elements in the same stacking context: an element inside a parent with its own `z-index` (or `transform`, `filter`, `opacity` below 1) stacks inside that parent.

## Creating a Package/Plugin package

Checklist
- Duplicate a template plugin from `plugins/` folder - `plugin-template-vite`
- Change `name`, `description`, `repository.directory`, `dependencies` and any other relevant fields in `package.json`
- Run `npm install` at the root, every folder in `plugins/` (except `plugin-template-*`) is a workspace package
- Change `name` in `typedoc.json`
- Update link in plugin's `CHANGELOG.md` and `README.md`
- Check `globals` in `vite.config.js`
- Write plugin/package
- If the plugin adds DOM UI over the canvas, pick its `z-index` from [UI layers](#ui-layers-z-index)
- Add jsdoc comments to the classes
- If the plugin loads a library or a file at runtime from a URL (a CDN), keep the URL in a static property that a user can set (like `DRACOLoader2.DRACO_LIBRARY_PATH`), and add it to `./website/notes/dynamically-loaded-files.md`
- Export classes, functions in `index.ts`
- Optionally, use plugin in `./examples/tweakpane-editor/script.ts`
- Optionally, use plugin in `./examples/model-viewer/script.ts`
- Optionally, use plugin in `threepipe-blueprint-editor`
- Create an example in `./examples` by duplicating any existing one. Ideally one example for each exported plugin/utility.
- Add example to `./examples/index.html`
- Add example and any other tests to `tests/`
- Add info to `README.md`
- Add info to `./website/guide/threepipe-packages.md`
- Add info to `./website/package/plugin-name.md`
- Add entry to sidebar in `./website/.vitepress/config.ts`
- `npm run build` and test with example
- Publish by merging to `master` (see Publishing). The workflow pushes the tag, like `@threepipe/plugin-name-0.0.1`
- Update core CHANGELOG.md with link to new package. 
