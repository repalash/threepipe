# @threepipe/modelling-mcp

An MCP server for threepipe's modelling command API. It drives the editor you have open - through the
agent socket, so every step lands in its undo history - or, when no editor is connected, a headless
session it starts itself.

```bash
claude mcp add threepipe-modelling -- npx -y @threepipe/modelling-mcp
# from a threepipe checkout, after `npm run build:modelling-cli && npm run build:modelling-mcp`:
claude mcp add threepipe-modelling -- node /path/to/threepipe/plugins/modelling-mcp/dist/server.mjs
```

On start it prints (on stderr) the agent socket's URL and token. Open the modelling editor with
`?agent=ws://127.0.0.1:9396&agentToken=<token>`, or use File > Connect Agent… and paste them; the header
shows the agent's status and last command. Ask the agent to call `help` to see where commands run.

## Tools

Ten, generated from the command registry - schemas and descriptions are the commands' own:

| Tool | What |
| --- | --- |
| `run` | One command `{op, ...}` from the enabled groups (default `create`, `edit`, `shape`, `session`) |
| `batch` | Several, in order, stopping at the first failure unless `continueOnError` |
| `look` | Render (front/right/top/iso sheet by default) - an image plus a JSON description of what is in it |
| `measure` | Bounds, overlaps, topology (closed, winding, Euler, holes, area, volume) |
| `validate` | Blender's `BM_mesh_is_valid` port and `spec` checks: PASS / FAIL / UNVERIFIED with evidence |
| `diff` | What changed since a checkpoint, claimed vs collateral |
| `inspect` | Counts, bounds, vertices, edges and faces by index |
| `export` | GLB/glTF, with editable topology kept |
| `help` | Groups, commands, where commands run, how to connect an editor |
| `enableToolGroup` | Add a group (`loop`, `cut`, `fill`, `modifiers`, `scene`, `reference`, `import`, ...) to `run` |

No code execution, no `eval`: everything is a command, validated before it runs and undoable after.

## Options

`--port 9396` agent socket port (a free one if taken) · `--host 127.0.0.1` (use `0.0.0.0` when the
browser is on another machine) · `--token <t>` (default random; or `THREEPIPE_AGENT_TOKEN`) ·
`--headless browser|node` (`node` needs no Chromium but cannot `look`) · `--groups create,edit,...` ·
`--editor-url <url>` for the connect hint.

The headless browser is Playwright's Chromium (`npx playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`).

See also `@threepipe/modelling-cli` (the same commands from a shell) and the
[Connect an agent](https://threepipe.org/guide/connect-an-agent.html) guide.
