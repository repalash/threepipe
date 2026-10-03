# Generated BMesh operator table

Machine-readable extraction of Blender's BMesh operator set (`bmo`) — the 83 `BMOpDefine` structs in
`bmesh_opdefines.cc` with their typed named slots, enum tables, doc comments and post-op type flags.

This is the authoritative signature list for the BMesh kernel port. It is meant to drive:

- typed wrapper functions (`mesh.extrudeFaceRegion({geom, useKeepOrig})`)
- runtime slot defaults + validation
- JSON-schema tool definitions for AI agents
- docs

Nothing here is written by hand. Everything is parsed out of the Blender C++ source; the scripts fail
loudly rather than emitting a guess.

## Files

| file | what it is |
| --- | --- |
| `extract-bmo-opdefines.mjs` | the generator. Node builtins only, no dependencies, no install. |
| `verify-bmo-extract.mjs` | the checker. Run after every regeneration. |
| `bmo-opdefines.json` | **the artifact reviewers diff.** Raw extracted data, stable key order, 2-space indent. |
| `bmo-ops.schema.ts` | generated TS: `BMO_OPS`, `BMO_ENUMS`, slot/op interfaces, numeric constants, name maps. |
| `bmo-ops.types.ts` | generated TS: `<Op>Params` / `<Op>Result` interfaces + `BMOOperatorMap`. |
| `tsconfig.check.json` | standalone config used *only* by `verify-bmo-extract.mjs` to type-check the two generated `.ts` files. It deliberately does not extend the repo root config, and nothing in the repo build references it. |

`bmo-ops.schema.ts` and `bmo-ops.types.ts` are dependency-free: no `import` at all, no three.js.
`Vector3Like` / `Matrix4Like` / `BMVert` / `BMEdge` / `BMFace` are declared locally as structural
placeholders, to be replaced with `import type` lines once the BMesh kernel types exist.

## Regenerating

```sh
cd issues/open/modelling-tools/generated
node extract-bmo-opdefines.mjs --blender-root ../../../../blender   # writes the three artifacts
node verify-bmo-extract.mjs                                         # asserts + prints the summary table
```

`--blender-root` is auto-detected from `.repos/blender` if omitted, or taken from `$BLENDER_SRC`.
Other flags: `extract --check` (parse + validate, write nothing), `extract --out-dir <dir>`,
`verify --expect-operators <n>`, `verify --no-tsc`.

The generator reads, in order of authority:

1. `source/blender/bmesh/intern/bmesh_opdefines.cc` — operator table, slot tables, enum tables, docs
2. `source/blender/bmesh/intern/bmesh_operator_api.hh` — `eBMOpSlotType`, the subtype enums, `BMOpTypeFlag`
3. `source/blender/bmesh/bmesh_class.hh` — `BM_VERT` / `BM_EDGE` / `BM_LOOP` / `BM_FACE`
4. every other header under `source/blender/bmesh/`, then (only for still-unresolved symbols)
   every header under `source/blender/` — for the symbolic enum-table values
   (`MOD_TRIANGULATE_QUAD_BEAUTY`, `SUBD_FALLOFF_SMOOTH`, `DEL_VERTS`, `BEVEL_AMT_OFFSET`, …).
   A symbol found with two different values is a hard error, not a silent pick.
5. every `.cc` under `source/blender/bmesh/` — to locate each `exec`/`init` callback definition
   (`execFile` = the operator's category) and to read the `BMO_slot_*_set` calls an `init` makes.

There is no hardcoded operator, slot or enum list anywhere: rerunning against a newer Blender picks up
additions, removals and renames. The only fixed table is the `eBMOpSlotType` → TS-kind mapping
(`BMO_OP_SLOT_FLT` → `float` etc.), and an unknown slot type is a hard error.

## Data source

- Blender 5.3.0 alpha, commit `e4e6c79a844306bb5deec9f14d5fe3c459bb1a39` (2026-06-11)
- 83 operators, 18 enum tables, 353 input slots, 78 output slots

## Parsing conventions

Blender ships its own parser for this exact file — `doc/python_api/rst_from_bmesh_opdefines.py`
(not in the sparse checkout; read it with `git show HEAD:doc/python_api/rst_from_bmesh_opdefines.py`).
Its comment/doc conventions are followed here rather than reinvented:

- the block comment directly above a `static BMOpDefine …` is the operator doc, in reStructuredText;
  the first line is the title, blank-line-separated blocks after it are paragraphs
- a slot's doc is the own-line block comment directly above it, **or** the inline block comment
  directly after it on the same line
- `//` comments are ignored
- `{0, nullptr}` is the enum-table sentinel and is dropped
- `to_subtype_union(X)`, `eBMOpSlotSubType_Elem(X)` and `(int)X` are identity wrappers/casts
- a comment beginning with `NOTE` is an implementation note, not user documentation

Two deliberate departures, both strictly additive:

- Blender's script is line-based; this one is token-based (a small C tokenizer + bracket matcher +
  top-level comma splitter), so slot entries wrapped across lines by clang-format parse the same as
  single-line ones, and anything unexpected is a hard error instead of silently-wrong data.
- Blender's script discards `NOTE` comments. Here they are kept in a separate `note` field, so `doc`
  matches Blender's published Python docs exactly while no information is lost.

**Cross-checked**: Blender's own generator was run against the same checkout and diffed against this
extraction. All 83 operator names, all 431 slot names (input and output, in order), all 431 slot
types/subtypes/element-masks/enum member lists, all 83 operator docs and all 353 input-slot docs are
identical. Repeat this by pointing `rst_from_bmesh_opdefines.py` at a scratch output dir.

## Naming rules

`tsName` is derived deterministically and is reversible.

1. a trailing `.out` or `.in` qualifier is stripped (slot names only; `name` always keeps the
   untouched Blender name)
2. the remainder is split on `_` and `.`
3. the first part stays lower-case; every later part gets its first character upper-cased

```
extrude_face_region      -> extrudeFaceRegion
use_normal_flip          -> useNormalFlip
faces.out                -> faces
geom_split.out           -> geomSplit
radius1                  -> radius1        (digits are never treated as separators)
```

The inverse is `tsName.replace(/([A-Z])/g, c => '_' + c.toLowerCase())`. Every generated name is
round-trip checked at generation time **and** in the verifier; a mismatch is a hard error.

Collisions: none exist today. They are checked for and are a hard error — operator `tsName`s must be
globally unique, slot `tsName`s must be unique within one operator's input group and within its output
group (`geom` as an input and `geom.out` as an output is fine, they live in different groups).
`BMO_OP_NAME_BY_TS` and `BMO_SLOT_NAME_BY_TS` in `bmo-ops.schema.ts` are the emitted inverse maps
(the slot map only lists slots whose `tsName` differs from their `name`).

Interface names in `bmo-ops.types.ts` are `PascalCase(tsName) + 'Params' | 'Result'`.

## Defaults

Every `// default:` comment in `bmo-ops.types.ts` is sourced. Nothing is invented; a slot with no
sourced default says so. The rules, from `bmesh_operators.cc`:

| slot kind | default | source |
| --- | --- | --- |
| `bool` | `false` | `BMO_op_init` memsets `BMOperator` to 0 (`bmesh_operators.cc:147`) |
| `int` (plain) | `0` | same |
| `float` | `0.0` | same |
| `vec3` | `(0, 0, 0)` | same |
| `ptr` | `null` | same |
| `elems` | `[]` / `null` for `isSingle` | same |
| `map` | empty `Map`/`Set` | `bmo_op_slots_init` allocates an empty `GHash` (`bmesh_operators.cc:100`) |
| `mat4` | identity | `BMO_slot_mat4_get` returns `unit_m4` for an unset slot (`bmesh_operators.cc:383-388`) |
| `int` + `INT_ENUM`/`INT_FLAG` | first entry of the enum table | `bmo_op_slots_init`: `data.i = enum_flags[0].value` (`bmesh_operators.cc:109`) |
| anything set by an `init` callback | the C expression verbatim, with file:line | parsed from the callback body |

Only one operator has an `init` callback: `dissolve_edges` sets `angle_threshold = M_PI`
(`bmo_dissolve.cc:452`). The value is emitted as the literal C expression `M_PI` rather than a
rounded float, on purpose.

## Quirks — read this before using the data

1. **Two `#ifdef`-guarded entries.** `bmesh_opdefines.cc` is not unconditional C++:
   - `convex_hull` is inside `#ifdef WITH_BULLET` (on in official builds, but a build option).
   - `join_triangles.merge_limit` and `join_triangles.neighbor_debug` are inside
     `#ifdef USE_JOIN_TRIANGLE_INTERACTIVE_TESTING`, which is itself behind `#if 0` at
     `bmesh_opdefines.cc:755` — i.e. **these two slots do not exist in any normal build**.

   Blender's own doc generator ignores the preprocessor entirely and silently includes all three.
   This extractor includes them too (so the counts match) but records `condition` on the operator/slot,
   emits it into the TS doc comments, and warns. **Decide whether to drop the two
   `USE_JOIN_TRIANGLE_INTERACTIVE_TESTING` slots from the port surface.**

2. **`INT_FLAG` default disagrees between Blender's C code and Blender's Python docs.**
   `bmo_op_slots_init` sets *both* `INT_ENUM` and `INT_FLAG` slots to `enum_flags[0].value`, so
   `dissolve_limit.delimit` really defaults to `["NORMAL"]` (= 1), not to an empty set.
   `rst_from_bmesh_opdefines.py` documents `set()`. The C code is followed here.

3. **`delete.context` has no usable zero default.** Its enum table starts at `DEL_VERTS = 1`, so the
   documented default `"VERTS"` is what `bmo_op_slots_init` actually writes — fine — but any runtime
   that zero-initialises the slot itself instead of copying `enum_flags[0].value` would produce the
   invalid value `0`. Ports must replicate the `enum_flags[0].value` rule, not `memset`.

4. **`BMO_OP_SLOT_MAT` is a single slot type, always 4×4.** Blender stores a `float[4][4]`
   (`BMO_SLOT_AS_MATRIX`); `BMO_slot_mat3_get` is a convenience reader. Hence the TS kind is `mat4`
   and there is no `mat3`. Operators documented as taking a 3×3 (`rotate.matrix`, `transform.matrix`,
   `*.space`) still use the same 4×4 slot.

5. **`BMO_OP_SLOT_SUBTYPE_PTR_*` slots are mostly Blender-host types**, not mesh data:
   `object_load_bmesh.scene`/`.object`, `bmesh_to_mesh.mesh`/`.object`, `mesh_to_bmesh.mesh`/`.object`
   (`PTR_SCENE` / `PTR_OBJECT` / `PTR_MESH`), and `bevel.custom_profile` (`PTR_STRUCT`, actually a
   `CurveProfile`). `duplicate.dest` / `split.dest` (`PTR_BMESH`) are the only ones a port needs.
   The three conversion operators (`object_load_bmesh`, `bmesh_to_mesh`, `mesh_to_bmesh`) are
   Blender-DNA glue and have no threepipe meaning; they are kept in the table for completeness.

6. **Mapping subtypes.** In use: `MAP_ELEM` (11 slots), `MAP_FLT` (2), `MAP_EMPTY` (1, used as a set —
   `extrude_face_region.edges_exclude`), `MAP_INTERNAL` (1 — `subdivide_edges.custom_patterns`, which
   Blender's Python API cannot convert either; treat as opaque). `MAP_INT` and `MAP_BOOL` exist in
   the C enum but no slot uses them.

7. **`ELEM_IS_SINGLE`.** `BMO_OP_SLOT_SUBTYPE_ELEM_IS_SINGLE` (16) is packed into the same field as
   the `BM_VERT|BM_EDGE|BM_FACE` mask. It is split out into `isSingle` and masked off `elemMask`.
   Two slots use it: `pointmerge.vert_target`, `pointmerge_facedata.vert_target`.

8. **38 of 431 slots have no doc comment in the Blender source** — mostly `.out` slots
   (`geom.out` on `extrude_face_region`, `duplicate`'s `*_map.out`, `convex_hull`'s outputs) plus
   `join_triangles`'s newer thresholds. They are emitted as
   `Undocumented in the Blender source.` rather than being given invented text. List them with:
   `node -e "const j=require('./bmo-opdefines.json');for(const o of j.operators)for(const s of [...o.slotsIn,...o.slotsOut])if(!s.doc)console.log(o.name+'.'+s.name)"`

9. **`BM_LOOP` never appears in a slot mask.** Loops cannot be put into slots
   (`bmesh_operator_api.hh:55`). `BM_LOOP = 4` is still exported for completeness, which is why the
   element mask for "everything" is `11` (`VERT|EDGE|FACE`), not `15`.

10. **`circularize.fit_method` and `flatten.method` are plain `int` slots, not `INT_ENUM`** — Blender
    has not given them enum tables, so no string-literal union can be generated. Their valid values
    have to be read out of `bmo_circularize.cc` / `bmo_flatten.cc` when those operators are ported.

## The one heuristic (needs a maintainer decision)

Blender has no notion of a "required" slot — every slot is zero-initialised, so any operator can be
called with no arguments. For `<Op>Params` ergonomics a rule is still needed. The rule used is:

> an input slot is **required** iff it is a non-single element-buffer slot whose name is one of the
> primary geometry names documented in `bmesh_opdefines.cc`'s file header ("A word on slot names"):
> `verts`, `edges`, `faces`, `geom`, `input`. Everything else is optional.

Result: 74 required slots. The 7 element-buffer input slots this leaves optional are all genuinely
optional in Blender — `find_doubles.keep_verts`, `connect_verts.faces_exclude`,
`connect_vert_pair.verts_exclude`, `connect_vert_pair.faces_exclude`, `inset_region.faces_exclude`,
`pointmerge.vert_target`, `pointmerge_facedata.vert_target`.

Twelve operators end up with no required parameter at all: the seven `create_*` primitives (correct —
they take only numbers), the three Blender-DNA conversion operators, and:

- `weld_verts`, whose only input is `targetmap` (a `MAP_ELEM` mapping) and which is *de facto*
  required — **the heuristic misses this one.**
- `create_vert`, whose only input is `co` (a `vec3` that legitimately defaults to the origin).

If you would rather not have a heuristic at all, make every slot optional and drop
`PRIMARY_GEOM_SLOT_NAMES` from `extract-bmo-opdefines.mjs`; the JSON is unaffected either way.

## Review checklist

- [ ] `node verify-bmo-extract.mjs` prints `OK - all checks passed` and `tsc --noEmit: ok`
- [ ] operator count is 83 (or the diff in `bmo-opdefines.json` explains why it changed)
- [ ] `git diff bmo-opdefines.json` shows only intended changes — this is the file to review,
      the two `.ts` files are derived from it
- [ ] the extractor printed no warnings other than the three known `#ifdef` ones (quirk 1)
- [ ] every new/changed enum table's values resolved to numbers, not to a fallback
- [ ] no new entries appeared in the "undocumented slots" list without a reason
- [ ] the required/optional heuristic above still matches intent for any newly added operator
- [ ] `bmo-ops.schema.ts` / `bmo-ops.types.ts` still contain no `import` statements
- [ ] if Blender was updated: rerun `rst_from_bmesh_opdefines.py` from the new checkout and re-diff
      operator/slot names and types against `bmo-opdefines.json`
