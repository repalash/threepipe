---
prev:
    text: '@threepipe/modelling-cli'
    link: './modelling-cli'

next:
    text: '@threepipe/plugin-cloud'
    link: './plugin-cloud'

aside: false
---

# @threepipe/modelling-mcp

An MCP server for the [modelling command API](./plugin-modelling). It drives the editor you have open,
through the agent socket - every step lands in its undo history - or, when no editor is connected, a
headless session it starts itself.

[Guide: Connect an agent](../guide/connect-an-agent) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/modelling-mcp/src/ModellingMcp.ts)

```bash
claude mcp add threepipe-modelling -- npx -y @threepipe/modelling-mcp
```

Claude Desktop and other clients: run `npx -y @threepipe/modelling-mcp` as a stdio server.

## Tools

Ten, generated from the command registry - schemas and descriptions are the commands' own:

| Tool | What |
| --- | --- |
| `run` | One command `{op, ...}` from the enabled groups |
| `batch` | Several, in order, stopping at the first failure unless `continueOnError` |
| `look` | An image (JPEG by default) plus a JSON description: views, cameras, objects in frame, highlighted elements |
| `measure` | Bounds, overlaps, topology (closed, winding, Euler characteristic, holes, area, volume) |
| `validate` | Blender's `BM_mesh_is_valid` port, and `spec` requirements - PASS / FAIL / UNVERIFIED with evidence |
| `diff` | What changed since a checkpoint, claimed vs collateral |
| `inspect` | Counts, bounds, and vertices, edges and faces by index |
| `export` | GLB/glTF with editable topology |
| `help` | Groups and commands, one command in full, where calls go, how to connect an editor |
| `enableToolGroup` | Add a group to `run` and `batch` (sends `tools/list_changed`) |

`run` starts with the `create`, `edit`, `shape` and `session` groups; the rest (`loop`, `cut`, `fill`,
`modifiers`, `scene`, `reference`, `import`) are a call away. A small surface chooses better than a
large one; nothing is out of reach. There is no code-execution tool.

Results are the command's JSON (`isError` when `ok` is false); `look` adds an image block.

## Connecting the editor

The server listens for editors on `ws://127.0.0.1:9396` (a free port if that is taken) and prints the
URL and a token on stderr. In the editor: **File > Connect Agent…**, paste both - or open it with
`?agent=<url>&agentToken=<token>`. The header then shows the agent and its last command. `help`
reports where calls go (`editor` or `headless`).

## Options

| Flag | Default | |
| --- | --- | --- |
| `--port` | `9396` | agent socket port |
| `--host` | `127.0.0.1` | `0.0.0.0` when the browser is on another machine or container |
| `--token` | random (or `THREEPIPE_AGENT_TOKEN`) | the secret editors present |
| `--headless` | `browser` | `node` needs no Chromium but cannot `look` |
| `--groups` | `create,edit,shape,session` | what `run` offers at start |
| `--editor-url` | | the editor URL, for the connect hint |

The headless browser is Playwright's Chromium (`npx playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`).

## As a library

```typescript
import {ModellingMcp, createMcpServer} from '@threepipe/modelling-mcp'
```

`ModellingMcp` is the routing and the tool list without a transport; `createMcpServer` puts it on an
MCP SDK `Server` for any transport.
