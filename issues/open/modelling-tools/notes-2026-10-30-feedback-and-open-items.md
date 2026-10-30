# Feedback answers and open items (2026-10-30)

## Twitter replies (chess piece video)

**"Keen to see how edit-mode ops map to prompts."**
- Reply: every edit-mode op is a JSON command with Blender's own parameters.
- A skill file maps intents to commands, so a prompt becomes a replayable, undoable command list.
- Follow-up: post a clip of one prompt next to the commands it produced.

**"Can it revisit an earlier instruction after later topology edits?"**
- Reply: partly. The build is a command log you can edit and replay.
- Commands pick faces by index.
- Changing an inset width replays fine (the face count stays the same).
- An earlier change that adds faces shifts what later steps select (topological naming).
- Follow-up: add this test to the edit-chain harness (change step k, replay, check later steps).
- Follow-up: let commands select by query or tag (made by step N, facing +y, region), not only by index.

## Why 155 min and "98M tokens" for the rook

- The rook is 30 commands. Rebuilding it from the script takes 38 s.
- The 155 min was the agent's whole session, mostly not modelling:
  - reading the code
  - building a scoring harness for 120 steps
  - fixing 3 undo bugs and adding primitive UVs
  - browser runs that died under memory pressure
  - waiting for a browser shared by 6 agents, on software rendering
- "98M" was a counting bug (each message counted 1.5–1.8x). The real figure is 179k output / 57M input.
- The 1M context window is right. The biggest single call was 473k.
- Input is counted on every call. Each call re-reads the conversation, mostly from cache.
- 169 calls × ~330k average ≈ 57M.

Corrected figures (output / input):

| Demo | Output | Input |
|---|---|---|
| edit-chain (rook) | 179k | 57M |
| stair | 179k | 104M |
| haussmann | 240k | 81M |
| camera | 147k | 76M |
| walkthrough | 217k | 105M |

The demo pages and the status page are fixed (commit d43a6de4, not pushed yet).

## Why the others took hours

- Same pattern: the agents built tooling and fixed bugs as they went.
- Every browser check cost about 8 min of overhead.
- Rebuilding any demo from its saved script takes 1–5 s.

## Stair "realism pass"

- You're right: almost nothing visible changed.
- What changed visibly: the background, the stair going white → black, and faint floor joints.
- The stone relief is too fine to see. The lighting is the same.
- To do: reword the page; don't call it a realism pass.

## Haussmann: needs a new approach

- It's a massing model. The storey and bay counts are right.
- Missing next to the photo:
  - window surrounds, pediments, consoles
  - rusticated stone, deep cornices
  - curved, ribbed zinc mansard
  - real windows (ours are black holes), the shopfront
  - limestone colour, sun and shadow
- 400 low-level commands typed by an agent won't get there.

Plan:
1. A parametric facade generator: a spec of storeys, bays, window types, balconies, cornices and roof.
2. A parts library: window surround, console, cornice profile, mansard, French window, railing.
3. Port the webgi worlds `FacadeSpec`, profile sweeps and openings.
4. Look-dev defaults: sun and shadows, AO, environment light, limestone and zinc materials.
5. A fast loop: build in Node in seconds, plus one GPU frame per check.
6. Target: Haussmann close to the photo in under 15 min, with time and tokens recorded.
7. Then the agent writes about 50 lines of spec instead of 400 commands.

## dsh-blender-plugin: ideas to take

- Repo: github.com/sixtysevenlf/dsh-blender-plugin (BSD-3; its skill is MIT).
- Its skill is merged from RobLe3/cc-blender-skill and arjun988/blender-skills. Look at those too.
- Ideas:
  - Choose the method by shape type (faceted / smooth hard surface / organic / array / boolean).
  - Freeze one spec before building.
  - Declarative blockouts.
  - Parametric surfaces (loft, sweep along a rail, 4-sided patch) with curvature and thickness checks. We lack these.
  - Assembly audit: clashes, floating parts, gaps.
  - Same-camera render vs. reference, with a pass / fail / degraded verdict before delivery.

## threepipe-cloud

- Built in this session: `@threepipe/plugin-cloud` (feedback dialog, toasts, redaction, Turnstile, shares) and `services/cloud` (Worker + D1 + R2).
- Split out of #52 into its own PR, #104. Then #104 was closed (2026-10-30).
- It is being redone on teenybase, in the threepipe-main session.
  - Sign-in, uploads with permalinks, agent links, and a support platform.
  - The #104 dialog, toasts, redaction and Turnstile get ported into the new `@threepipe/plugin-cloud`.
- The `cloud` branch stays on GitHub as a reference.
- The modelling editor finds the cloud plugin by name (`cloudOps.ts`) and does nothing without it.
- When the new plugin API is fixed, update `cloudOps.ts` to match.
- No join PR (editor feedback example, e2e, .env wiring) until then.

## Left open

Needs you:
- Refresh `GITHUB_TOKEN_THREEPIPE` (expired, so commit d43a6de4 isn't pushed).
- PR #52 final check (modelling-editor → dev).
- Review #47, #48, #54.
- #49 waits for the three.js-modded #3 release.
- webgi #85; webgi #86 (apply its release.yml edit first).
- After #38: push the screenshot baselines (`npm run test:e2e:push`).
- Decide on a vertex-group store in the kernel (Buildify's last gap). I recommend yes.
- Decide: primitive UVs on by default?
- Optional: the read-only Cloudflare login for a full infra list.

Next work (mine):
- Haussmann rethink (plan above).
- Reword the stair "realism pass" page.
- Topological-naming test, and selection by query or tag.
- Twitter follow-up clip (prompt → commands).

Smaller follow-ups (issue files in issues/open):
- Split `MeshEditPlugin.ts` (156 KB).
- `light` command: no shadow-camera size.
- Edit-chain issues: display material overwrites colour; export not deterministic; transform range schema.
- Extensionless imports in 2 old examples on dev (monkey-type-3d, tweakpane-editor). Needs a core PR.
- e2e against a cold vite server can time out on the first run.
- Geometry nodes still to port: UV Unwrap (needs Eigen SparseLU), Simulation zone, volumes, the remaining small nodes.
- Boolean drops custom normals.
- Leave as is: BMesh mempool order (structural; recommended to leave).
