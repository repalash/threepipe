# Porting a geometry node to @threepipe/plugin-procedural

Read `issues/open/modelling-tools/15-procedural-on-kernel.md` first. Blender source: `.repos/blender-5.2.2`
(tag v5.2.2). Every port follows the C++ there, line by line, and cites `file:line`.

## Rules

- Port, do not design. If something cannot be ported yet, throw an `Error` that says what is missing
  (never return an approximation silently) and write it down as a blocker.
- Float32: Blender computes in `float` and is built with `-ffp-contract=off`, so every `+ - * /` rounds.
  Use `f32` (`src/blender/f32.ts`) on every intermediate that C stores in a `float`, keep C's operation
  order, round float literals (`0.5f` → `f32(0.5)` when not exact). `sinf`/`powf`/... become
  `Math.sin`/`Math.pow` then `f32`. Where Blender computes in `double`, do the same.
- C semantics: `int(x)` truncates; `std::round` is half away from zero (`roundHalfAway`); `std::min/max`
  and `min_ff/max_ff` differ for NaN (`src/nodes/util.ts`); `fmodf` is JS `%`.
- Values are immutable. Copy a geometry before writing (`params.geometry(id)` already returns a copy; use
  `meshForWrite()` etc.). Never mutate an input field, array or attribute.
- No DOM, no threepipe imports: the package runs in Node.
- Blender porting: ALWAYS port from Blender C++ source code. NEVER claim an algorithm "can't be reproduced in TS." If the source exists, port it exactly. Never pre-bake/hardcode output data as a shortcut — graphs must be reactive (changing inputs must change outputs)
- BufferGeometry and all three.js types are Node.js-safe with polyfill. The `/graph` subpath can export anything using three.js types. Only actual browser APIs (document, canvas, WebGL) are not Node-safe. Do NOT tell agents that three.js types can't be used in Node.js
- When spawning agents for Blender ports: reference skill.md, do NOT override its rules in the prompt. The skill says "port from Blender source" — follow it. Do NOT give agents permission to skip or approximate nodes — if something isn't ported, the agent must flag it as a blocker
- When reviewing agent work: verify ALL node trees are accounted for, not just instance counts. "0 instances in GT" means the tree produces geometry, not that it's optional

## Shapes

- A node is `registerNodeType({idname, label, properties, declare, multiFunction | execute})`
  (`src/runtime/registry.ts`).
- `declare(b, node)` mirrors `node_declare`: `b.input(type, name, identifier?)`, `.default()`, `.min()`,
  `.max()`, `.subtype()`, `.multiInput()`, `.hideValue()`, `.implicit('POSITION' | 'INDEX' | ...)`,
  `.available(bool)` (from `node_update` availability rules), `.field()`/`.single()`. Socket identifiers
  must equal Blender's (they are what `.blend` dumps link by). Dynamic sockets read `node.prop(...)`.
- `properties` are RNA names with `node_init` defaults (`operation: 'ADD'`, `data_type: 'FLOAT'`).
- Field nodes (`build_multi_function`) return a `MultiFunction` over the node's *available* data inputs
  and outputs in declaration order; the runtime folds single values and builds field operations.
  Use `elementwise`, `fn1/fn2/fn3` (`src/nodes/util.ts`), or a custom `call(size, ins, outs)` when
  Blender special-cases single inputs (see `src/nodes/shader/math.ts`).
- Geometry nodes `execute(p)`: `p.field(id)`, `p.single(id)`, `p.float/int/bool/vector(id)`,
  `p.geometry(id)`, `p.string(id)`, `p.getMulti(id)`, `p.set(id, value)`, `p.outputUsed(id)`,
  `p.anonymousName(id)`, `p.warn(msg)` (node warnings, `error_message_add`).
- Fields: `GField`, `FieldOperation`, field inputs in `src/fields/inputs.ts`; evaluate on a component
  with `new FieldEvaluation(new FieldContext(type, component, domain), size)`; write with
  `captureFieldsOnGeometry`.
- Geometry: `GeometrySet`, `MeshData` (kernel), `PointCloud`, `CurvesGeometry`, `Instances`
  (`src/geometry`). Domain interpolation and type conversion are in the attribute accessors.

## Tests

- Unit tests beside the source (`*.test.ts`), each checking values against the formula in the C++ and
  citing it. `npm run test --prefix plugins/procedural -- <path>`.
- Parity: `tests/parity/geonodes-kit` runs every reference case whose node types are all registered
  (`npm run test --prefix plugins/procedural -- tests/parity`). A ported node must make its cases pass.
  `tests/parity/geonodes-kit.status.json` lists failures and why.
- `npm run typecheck --prefix plugins/procedural` must pass.
