# Playwright config pins the static server to port 9229 and reuses whatever is there

`playwright.config.ts` hard-codes `baseURL: 'http://127.0.0.1:9229'` and a `webServer` of
`npm run serve` (`ws -d . -p 9229`) with `reuseExistingServer: !process.env.CI`.

## Why it is a problem

Several worktrees are often checked out side by side (`.repos/threepipe-*`), and their sessions run
at the same time. If one of them already serves 9229, a test run in another worktree silently uses
that server, and so tests *that* worktree's build. There is no way to change the port without editing
the config:
- `npm run serve -- -p 9300` fails, because `ws` rejects a second `-p`
  (`ALREADY_SET: Singular option already set [port=9229]`).
- No environment variable is read.

## Repro

In worktree A, `npm run serve`. In worktree B, `npm run test:e2e -- --grep modelling-api`. B's run
passes or fails according to A's `dist`.

## Workaround used

The Eiffel session ran e2e through a local, uncommitted config that imports this one and overrides
`use.baseURL` and `webServer` (port 9352).

## Suggested fix

Read the port from an environment variable, for example `PLAYWRIGHT_PORT` defaulting to 9229, and
have `serve` take it too. This is test infrastructure, so it needs a maintainer decision.
