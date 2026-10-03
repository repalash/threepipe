# CLAUDE.md — threepipe

threepipe is a 3D viewer framework on a modded three.js fork (`three` → `three-modded`, `@types/three` →
`three-types-modded`, wired through npm aliases). Core in `src/`, plugin packages in `plugins/*`, ~240 examples
in `examples/`, docs site in `website/`. See [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

> **HARD RULE — no git state changes in any checkout.** Never run `git stash`, `git checkout`, `git switch`,
> `git reset`, `git restore` or `git clean` in this folder, in `three.js-modded/`, `three-ts-types/`,
> `experiments/*`, `tests/snapshots/` or any worktree under `.repos/`. Other sessions work in the same
> checkouts and share the stash stack. Revert a change by editing the file back. Set work aside with a
> temporary commit on your own branch, never with a stash.
>
> **HARD RULE — never push to `master`.** Changes land through a branch and a pull request into `dev`.
> `master` is release-only; a push to `master` publishes to npm (`.github/workflows/publish.yml`).

> **Model gate.** Subagents run on Claude Fable (complex, multi-step work) or Claude Opus (simpler, bounded
> work). Never Sonnet, Haiku or smaller.

## Workflow — a worktree per task, a PR per change

- The main checkout (`/Users/palash/Projects/threepipe`) may be in use by another session. Do your work in a
  worktree under `.repos/` (`git worktree add -b <branch> .repos/<name> origin/dev`), one per task.
- Finish with a PR into `dev` (draft when the user says so). Push related follow-ups to the same PR instead
  of opening new ones. Give PRs as full URLs.
- GitHub access from the container: fine-grained PAT `GITHUB_TOKEN_THREEPIPE` in `.env.threepipe` (covers
  `repalash/threepipe` and `repalash/threepipe-webgi`). Pass it per command — `GH_TOKEN=… gh …` and
  `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push …` — never persist it, never
  put it in argv of a command that is logged. Commits in repos without a local identity: `git -c user.name=…
  -c user.email=…` with the values from this repo's config.
- Worktrees need their own `node_modules`; a symlink to another worktree's install works for `node_modules`
  only when both are on the same commit range. Plugin builds (`npm run build-plugins`) `npm ci` inside each
  plugin. `examples/.env` (gitignored, has `TP_EX_*` keys) must be copied into a worktree before
  `build-examples`, or the two Cesium examples fail to type-check.

## Commands — only `package.json` scripts

Always use the scripts (`npm run …`), never ad-hoc equivalents such as a raw `npx vite build` or `npx tsc`
with a guessed config; they pick the wrong tsconfig or mode. Pass parameters through the script
(`npm run test:e2e -- --grep "example-name"`). If a script is missing for something needed, add one.

- `npm ci` runs `prepare` = `build` + `build-plugins` + `build-examples` (20–30 min). `npm run build` alone
  rebuilds `lib/` and `dist/` (~5 min). Examples import the built `dist/`; `npm run vite` serves examples
  from source with aliases to plugin sources (no plugin build needed).
- `npm run serve` serves the built tree statically on 9229. Dev servers in the container must listen on
  `0.0.0.0` and are opened on the host as `http://<port>.$AIBOX_URL_BASE`.
- Long commands: write output to a file under `tmp/` and grep it; do not re-run builds to read their output.
  Background commands are stopped after 2 hours; start long servers detached (`nohup … &`).
- `tsx` prints nothing for inline scripts; write the script to a file and run that.

## Testing

- Unit: `npm run test:unit` (Vitest, Node). E2E: `npm run test:e2e` (Playwright + Chromium);
  `test:e2e:interactive`, `test:e2e:smoke`, `test:e2e:update` (regenerate baselines), `check-test-coverage`
  (every example has a test). The test skill: [`tests/SKILL.md`](tests/SKILL.md).
- `TEST_PORT=<port>` runs the suite against its own static server, so several checkouts can test side by
  side without reusing another checkout's server on 9229.
- Per-example console output is written to `tests/snapshots/<project>-<platform>/<example>/console.log`;
  read it when a test fails.
- Never hack around a non-deterministic failure: a render or export that differs across runs is a bug to
  find and fix (file it in `issues/open/`), not an assertion to weaken or a test to skip. To test something
  else temporarily, comment a test out and uncomment it right away; never delete a test.
- In this container Chromium renders WebGL on SwiftShader (software, arm64): slow, and heavy examples hit
  the screenshot timeouts even on an idle machine. Baselines generated here are not comparable with x64 CI.
  Use the host GPU browser (below) for visual checks, and A/B comparisons (build both refs, same machine,
  same browser) when judging a change.

## Host GPU browser (Palash's Mac) for WebGL runs

A Playwright browser server on the Mac renders on the real GPU (ANGLE Metal, Apple M4 Pro). Use it for
visual checks and A/B diffs instead of SwiftShader: `scripts/remote-browser/connect.mjs` connects, retries
while the server is down, and prints the renderer when run directly. Read
[`scripts/remote-browser/README.md`](scripts/remote-browser/README.md) first — the server has quirks
(a scratch Playwright client of exactly the server's version, a required `Host` header, a path that changes
per start, and **closing any page ends the browser for every client**). Ask the user to start it if
`/json` does not answer.

## Working with three.js and the fork

- `three.js-modded/` and `three-ts-types/` are separate repositories (not submodules) with the fork
  patches; `.repos/three.js` is stock upstream. Upstream tags `rNNN` are fetched into `three.js-modded`.
  Read them with read-only git; never touch their working trees.
- Before implementing anything in threepipe or three.js, research first: the existing patterns and flows in
  the framework (yourself and with explore subagents), then upstream three.js, Blender, shader libraries
  and reference repos — clone them under `.repos/` as needed. Port existing open-source implementations
  (maths, algorithms) instead of designing them on the fly or reverse-engineering.
- Blender ports: ALWAYS port from the Blender C++ source. Never claim an algorithm "can't be reproduced in
  TS"; if the source exists, port it exactly. Never pre-bake or hardcode output data — graphs stay reactive.
  When spawning agents for Blender ports, point them at the skill file and do not loosen its rules; what is
  not ported must be flagged as a blocker, not approximated. When reviewing, account for every node tree,
  not instance counts ("0 instances in GT" means the tree produces geometry, not that it is optional).
- threepipe runs in Node.js with the polyfill: `BufferGeometry` and all three.js types are Node-safe; only
  browser APIs (document, canvas, WebGL) are not. The `/graph` subpath may export anything using three.js
  types. Do not tell agents otherwise, and do not hack around Node support.
- webgi plugin sources for compatibility checks: `experiments/threepipe-webgi` (current, repo
  `repalash/threepipe-webgi`) and `experiments/webgi-legacy-src` (legacy webgi, must keep working with
  the fork).

## How to work

- Understand the intent before changing code; the user often shares ideas to brainstorm rather than
  instructions to implement. Ask early when in doubt — after researching, so the question is not trivial.
  Brainstorm, then implement when everything is clear. Verify what the user says too.
- Plan properly: a complex task gets a plan (or a subplan linked from the parent) in `issues/open/`, and
  every finding is tracked there. Keep the broader goal in view while doing subtasks; when the context is
  deep, restate goals and status.
- No hacks: find the source of a problem. Pick the correct option, not the easy one. Ask for approval
  before structural or architectural changes in the core.
- Do not guess that something is fixed. Verify, and keep the proof (command output, screenshots, diffs) —
  you may be asked for it. When you notice you are going in circles or hallucinating, stop, re-read the
  goals, and re-plan.
- Any issue found in threepipe or a plugin is filed in `issues/open/` instead of being worked around or
  waved away. Do not ignore or work around a threepipe/three.js issue unless told to.
- Decide, recommend, act: when a decision is the user's, give the context first, then ask with the question
  tool, one decision at a time.

## Subagents

- Verify every report: subagents take the lazy path, report partial work as done, and misstate what they
  verified. Re-check claims against files, commands and the browser; redo work that is wrong.
- Long tasks use a comm folder `./tmp/agent-comm/<agent-name>/` with `parent.md` (parent writes
  instructions and corrections) and `agent.md` (agent writes progress, questions, blockers). Both sides
  re-read the other file about every minute of work. Put this protocol in the launch prompt. The harness
  may refuse a subagent writing a `report.md`; have it return the report as text and save it yourself.
- While waiting for background agents, run `sleep 60` as a background task and stop; do not poll.

## Tracking and notes

- `issues/open/` (gitignored, local) holds plans, subplans, research and issue notes; `issues/working/`,
  `issues/verify/`, `issues/resolved/` follow the state. Name files `<topic>-<kind>.md`.
- `tmp/` is gitignored scratch (logs, A/B output, agent comm). `.env.threepipe` and `.env.snapshots-r2`
  hold credentials (0600) and are never committed or printed.
- Changelog entries go in the same PR as the change (`CHANGELOG.md` at the root, or the plugin's).
