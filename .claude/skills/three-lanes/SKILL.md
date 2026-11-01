---
name: three-lanes
description: Work on a three.js upgrade lane, one three.js revision (r172, r177, ...) carried through three.js-modded, threepipe and webgi. Use to start a lane, release its rc builds, check them in the lane lab page, merge fixes between lanes, or ship a lane's final release.
---

# three.js upgrade lanes

A **lane** is one upstream three.js revision `rNNN` taken through the three repositories. Lanes run in
parallel and do not wait for each other. `latest` on npm and the default branches stay on the released
revision until a lane's final release.

| | three.js-modded | threepipe | webgi |
|---|---|---|---|
| work branch | `patches/rNNN` | - | - |
| lane branch | `lane/rNNN` (from `master`) | `lane/rNNN` (from `dev`) | `lane/rNNN` (from `master`) |
| rc version | `0.NNN.10001-rc.N` | `<next minor>-rNNN.N` | `<next minor>-dev.NNN.N` |
| published to | npm, dist-tag `three-rNNN` | npm, dist-tag `three-rNNN` | CDN `releases.ijewel3d.com/libs/webgi-v0/` |
| lane log | draft PR `lane/rNNN` -> `master` | draft PR `lane/rNNN` -> `dev` | draft PR `lane/rNNN` -> `master` |

One session owns one lane. Attach the repositories it does not have with `add_repo`.

## Rules

- three.js-modded: work however is easiest on `patches/rNNN` (the fork's commits on top of tag `rNNN`,
  one change at a time). What gets **released** is always the merge commit, like
  repalash/three.js-modded#8: a merge of tag `rNNN` whose files are `patches/rNNN`, with `master`'s
  `.github/workflows/create-release.yml`, a `.gitignore` that keeps `build/` tracked, and `build/` from
  `npm run build`.
- Pin exact versions between the repositories (`"three": "npm:three-modded@0.NNN.10001-rc.N"`), never a
  dist-tag or a range.
- Never move `latest`: a lane publishes only prerelease versions with its dist-tag `three-rNNN`.
- After an rc is published from a lane branch, only add commits to it: no rebase or force push.
- Everything that goes to npm waits for approval and review the same way as a stable release (the
  `npm-publish` environment with the Claude review); webgi builds wait for the deploy gate. An rc is no
  exception. Ask for the approval and say what to check; never work around it.
- Never merge a pull request, in any repository, including the lane's own and the final release. Open
  it, say what it needs, and the person merges it.
- Few releases. An rc is for a set of changes that is done and passes its checks, not for each fix: batch
  the fixes, keep at most one rc per repository waiting for approval, and say in the lane PR what the new
  rc has that the last one did not. Never publish again just to retry or to see if something works.
- A lane changes only its own branches. A fix that belongs to several lanes is made in the lowest lane
  and merged up (see Fixes across lanes).
- Each repository's own CLAUDE.md, AGENTS.md and CONTRIBUTING.md still apply (commit style, checks,
  `npm run` scripts only).

## Start a lane

1. Check the one-time setup below; if something is missing, open its PR first and say the lane waits on it.
2. three.js-modded: `patches/rNNN` exists, or make it: the fork commits of the newest `patches/r*`
   rebased onto tag `rNNN`.
3. In each repository create `lane/rNNN` from the base in the table and push it.
4. Open the three draft PRs (the lane logs). Body: the revision, the plan, and an empty rc table
   (version, commit, what changed, check results).

## Release an rc

Order inside a lane: three.js-modded, then threepipe, then webgi. Each one pins the rc before it.

**three.js-modded**
1. First rc: on `lane/rNNN`, `git merge rNNN`, files as in the Rules (PR #8 shape). Later rcs: a commit
   that copies `patches/rNNN` again and rebuilds `build/`.
2. `package.json`: `version` `0.NNN.10001-rc.N`, `publishConfig.tag` `three-rNNN`.
3. `npm run lint`, `npm run test-unit`, `npm run test-unit-addons`, `npm run build`, and the e2e tests.
4. Push. Ask for the approval. Check it is on npm: `npm view three-modded@three-rNNN version`.

**threepipe**
1. First rc: cherry-pick the existing port commits for this revision if there are any (`three-r172`,
   `three-r177`), else port: build, read the errors, use the three.js migration guide for the revisions
   between.
2. `three` = the fork rc, in `dependencies` and `overrides` of `package.json`.
3. Every package the lab page loads: `version` `<next minor>-rNNN.N`, `publishConfig.tag` `three-rNNN`,
   a CHANGELOG entry; plugins' `peerDependencies.threepipe` gets `|| >=<core rc version>` (ranges do not
   match prereleases otherwise).
4. `npm run build:all`, `npm run test:unit`, `npm run test:types`, `npm run test:e2e`.
5. Push. Ask for the approval. Check with `npm view threepipe@three-rNNN version`.

**webgi**
1. `three` = the fork rc (needs webgi on npm three-modded, ijewel3d/webgi#86).
2. Fix the build, `version` `<next minor>-dev.NNN.N`, a `## <version>` entry in `Changelog.md`.
3. `npm run lint`, `npm run build-runtime-local`.
4. Push the branch, then ask the person to run the release: agent sessions cannot push tags (a Claude
   Code cloud session gets HTTP 403, an ijewelOS host accepts only branches). Give the commit and the
   commands: `git fetch origin && git checkout <commit> && npm run release`. Then they approve it on
   the deploy gate.

Then add the rc row to each lane PR.

## Check an rc

1. The lab page: `https://threepipe.org/examples/lane-lab/?lane=rNNN` (dist-tags, cached by the CDN for a
   while) or with exact versions `?threepipe=<v>&webgi=<v>` right after a publish. `?compare=r168` shows the
   released version beside it.
2. Load the test files listed on the page (from `samples.threepipe.org`): models, materials, environment,
   and post-processing on and off. Compare with the released version and write down every difference.
3. threepipe's visual A/B against the released revision.
4. Write the results in the rc row: what works, what differs, what is broken. A person reviews the rc there.

## Fixes across lanes

- A fix in lane rAAA that a higher lane also needs: in each repo merge `lane/rAAA` into `lane/rBBB`
  (three.js-modded: also put the fix into `patches/rBBB`).
- `dev`/`master` moved on: merge it into the lowest lane, then up.
- A lane that a higher lane makes unnecessary: say so in its PR and stop. Its rcs stay on npm.

## Final release (the target revision)

1. three.js-modded: `release/three-modded-0.NNN.10001` from the latest `master`, the merge commit as in
   the Rules, `version` `0.NNN.10001` without `publishConfig.tag`. Open the PR; the person merges it
   with "Create a merge commit", and it publishes on `master`.
2. threepipe: pin the released fork, release versions, PR `lane/rNNN` -> `dev`.
3. webgi: pin it, a release version, PR to `master`, release as webgi's CLAUDE.md says.
4. Close the other lanes' PRs.

## One-time setup (the first lane makes these as PRs)

- three.js-modded `create-release.yml`: also runs on `lane/r*`; there it publishes only a prerelease
  version that has a `publishConfig.tag` (release-tools passes that tag).
- threepipe `publish.yml`: also runs on `lane/r*`, one concurrency group per branch (not one shared
  `publish` group that cancels the others), the same prerelease-only check.
- threepipe `scripts/ci/publish-check.mjs`: check that the exact version is on npm
  (`npm view <pkg>@<version> version`), not `npm view <pkg> version` (that is only `latest`).
- threepipe `scripts/ci/publish-packages.mjs`: `--tag <publishConfig.tag>`, else `--tag next` for a
  prerelease.
- threepipe `examples/lane-lab/`: the lab page. An import map from the query
  (`https://cdn.jsdelivr.net/npm/threepipe@<v>/dist/index.mjs`, the plugins the same way;
  the threepipe build includes three), the editor setup from `examples/tweakpane-editor`, the webgi
  viewer from `releases.ijewel3d.com/libs/webgi-v0/viewer-<v>.js`, a list of test files, and a side by
  side mode. Deployed with the site from `master`, once.
- webgi: ijewel3d/webgi#86 (three from npm) merged. Its release workflow already accepts `-dev` tags
  from any branch.
