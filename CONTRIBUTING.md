# Contributing to Threepipe

We welcome contributions to Threepipe. Please read the following guidelines to start working on the code and creating pull request.

## Setting up the project

Requires Node.js `^20.19` or `>=22.12` (Vite 8) and npm 10 or newer.

1. Clone the repository
2. Run `npm install`
3. Run `npm start`

The repository is an npm workspace: one install at the root sets up the core and every package in `plugins/` (one `package-lock.json`, hoisted `node_modules`). Nothing is built during install, `npm start` runs the examples from the sources.

With npm 12 or newer, run `npm install --allow-git=all` instead. npm 12 refuses dependencies from git repositories by
default (`EALLOWGIT`), and `plugins/tweakpane-editor` still has one (treejs).

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
| `npm run test:unit` | Unit tests (vitest) | Before a pull request |
| `npm run test:e2e` | Browser tests (playwright), against the built files | Before a pull request that changes rendering |
| `npm run website:dev` | The website (vitepress) | Docs changes |
| `npm run docs` / `npm run docs-all` | API docs of the core and the website build / the same plus the API docs of every plugin | Docs changes |

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
- `npm run test:types` type-checks the published declarations as a consumer, run `npm run build` first.

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
- Merge to `master` on github. The "Publish packages to npm" workflow builds and checks every package whose version is not on npm, waits for the `npm-publish` environment approval, publishes, and pushes the release tags (`v0.0.1` for core, `@threepipe/plugin-name-0.0.1` for a plugin).

## Creating a Core Plugin

Checklist 
- Create a class in a subfolder at `./src/plugins`
- Inherit from `AViewerPluginSync`
- Set a unique `PluginType`
- Write plugin
- Add jsdoc comments to the class
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

## Creating a Package/Plugin package

Checklist
- Duplicate a template plugin from `plugins/` folder - `plugin-template-vite`
- Change `name`, `description`, `repository.directory`, `dependencies` and any other relevant fields in `package.json`
- Run `npm install` at the root, every folder in `plugins/` (except `plugin-template-*`) is a workspace package
- Change `name` in `typedoc.json`
- Update link in plugin's `CHANGELOG.md` and `README.md`
- Check `globals` in `vite.config.js`
- Write plugin/package
- Add jsdoc comments to the classes
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
