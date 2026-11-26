# No way to apply an object transform to the mesh (Blender's Ctrl+A)

`primitive {position, rotation, scale}` sets the *object* transform. Live `mirror` and radial `array`
modifiers work about the object origin, as Blender's do, so a primitive placed with `position` and
then mirrored is mirrored about its own centre, not the world axis.

## Repro

```js
await run({op: 'primitive', type: 'plane', name: 'p', size: 2, position: [10, 0, 10]})
await run({op: 'modifier', object: 'p', add: {type: 'mirror', axis: 'x'}})
// Both copies sit at x = 10 ± 1, not at x = ±10.
```

In Blender the fix is Object > Apply > Location (Ctrl+A). Here there is no equivalent: the Eiffel
build creates every part at the origin and then moves its geometry with
`transform {faces: [...], move}`, which works but needs the face list.

## Suggested fix (needs a decision on the command shape)

`transform {object, apply: true}` (or `apply: ['location', 'rotation', 'scale']`), baking the object
transform into the master mesh and resetting it, like `object.transform_apply`. A modifier with a
`center` already exists for mirror; radial `array` has `pivot`. So the gap is the general one, not a
missing parameter.
