# Contributing to Threepipe

We welcome contributions to Threepipe. Please read the following guidelines to start working on the code and creating pull request.

## Setting up the project

1. Clone the repository
2. Run `npm install`. It also builds the core, installs and builds every plugin in `plugins/`, and builds the examples.

With npm 12 or newer, run `npm install --allow-git=all` instead. npm 12 refuses dependencies from git repositories by
default (`EALLOWGIT`), and `plugins/tweakpane-editor` still has one (treejs).

If a plugin fails to install, the others are still installed and the examples are still built; the install ends
with the list of failed plugins. Fix the cause, then run `npm ci` in that plugin's folder (`plugins/<name>`).

## Development

1. Run `npm run vite` to run vite dev server and open the URL it prints (http://localhost:5173/ opens the examples at /examples/index.html)
2. Test the examples and pick the one you are working on.

OR
1. If changing the `src/` folder - Run `npm run dev` to start the development in watch mode
2. If changing the `plugins/` folder - `cd` to the plugin directory and run `npm run dev` to start the development in watch mode for the package.
3. Run `npm run dev-examples` to start the examples build in watch mode and run `npm run serve` to start the development server, and navigate to http://localhost:9229/index.html

For website(vitepress) development -
- Run `npm run website:dev` to start the website server.

**Note**: If you see `Cannot access 'X' before initialization` errors after adding or moving source files, delete the `.vite/` cache folder and reload. Vite's transform cache can become stale when the module graph changes.

Some examples requires env variables.
- Run `cp examples/sample.env examples/.env` and set the required tokens/keys in the `examples/.env` file, and build the examples again.

## Testing

TBD

## Building

1. Run `npm run build` to build the project, or in a specific package directory to build the package
2. Run `npm run build-examples` to build the examples
3. Run `npm run website:build` to build the website
4. Run `npm run docs` to build only the API docs
5. Run `npm run prepare` to build the project, examples and plugins
6. Run `npm run docs-all` to build API docs and website

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
