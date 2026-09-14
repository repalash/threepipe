# Claude Guidelines

- Do not fucking use `git stash` in this folder.
- Do not fucking use `git stash` in this folder.
- Do not fucking use `git stash` in this folder.
- Do not fucking use `git stash` in this folder.
- Do not fucking use `git stash` in this folder.
- Do not fucking use `git stash` in this folder.
- Do not fucking use `git stash` in this folder.
- Do not fucking use `git stash` in this folder.
- Do not fucking use `git stash` in this folder.
- Do not fucking use `git stash` in this folder.
- Understand when some task is complex and needs a subplan, make that and link in parent if and when required 
- Use only Opus agents
- Make sure no hacks, find the source of the problem and everything is tracked in plans or subplans
- Ask for approval before making any structural or architectural changes in the core
- Be smart, plan properly, dont go in circles 
- Do NOT guess that the issue is fixed without proper verification, you might be asked for proof of any claim made 
- Recognise when hallucinating or going around in circles without reason, and take a step back to see the context, understand the broader goals and plan next steps before proceeding 
- Before implementing a feature related to threepipe, three.js, start with research both yourself and using explore agents/subagents to learn about all patterns, flows we use in the framework and anything relevant to the task
- Do not spam build or run calls to get output, write to a file to grep for later if required
- threepipe can be used in node.js with polyfill, don't try to hack around it
- Always go through references like blender source code, three.js source code, shader libraries, github repos etc. Clone them as an when required in ./.repos/ to go through. Port exising implementation of maths functions instead of dessigning them on the fly or trying to reverse engineer. (when already available as open source)
- Keep the broader goal in mind as well when implementing subtasks, don't lose context
- Understand the intent behind user requests before diving into making implementation changes. Ask back ASAP when in any doubt. No question is stupid but some questions can be trivial/non-sense, always research first
- Brainstorm with the user instead of trying to one-shot the implementations, continue when everything is clear 
- Verify and think about everything the user says as well, sometimes the user is sharing ideas for brainstorm instead or instruction for implementation  
- Use subagents but always verify the work, subagents have a tendency to take the lazy path and lie about it or try to hack the parent agent to get away with partial work
- Subagent communication: When spawning a subagent for a long task, create a shared comm folder (e.g. `./tmp/agent-comm/<agent-name>/`). Put two files: `parent.md` (parent writes instructions, corrections, feedback) and `agent.md` (subagent writes progress updates, questions, blockers). The parent should tail `agent.md` every ~1 minute to monitor progress and write to `parent.md` if course correction is needed. The subagent should tail `parent.md` every ~1 minute to check for new instructions. Include this protocol in the subagent's launch prompt so it knows to use it
- Blender porting: ALWAYS port from Blender C++ source code. NEVER claim an algorithm "can't be reproduced in TS." If the source exists, port it exactly. Never pre-bake/hardcode output data as a shortcut — graphs must be reactive (changing inputs must change outputs)
- BufferGeometry and all three.js types are Node.js-safe with polyfill. The `/graph` subpath can export anything using three.js types. Only actual browser APIs (document, canvas, WebGL) are not Node-safe. Do NOT tell agents that three.js types can't be used in Node.js
- When spawning agents for Blender ports: reference skill.md, do NOT override its rules in the prompt. The skill says "port from Blender source" — follow it. Do NOT give agents permission to skip or approximate nodes — if something isn't ported, the agent must flag it as a blocker
- When reviewing agent work: verify ALL node trees are accounted for, not just instance counts. "0 instances in GT" means the tree produces geometry, not that it's optional
- If any issue is found in threepipe or its plugins, flag it in issues/open instead of handwaving it away
- Don't ignore or workaround any threepipe/three.js issue unless explicitly asked
- Repeat goals and tasks in message history when context is getting deep to reiterate and reflect on them
- Use sleep 60 as a background task and stop, when waiting for other background agents
- Always pick the "Correct" option, not the "Easy" one
- Never use `git stash` in this folder.
- tsx doesnt produce output with inline script, write to a file and execute that
- Assume subagent reports might be incorrect and inaccurate, verify them manually and redo if inaccuracies are found
- Do NOT remove any test, to test something, comment it temporarily and uncomment asap 
- three.js-modded source code is at ./three.js-modded/ - its a separate repository(not submodule)
- Always use the commands defined in package.json scripts (npm run ...), never ad-hoc equivalents (e.g. no raw `npx vite build` or `npx tsc` with guessed configs - they can pick the wrong tsconfig/mode). If a script needs a custom param (like running a specific test), still go through the script and pass the param, e.g. `npm run test:e2e -- --grep "example-name"`. If no script exists for something genuinely needed, add one instead of running ad-hoc commands

## Testing

- Unit tests: `npm run test:unit` (Vitest, runs in Node.js)
- E2E tests: `npm run test:e2e` (Playwright, requires Chromium)
- Interactive tests only: `npm run test:e2e:interactive`
- Update snapshots: `npm run test:e2e:update`
- Check coverage: `npm run check-test-coverage`
- **Test logs location**: Console logs for each example are at `tests/snapshots/<platform>/<example-name>/console.log` (platform is `chromium-darwin` on macOS, `chromium-linux` on Linux, etc.). Always check these when tests fail.
- To test a single example, run with a filter and small timeout instead of the full suite.
- Never hack around non-deterministic test failures. If an export or render produces different output across runs, that's a real bug to investigate and fix — not something to skip or weaken the assertion for. File it in issues/open

### Playwright on Alpine Linux (ARM64)

`npx playwright install chromium` downloads a glibc-linked binary that cannot run on musl. Use system Chromium + Mesa instead:

```bash
sudo apk add chromium mesa-gl mesa-egl mesa-gles
```

The `playwright.config.ts` auto-detects Alpine and switches flags:
- Alpine: `--enable-webgl --ignore-gpu-blocklist --use-gl=angle --use-angle=gl-egl` (ANGLE → Mesa EGL → llvmpipe)
- Standard: `--use-angle=swiftshader --enable-unsafe-swiftshader` (bundled SwiftShader)

System Chromium is auto-detected at `/usr/bin/chromium-browser`. Override with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` env var if needed

instanced
claude --resume c75d34a3-2306-4152-9768-7591463654ee

171 upgrade notes
claude --resume f9d30949-f409-4fa4-a0f9-09664d358a1c

168 debug depth diff rt preview
claude --resume 6addb37a-b12b-4a8b-86f6-3e1afb66a968                  
