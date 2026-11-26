# @threepipe/plugin-cloud Changelog

## [Unreleased]

The first version.

### Added

- Initial package: `ThreepipeCloudPlugin`, the client of threepipe cloud (https://cloud.threepipe.org, services/cloud).
  - `auth`: Sign in with threepipe (a key for the app's folder, or the whole drive), kept for the session.
  - `drive`: folders and items of the signed-in person's drive (`save`, `saveFolder`, `share`, `unshare`, `newId`, `remove`, …).
  - `share`: `upload` files as one drive item and get a link anyone can open.
  - `feedback`: the Report a problem dialog (bug, question, idea, other) with a screenshot, the scene, the redacted log
    around `console` and `ThreeViewer.Console`, the environment and `addContext` providers; toasts for problems with
    fingerprints, `reportError`. Signed-in reports skip Turnstile.

### Security

- `cloud.auth` on a page without storage (the sandboxed pages of files.threepipe.org): a key in the URL is taken only after the person confirms it, in a dialog that names the account the key was issued to (the email in the key, which a link cannot change, unlike `tp_cloud_user`). Such a page cannot keep the `state` of its own sign-in, so it took any key, and a link carrying someone else's key signed the visitor in to that account: their saves, shares and reports went there. `auth.confirmUnverified(account)` replaces the dialog (default `confirm()`; no sign-in where it is not available). Pages with storage check the `state` as before and never ask

### Fixed

- The package builds again and is not built during `npm install`: it writes its declarations with `declarations()` of `scripts/vite-utils.mjs` (as the other packages; `fixDtsImports` and `vite-plugin-dts` are no longer there), into `dist/` (`rootDir` in its tsconfig), and it has no `prepare` script, so a failed build no longer stops `npm ci` of the repository
- `npm run typecheck` checks the code again: TypeScript 7 stopped at `baseUrl` (TS5102, removed) before checking anything. The tsconfig is now the one of the other packages (no `baseUrl` or `paths`, `strict: false`, `types: ["*"]`), with their `src/global.d.ts` for the shader and CSS imports of the core sources it reads
