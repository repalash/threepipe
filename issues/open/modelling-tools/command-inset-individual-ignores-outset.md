# `inset {individual: true, outset: true}` silently insets inward

Found building `demos/haussmann/build.mjs` (balcony slabs: the building outline grown outward).

## Repro

```js
await run({op: 'primitive', type: 'plane', name: 'p', size: 2})
const r = await run({op: 'inset', object: 'p', faces: [0], thickness: 0.3, outset: true, individual: true})
await run({op: 'inspect', object: 'p'})
// bounds still 2 x 2: the new ring is *inside* the face. No warning.
await run({op: 'inset', object: 'p', faces: [0], thickness: 0.3, outset: true})
// region mode on a lone face: nothing happens at all (rimFaces: []), again without a warning.
```

## What Blender does

Both behaviours match Blender's operators, but Blender makes them visible:

- `bmo_inset_individual` has no `use_outset` slot; in the Inset Faces panel the Outset checkbox is
  ignored in Individual mode. A negative thickness grows the face outward, and that is what the
  command does too (`thickness: -0.3` gives a 2.6 x 2.6 ring).
- Region outset (`bmo_inset.cc:676-678`) turns `use_boundary` off and tags every *unselected* face, so
  a face with no neighbours has no edge between a tagged and an untagged face and nothing is inset.

## Suggested fix

Warn when `outset` is given with `individual`, and say "use a negative thickness". Warn when a region
outset finds no edges to inset (`rimFaces` empty), naming the cause (no neighbouring faces). Mention
the negative-thickness form in the `inset` description.
