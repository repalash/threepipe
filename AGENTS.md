# Claude Guidelines

- We have to make the most easy to use 3d framework for everyone.
- Understand when some task is complex and needs a subplan, make that and link in parent if and when required 
- Use only Opus agents
- Make sure no hacks, find the source of the problem and everything is tracked in plans or subplans
- Ask for approval before making any structural or architectural changes in the core
- Be smart, plan properly, dont go in circles 
- Do NOT guess that the issue is fixed without proper verification, you might be asked for proof of any claim made 
- Recognise when hallucinating or going around in circles without reason, and take a step back to see the context, understand the broader goals and plan next steps before proceeding 
- Before implementing a feature related to threepipe, three.js, start with research both yourself and using explore agents/subagents to learn about all patterns, flows we use in the framework and anything relevant to the task
- threepipe can be used in node.js with polyfill
- Always go through references like blender source code, three.js source code, shader libraries, github repos etc. Clone them as an when required in ./.repos/ to go through. Port exising implementation of maths functions instead of dessigning them on the fly or trying to reverse engineer. (when already available as open source)
- Keep the broader goal in mind as well when implementing subtasks, don't lose context
- Understand the intent behind user requests before diving into making implementation changes. Ask back ASAP when in any doubt. No question is stupid but some questions can be trivial/non-sense, always research first
- Brainstorm with the user instead of trying to one-shot the implementations, continue when everything is clear 
- Verify and think about everything the user says as well, sometimes the user is sharing ideas for brainstorm instead or instruction for implementation  
- Use subagents but always verify the work, subagents have a tendency to take the lazy path and lie about it or try to hack the parent agent to get away with partial work
- If any issue is found in threepipe or its plugins, flag it in issues/open, and/or make a PR, instead of handwaving it away
- Any useful report you get (from research, subagent research, debugging) that is not in the docs, ask to make PRs for those
- Don't ignore or workaround any threepipe/three.js issue unless explicitly asked
- Repeat goals and tasks in message history when context is getting deep to reiterate and reflect on them
- Always pick the "Correct" option, not the "Easy" one
- Never use any git operations that make any changes (stash, etc) in the main checkout folder unless explicitly asked.
- Codex might review PRs, other code, check for it and make fixes and review them before pushing to avoid getting stuck in a fix-review loop.
- Assume subagent reports might be incorrect and inaccurate, verify them manually and redo if inaccuracies are found
- Work in worktrees in .claude unless required/asked to edit the main copy.
- three.js-modded source code is at ./three.js-modded/ - its a separate repository(not submodule), clone it if its not there.
- Always use the commands defined in package.json scripts (npm run ...), never ad-hoc equivalents (e.g. no raw `npx vite build` or `npx tsc` with guessed configs - they can pick the wrong tsconfig/mode). If a script needs a custom param (like running a specific test), still go through the script and pass the param, e.g. `npm run test:e2e -- --grep "example-name"`. If no script exists for something genuinely needed, add one instead of running ad-hoc commands

## threepipe cloud

- threepipe cloud is at https://cloud.threepipe.org (worker in `services/cloud`, client plugin `@threepipe/plugin-cloud`, infra and runbook in `CLOUDFLARE.md`).
- Share files while working (renders, screenshots, reports, html pages) to get a quick link: `scripts/share.sh [-s slug] [-P dir] file...` prints the share URL (`TP_SHARE_TOKEN` in `.env`). Reuse the same slug to update a share in place. `-a` uploads write-once assets.
- Feedback and problem reports sent from apps (Report a Problem, `examples/cloud-feedback`) are on the staff page https://cloud.threepipe.org/staff. Check it when working on a reported issue.

## Testing

- Unit tests: `npm run test:unit` (Vitest, runs in Node.js)
- E2E tests: `npm run test:e2e` (Playwright, requires Chromium)
- Interactive tests only: `npm run test:e2e:interactive`
- Update snapshots: `npm run test:e2e:update`
- Check coverage: `npm run check-test-coverage`
- **Test logs location**: Console logs for each example are at `tests/snapshots/<platform>/<example-name>/console.log` (platform is `chromium-darwin` on macOS, `chromium-linux` on Linux, etc.). Always check these when tests fail.
- To test a single example, run with a filter and small timeout instead of the full suite.
- Never hack around non-deterministic test failures. If an export or render produces different output across runs, that's a real bug to investigate and fix — not something to skip or weaken the assertion for. File it in issues/open
