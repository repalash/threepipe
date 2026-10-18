# @threepipe/modelling-cli

`threepipe-modelling`: threepipe's [modelling command API](../modelling/README.md) from a shell. An agent (or a
script) drives the model with JSON commands `{op, ...params}`, and every verb prints exactly one JSON object on
stdout, so anything with a terminal can use it without an MCP client. Diagnostics go to stderr.

The commands run in one of three places: a headless Node session (no browser, no WebGL), a headless Chromium
page for the ones that draw, or a live editor you have open, through the agent socket.

```bash
npm i -g @threepipe/modelling-cli     # or: npx threepipe-modelling <verb> ...
# from a threepipe checkout:
npm run build:modelling-cli && npm run modelling -- help
```

Node 20 or later.

## Verbs

| Verb | Does |
| --- | --- |
| `run <cmd.json \| transcript.json \| - \| '{...}'>` | Run commands in order, stopping at the first failure unless `--continue-on-error`. Prints `{ok, ran, of, failed, results, saved}` |
| `session <build.mjs>` | Run a build script `export default async ({run, runAll, look, inspect, log}) => {...}`; writes `transcript.json` and the looks to `--out-dir` (default `modelling-session`) |
| `look [params]` | Render (an angles sheet by default) to `--out` (default `look.jpg`) and describe what is in it. Needs `--doc` or `--connect` |
| `measure`, `validate`, `diff`, `inspect` `[params]` | The command of that name |
| `export --out <file.glb>` | Write the document |
| `import <file.glb\|gltf\|obj\|stl>` | Add a model to the document as editable objects |
| `help [op]` | The verbs and commands, or one command's parameters |
| `relay [--port 9396] [--host 127.0.0.1] [--token t]` | Serve the agent socket for live editors; prints `{url, token, pageQuery}` and keeps running |

`run` reads a single command, an array, JSON lines, or a transcript (`{operations: [{command}, ...]}`, what
`session` writes), from a file, from stdin (`-`) or inline.

Parameters go as one JSON argument (`measure '{"mode":"topology"}'`) or as flags (`--object box`); a flag's value
is read as JSON when it parses (`--spec '{"volume":8}'`), as a string otherwise. A failure is
`{ok: false, error, hint}` with exit code 1; `hint` carries the "did you mean" for a misspelt verb, command or
parameter, or the next thing to try. `--pretty` indents the output.

## Keeping state in a file

Each call is a fresh process. `--doc model.glb` loads the document before the verb and writes it back after one
that changed something (`run --out` writes elsewhere, `--no-save` not at all). The GLB carries the n-gon
topology and the modifier stack in `THREEPIPE_mesh_topology`, so indices and modifiers survive between calls.

```bash
threepipe-modelling run '{"op":"primitive","type":"cube","name":"box","size":2}' --doc part.glb
threepipe-modelling run '{"op":"extrude","object":"box","faces":[0],"distance":0.5}' --doc part.glb
threepipe-modelling inspect --object box --doc part.glb
threepipe-modelling validate --doc part.glb --object box --spec '{"manifold":{"closed":true},"counts":{"faces":10}}'
threepipe-modelling measure '{"mode":"topology"}' --doc part.glb
threepipe-modelling export --doc part.glb --out copy.glb
threepipe-modelling look --doc part.glb --out look.jpg
```

A misspelt command fails and stops the run:

```bash
threepipe-modelling run '[{"op":"primitive","type":"cube","name":"c"},{"op":"bevl","object":"c"}]'
# {"ok":false, ..., "error":"unknown op \"bevl\" ...", "hint":"did you mean \"bevel\"?"}
```

## Build scripts

```js
// build.mjs
export default async ({run, inspect, log}) => {
    await run({op: 'primitive', type: 'cube', name: 'hull', size: 2})
    await run({op: 'inset', object: 'hull', faces: [0], thickness: 0.2})
    log('inset done', (await inspect('hull')).faces)
}
```

```bash
threepipe-modelling session build.mjs --out-dir out
# {"ok":true,"commands":3,"failed":0,"looks":[],"transcript":".../out/transcript.json",...}
```

`look(label, params)` in a script writes numbered images (`001-<label>.jpg`) next to the transcript; a script
that calls it needs `--browser` or `--connect` (a Node session cannot render). The same commands replayed with the
same document id (`--document-id`, default the `--doc` file's name) give a byte-identical model GLB
(`tests/replay-determinism.test.ts`).

## Where commands run

- **Node** (default): a real `ThreeViewer` on threepipe's Node stubs, with no browser and no WebGL. Every
  command that does not draw runs here.
- **Headless browser** (`look`, or `--browser` for any verb): the bundled session page in Playwright's
  Chromium, driven over an agent socket of its own. Install a browser with `npx playwright install chromium`
  or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; `--ws <endpoint>` uses a running Playwright browser server
  instead, `--headed` shows the window, `--width` / `--height` size the viewport (1000 x 700).
- **Live editor** (`--connect [ws://127.0.0.1:9396] --token <t>`): through a running relay into the editor you
  have open. Commands land in that editor's undo history. `--page <id>` picks one of several connected pages.
  `--doc` and `--connect` do not mix: the editor holds its own document.

## Connecting a live editor

```bash
threepipe-modelling relay
# {"ok":true,"url":"ws://127.0.0.1:9396","token":"…","pageQuery":"agent=…&agentToken=…",
#  "env":{"THREEPIPE_AGENT_URL":"…","THREEPIPE_AGENT_TOKEN":"…"}, ...}
```

Open the modelling editor with `?<pageQuery>`, or use **File > Connect Agent…** and paste the URL and token. Then,
from another shell:

```bash
export THREEPIPE_AGENT_TOKEN=<token>          # or pass --token each time
threepipe-modelling run '{"op":"primitive","type":"cube","name":"box"}' --connect
threepipe-modelling look --connect --out look.jpg
```

`--connect` without a URL uses `THREEPIPE_AGENT_URL`, then `ws://127.0.0.1:9396`. The token defaults to
`THREEPIPE_AGENT_TOKEN` (a random one when the relay is started without either). Use `--host 0.0.0.0` when the
browser is on another machine or container.

## As a library

```typescript
import {NodeSession, BrowserSession, EditorSession, AgentRelay, RelayClient} from '@threepipe/modelling-cli'

const s = new NodeSession({documentId: 'build'})   // same id, same UUIDs, same file on replay
await s.run({op: 'primitive', type: 'cube', name: 'box'})
const glb = await s.exportGlb()
s.dispose()

const b = await BrowserSession.start()             // pixels: look, capture
await b.run({op: 'look', path: 'look.jpg'})
await b.close()

const e = await EditorSession.connect({token})     // a live editor through a running relay
```

Import the package before anything else that imports `threepipe` in Node: it installs the DOM stubs threepipe
needs. `@threepipe/modelling-cli/relay` is the agent socket alone (`AgentRelay`, `RelayClient`), without
threepipe. The package also re-exports `PARTS`, `PRODUCT_PARTS` and the print layouts from
[`@threepipe/modelling-parts`](../modelling-parts/README.md), for build scripts that write `part` and `decal`
commands.

## See also

- [`skills/threepipe-modelling/SKILL.md`](../../skills/threepipe-modelling/SKILL.md): the agent skill, generated
  from the command registry by `npm run modelling:skill` (workflow, rules, a tested cookbook and every command).
- [`@threepipe/modelling-mcp`](../modelling-mcp/README.md): the same commands as MCP tools, for clients that
  speak MCP.
- [Connect an agent](https://threepipe.org/guide/connect-an-agent.html).

## Licence

Apache-2.0
