# Contributing to Threepipe

We welcome contributions to Threepipe. Please read the following guidelines to start working on the code and creating pull request.

## Setting up the project

Requires Node.js `^20.19` or `>=22.12` (Vite 8) and npm 10 or newer.

1. Clone the repository
2. Run `npm install`

The repository is an npm workspace: one install at the root sets up the core and every package in `plugins/` (one `package-lock.json`, hoisted `node_modules`). Nothing is built during install.

## Development

The quickest way to try the examples needs no build at all:

1. Run `npm start` (or `npm run vite`) to start the vite dev server, and navigate to http://localhost:5173/examples/index.html
2. Test the examples and pick the one you are working on. The dev server loads the core and all plugins from their `src/` folders, so changes reload directly.

To test against the built bundles instead (as the deployed site and the e2e tests do):
1. Run `npm run build:all` once to build the core, all plugins and the examples.
2. If changing the `src/` folder - Run `npm run dev` to rebuild the core in watch mode.
3. If changing the `plugins/` folder - `cd` to the plugin directory and run `npm run dev` to rebuild the package in watch mode.
4. Run `npm run dev-examples` to compile the examples in watch mode and `npm run serve` to start the static server, and navigate to http://localhost:9229/index.html

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
