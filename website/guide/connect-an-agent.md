---
prev:
    text: 'Modelling'
    link: './modelling'

next:
    text: 'Material Extension'
    link: './material-extension'
---

# Connect an agent

An AI agent - Claude Code, Claude Desktop, any MCP client, or a script - builds and edits geometry
through the same JSON commands a person's editor runs (`{op: 'inset', object: 'hull', faces: [3]}`).
Three doors lead to them; pick by where the agent lives.

| Door | For | Where commands run |
| --- | --- | --- |
| [MCP server](#mcp) | Claude Code, Claude Desktop, MCP clients | the editor you have open, else a headless session |
| [CLI](#cli) | agents with a shell; scripts; CI | a Node session on a GLB file, a headless browser for renders, or `--connect` to an editor |
| [Agent socket](#agent-socket) | anything that can open a WebSocket | the editor page, live |

Whichever door: every mutating command is one undo step and reports `locality` (what it changed, and
anything it changed outside what it named); a failed command changes nothing and says why, with a
"did you mean" for names; there is no code execution - nothing an agent can do that a person could not
type into the editor's console.

## The workflow

1. **Build** - `primitive`, `lathe`, `sweep`, then `extrude`, `inset`, `bevel`, `vertices`, modifiers.
2. **Measure** - `measure`, `inspect` (indices of vertices, edges and faces).
3. **Validate** - `validate`: a port of Blender's `BM_mesh_is_valid`, and a `spec` of the dimensions
   you were given. `PASS` / `FAIL` / `UNVERIFIED`, never vacuously true.
4. **Look** - `look`: an auto-framed front / right / top / iso sheet, *and* a description of what is in
   each view. `highlight` shows an index before an edit spends it.
5. **Export** - a GLB; editable topology rides along, so it opens editable again.

The generated [skill](https://github.com/repalash/threepipe/blob/master/skills/threepipe-modelling/SKILL.md)
holds this workflow, the rules learned from real builds, a tested cookbook and the command reference.

## MCP

```bash
claude mcp add threepipe-modelling -- npx -y @threepipe/modelling-mcp
```

Ten tools: `run`, `batch`, `look`, `measure`, `validate`, `diff`, `inspect`, `export`, `help`,
`enableToolGroup`. `run` takes any command of the enabled groups (create, edit, shape and session to
start with); `enableToolGroup` adds a group (loop, cut, fill, modifiers, scene, reference, import, ...)
and the client is told the tool list changed. Schemas are the commands' own.

With no editor connected, calls go to a headless browser page the server starts. To work in your own
editor, connect it to the server's agent socket: the server prints its URL and token on stderr (ask the
agent to call `help` - it reports them, and where calls are going). See
[@threepipe/modelling-mcp](../package/modelling-mcp).

The repository is also a Claude Code plugin (skill + MCP server):

```text
/plugin marketplace add repalash/threepipe
/plugin install threepipe-modelling@threepipe
```

## CLI

```bash
npx threepipe-modelling run '{"op":"primitive","type":"cube","name":"hull","width":2.44,"height":0.85,"depth":6.77}' --doc tank.glb
npx threepipe-modelling validate --doc tank.glb --object hull --spec '{"bbox":{"size":[2.44,0.85,6.77]}}'
npx threepipe-modelling look --doc tank.glb --out tank.jpg
```

Each verb prints exactly one JSON object; failures are `{ok: false, error, hint}`. `--doc` loads the
document from a GLB and writes it back after a change, so a sequence of calls is a sequence of edits.
See [@threepipe/modelling-cli](../package/modelling-cli).

## Agent socket

The editor connects *out* to a relay - a page cannot accept connections - and runs every command it
receives through `ModellingPlugin.run`, so the agent's steps appear in the editor's undo history as
they happen, and Ctrl+Z undoes them like your own.

```bash
npx threepipe-modelling relay            # prints {url, token, pageQuery}
```

Then in the editor, **File > Connect Agent…** and paste the URL and token - or open it with
`?agent=ws://127.0.0.1:9396&agentToken=<token>`. A header indicator shows the connected agents and
their last command; the Agent dialog lists their recent commands and opens the agent's last `look`.
The MCP server embeds the same relay, so connecting the editor to it is the same two fields.

Drive it from code with the CLI's client:

```typescript
import {RelayClient} from '@threepipe/modelling-cli'
const agent = new RelayClient('ws://127.0.0.1:9396', token, 'my-agent')
await agent.connect()
await agent.run({op: 'primitive', type: 'cube', name: 'box'})
```

Messages are JSON: the page sends `hello` with the token, the relay forwards `{type: 'call', id,
command}` and the page answers `{type: 'result', id, result}` - always a `CommandResult`, errors
included. A wrong token closes the socket (4001) before anything else; a call whose page disconnects
fails at once rather than timing out.

In a page of your own, add the plugin next to `ModellingPlugin`:

```typescript
import {AgentSocketPlugin, ModellingPlugin} from '@threepipe/plugin-modelling'
viewer.addPluginSync(ModellingPlugin)
const socket = viewer.addPluginSync(AgentSocketPlugin)   // connects from ?agent=…&agentToken=…
socket.addEventListener('agentCommand', ({command, result}) => console.log(command.op, result.ok))
```

## Replays

A transcript - what `threepipe-modelling session` writes, or any list of commands - replays to the
same model: `npx threepipe-modelling run transcript.json --doc out.glb`, or in the editor with the
[replay example](https://threepipe.org/examples/#modelling-replay/), where every step lands in the undo
history. A model export (`export {viewerConfig: false, uuids: false}`) of the same transcript is
byte-identical.
