---
prev:
    text: '@threepipe/plugin-modelling-editor'
    link: './plugin-modelling-editor'

next:
    text: '@threepipe/modelling-mcp'
    link: './modelling-mcp'

aside: false
---

# @threepipe/modelling-cli

`threepipe-modelling`: the [modelling command API](./plugin-modelling) from a shell. Every verb prints
exactly one JSON object on stdout, so an agent with a terminal can drive it without an MCP client.

[Guide: Connect an agent](../guide/connect-an-agent) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/modelling-cli/src/index.ts)

```bash
npm i -g @threepipe/modelling-cli     # or npx threepipe-modelling ...
```

## Verbs

| Verb | Does |
| --- | --- |
| `run <cmd.json \| transcript.json \| - \| '{...}'>` | Run commands in order (stops at the first failure unless `--continue-on-error`): `{ok, ran, failed, results, saved}` |
| `session <build.mjs>` | Run a build script `export default async ({run, runAll, look, inspect, log}) => {...}`; writes `transcript.json` and the looks to `--out-dir` |
| `look [params]` | Render (front/right/top/iso by default) to `--out` (`look.jpg`) and describe it |
| `measure`, `validate`, `diff`, `inspect` `[params]` | The command of that name |
| `export --out <file.glb>` | Write the document |
| `import <file>` | Add a GLB/glTF/OBJ/STL as editable objects |
| `help [op]` | The verbs and commands, or one command's parameters |
| `relay` | Serve the agent socket for live editors; prints `{url, token, pageQuery}` and keeps running |

Parameters go as a JSON argument (`validate '{"object":"hull"}'`) or as flags (`--object hull --spec
'{"volume":8}'`; a flag's value is read as JSON when it parses). Failures are `{ok: false, error, hint}`
with a non-zero exit code; `hint` carries the registry's "did you mean".

## State in a file

```bash
threepipe-modelling run '{"op":"primitive","type":"cube","name":"box","size":2}' --doc part.glb
threepipe-modelling run '{"op":"extrude","object":"box","faces":[0],"distance":0.5}' --doc part.glb
threepipe-modelling inspect --object box --detail true --doc part.glb
```

`--doc` loads the document before the verb and writes it back after one that changed something
(`--out` writes elsewhere, `--no-save` not at all). The GLB carries the exact n-gon topology and the
modifier stack in `THREEPIPE_mesh_topology`, so indices and modifiers survive between calls.

## Where commands run

- **Node** (default): a real `ThreeViewer` on threepipe's Node stubs (`DummyRenderManager`), no browser
  and no WebGL. Every command that does not draw.
- **Headless browser** (`look`, or `--browser`): the bundled session page in Playwright's Chromium,
  driven over the agent socket. Install a browser with `npx playwright install chromium`, or set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
- **Live editor** (`--connect [ws://127.0.0.1:9396] --token <t>`): through a running relay into the
  editor you have open; its steps land in that editor's undo history. `--page` picks one of several.

## As a library

```typescript
import {NodeSession, BrowserSession, AgentRelay, RelayClient} from '@threepipe/modelling-cli'

const s = new NodeSession({documentId: 'build'})   // same id -> same UUIDs -> same file on replay
await s.run({op: 'primitive', type: 'cube', name: 'box'})
const glb = await s.exportGlb()

const b = await BrowserSession.start()             // pixels: look, capture
const look = await b.run({op: 'look', path: 'look.jpg'})
await b.close()
```

`@threepipe/modelling-cli/relay` (the `relay.mjs` entry) is the agent socket alone, without threepipe.
