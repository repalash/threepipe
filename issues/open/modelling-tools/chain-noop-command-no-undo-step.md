# A mutating command that changes nothing pushes no undo step, so the next `undo` undoes the command before it

**Status: fixed on `demo-edit-chain` (f58e33b)**, by the parent's chosen rule: a mutating command that
leaves every object it recorded exactly as it was pushes no undo step, keeps redo, and returns
`ok: true, changed: false` (`changed: true` when it pushed a step; absent on read-only commands) -
Blender's rule for an operator that returns `CANCELLED`. `ModellingHistory.push` decides by comparing
each recorded object's after-snapshot with its before-snapshot (`snapshotsEqual`, exact), so every
command gets it, including ones that record and then change nothing (`material` with the colour it
already has, a zero `transform`). Tests: `plugins/modelling/tests/undo-fidelity.test.ts`,
`src/history.test.ts`. Note the deliberate difference from `MESH_OT_remove_doubles`, which returns
`FINISHED` and so does push a (no-op) step in Blender - see below. The `modifier` listing is still
flagged `mutates` in `help`; it now reports `changed: false`, but a separate read-only command would be
cleaner.

**Found by**: the edit-chain harness (`demos/edit-chain`, steps `bevel-02`, `hazard-01`, `hazard-02`, `hazard-03`).
**Severity**: high for agents. An agent's "try it, look, undo" loop silently reverts the wrong command.

## Repro

```js
await run({op: 'primitive', type: 'grid', name: 'sheet', xSegments: 2, ySegments: 2})
await run({op: 'bevel', object: 'sheet', edges: [0], segments: 3})   // a boundary edge: declined, warning
await run({op: 'undo'})
// expected: the bevel is undone (a no-op), the sheet is still there
// observed: the *primitive* is undone - the sheet is gone
```

The same with every mutating command that can finish without calling `setMesh`/`record`:

| command | no-op case |
| --- | --- |
| `weld` | nothing within `distance` (`edit.ts`, `if (!result.merged) continue`) |
| `mergeByDistance` | nothing within `threshold` (`fill.ts`, `if (!result.removed) ctx.warn(...)`) |
| `bevel` | only boundary / non-manifold edges given (`shape.ts`, early return) |
| `modifier` | called with only an object: the read-only listing path, but `help` reports `mutates: true` |

`ModellingPlugin._run` only records a history entry when the document recorded something
(`ModellingHistory.push` returns `null` for an empty `before`), so these commands leave no entry and
`undo` walks one further back.

## Expected (Blender)

Every operator flagged `OPTYPE_UNDO` that returns `OPERATOR_FINISHED` pushes an undo step, whether or
not it changed anything: `wm_operator_finished` → `ED_undo_push_op`
(`source/blender/windowmanager/intern/wm_event_system.cc:1305-1308`). `MESH_OT_remove_doubles` is
`OPTYPE_REGISTER | OPTYPE_UNDO` (`editors/mesh/editmesh_tools.cc:3758`) and returns
`OPERATOR_FINISHED` after "Removed 0 vertices" (`:3738-3743`). So in Blender, Ctrl+Z after a no-op
merge undoes the merge (nothing), not the previous edit.

## Notes

- Either push an (empty) entry for every successful mutating command, or report `undoable: false` in
  the result and have `undo` say what it undid (`{undone: 'primitive sheet'}`) - the agent needs to
  know which command a step reverts. Blender's behaviour is the first.
- The `modifier` listing should either be its own read-only command or not be flagged `mutates`.
