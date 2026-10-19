# Publishing

This document describes how `threepipe` and its `@threepipe/*` plugin packages are released to npm. Publishing is fully driven by CI on pushes to `master`; developers only update versions and changelogs.

## TL;DR

To publish a new version of any package:

1. Bump `version` in the package's `package.json`.
2. Replace the `## [Unreleased]` heading in that package's `CHANGELOG.md` with `## [X.Y.Z] - YYYY-MM-DD`.
3. Commit and push (or merge) to `master`.

CI compares each `package.json` version against the version currently published on npm, builds anything that changed, and publishes via npm OIDC. There is no local `npm publish` step.

## Developer workflow

### Publishing a plugin update

Example: cutting `@threepipe/plugin-blend-importer` 0.2.0.

1. Edit `plugins/blend-importer/package.json` and bump `version` to `0.2.0`.
2. Edit `plugins/blend-importer/CHANGELOG.md`:
   - Rename the `## [Unreleased]` heading to `## [0.2.0] - 2026-06-04` (today's date, `YYYY-MM-DD`).
   - Add a fresh empty `## [Unreleased]` section above it for future work.
   - Update the link references at the bottom of the file to point to the new release tag.
3. If the bump tightens the `threepipe` peer dependency range, update `peerDependencies.threepipe` in the same `package.json`.
4. Commit and push to `master` (typically via PR merge).

### Publishing core `threepipe`

Same flow, but in the repo root: bump `package.json` `version` and update the root `CHANGELOG.md` with a `## [X.Y.Z] - YYYY-MM-DD` heading. When the core version bump breaks `peerDependencies` ranges declared by plugins, bump the affected plugins in the same PR.

## What CI does on push to master

The `Publish packages to npm` workflow (`.github/workflows/publish.yml`) runs two jobs:

1. **`check`** (no environment, no publish permissions):
   - `scripts/ci/publish-check.mjs` — for the root package and every non-private plugin (skipping `plugin-template-*`), runs `npm view <name> version` and compares against the local `package.json`. Any mismatch is added to a `changes` list together with the matching `CHANGELOG.md` entry and commit log since the previous git tag.
   - `npm ci` then `scripts/ci/build-verify.mjs` — verifies each changed package has a changelog entry for its new version and a non-empty `dist/` containing an `index*` file. Anything failing is dropped from the publish set but reported.
   - `npm run docs-all` — typedoc + vitepress build, only if at least one package passes verification.
   - Uploads `dist/`, `lib/`, `docs/`, `plugins/*/dist/`, `plugins/*/docs/` as the `build-output` artifact.
   - `scripts/ci/notify-discord.mjs` — posts changelog, commits, and a summary embed to Discord. The summary embed links to the workflow run, where the publish job awaits approval.
2. **`publish`** (gated on the `npm-publish` GitHub environment, requires reviewer approval):
   - `npm ci --ignore-scripts`, downloads the `build-output` artifact, then `scripts/ci/publish-packages.mjs` runs `clean-package`, `npm pack`, and `npm publish --provenance` (with `--access public` for plugins) per package, restoring each `package.json` afterwards.

## OIDC trusted publishing

The publish step has no `NPM_TOKEN`. It relies on npm's OIDC trusted publishing, enabled by `permissions.id-token: write` and `--provenance` on `npm publish`. Each published package (`threepipe`, every `@threepipe/plugin-*`) must have GitHub Actions configured as a trusted publisher on npmjs.com, pinned to this repo, the `publish.yml` workflow, and the `npm-publish` environment.

When debugging a publish failure that surfaces as a 4xx from the registry, check the trusted publisher configuration on npmjs.com first; the package may be new and not yet linked.

## `clean-package` behavior

Before `npm pack`, `clean-package` rewrites each `package.json` to strip fields that should never appear in the published tarball. It is restored immediately after publish (in a `finally` block, so even a failed publish leaves the working tree clean).

- Core (root `package.json`) removes: `clean-package`, `scripts`, `optionalDependencies`, and the `//` comment field.
- Plugins remove: `clean-package`, `scripts`, `devDependencies`. The `dependencies` field is replaced with `{}` so the `file:./../../src/` link to local `threepipe` source does not ship; `peerDependencies` is the source of truth for downstream installs.

## Verify locally before pushing

Run the version-bump detector from the repo root:

```bash
node scripts/ci/publish-check.mjs
```

It prints the packages that would be picked up by CI (`<name> <old> → <new>`). `GITHUB_OUTPUT` is only used to forward results to the workflow; leaving it unset is fine locally. The script makes outbound `npm view` calls and reads `git` tags, but does not modify anything.

To dry-run the tarball for a single plugin, `cd` into it and run `npm run new:pack`. This builds, generates docs, runs `clean-package`, produces a `.tgz`, and restores `package.json` — matching what CI does up to (but not including) `npm publish`.

## Adding a new plugin package

Follow the "Creating a Package/Plugin package" checklist in [`CONTRIBUTING.md`](https://github.com/repalash/threepipe/blob/master/CONTRIBUTING.md). Once the package exists with a valid `package.json`, `CHANGELOG.md`, and `dist/` build, CI will pick it up on the first push to `master` where its version differs from npm (which, for a brand new package, is "not published yet"). Configure the npm trusted publisher for the new package name before merging, otherwise the publish step will fail.

## Common pitfalls

- **Bumped version, forgot the dated changelog entry.** `publish-check.mjs` still detects the bump and queues the package, but `build-verify.mjs` fails it (`Missing changelog entry`) and it is dropped. Discord shows it under "Failed" and nothing publishes for that package.
- **Wrong date format.** The regex in `publish-check.mjs` matches `## [X.Y.Z]` followed by anything until the next blank-line heading, so the date itself is not validated by the script, but Discord release notes and the changelog convention require `YYYY-MM-DD`. Always use that exact format.
- **`## [Unreleased]` left in place.** `publish-check.mjs` only looks up the heading matching the *new* version. If you bumped to `0.2.0` but the changelog still only has `## [Unreleased]`, `pkg.changelog` is empty and verification fails.
- **`private: true` plugins.** `plugin-template-*` directories are skipped explicitly, and any other plugin with `"private": true` in its `package.json` is skipped by `publish-check.mjs`. If you forked a template and forgot to remove `private`, your package will never be picked up.
- **`npm run new:publish` is misleadingly named.** The root script only runs `git tag v$npm_package_version && git push origin v…`. It does **not** publish; CI does. The script is useful for tagging once a publish has succeeded, but is not part of the publish path itself.
- **Peer dependency drift.** When bumping core `threepipe`, audit plugin `peerDependencies.threepipe` ranges. If the new core version breaks the declared range, bump the affected plugins in the same PR so npm consumers do not see semver conflicts.
