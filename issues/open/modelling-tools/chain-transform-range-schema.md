# `transform {verts: {from, to}}` is rejected by the schema, though the code supports it

**Found by**: edit-chain harness, step `hazard-06` (`"verts" must be an array`).
**Severity**: low.

## Repro

```js
await run({op: 'transform', object: 'rook', verts: {from: 0, to: 3}, move: [0, 0.1, 0]})
// -> ok: false, error: "\"verts\" must be an array"
```

## Cause

`readVertSelection` → `readIntList` (`commands/params.ts`) accepts `[1, 2, 3]` *or* `{from, to}` - its
comment calls it "the report's selective ID range" - but `transform`'s schema declares `verts` and
`faces` as `S.array(...)`, and `validateParams` rejects anything that is not an array before `run` is
reached. The range form is unreachable.

## Expected

Either declare `oneOf: [array, {from, to}]` in the schema (and teach `checkType` about it), or drop the
range form from `readIntList`. The first is what the SU-152 report asked for.
