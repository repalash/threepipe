# `Object3DGeneratorPlugin.addObject3DGenerators` deletes the rest of the prefix group

**Severity**: medium. Silent data loss in a registry API, with no error and no warning.

## What happens

`addObject3DGenerators(prefix, generators)` begins by calling `removeObject3DGenerators(prefix)`:

```ts
addObject3DGenerators(prefix: string, generators: Record<string, (params: any) => IObject3D>, refresh = true) {
    this.removeObject3DGenerators(prefix, false)      // <- wipes every existing key with this prefix
    Object.entries(generators).forEach(([key, callback]) => {
        this.generators[prefix + key] = callback
    })
    ...
}
```

`src/plugins/extras/Object3DGeneratorPlugin.ts:203`.

So a caller adding one generator to an existing group removes all the others. Registering a `cone`
under the `geometry-` prefix deletes `geometry-box`, `geometry-plane`, `geometry-sphere`,
`geometry-cylinder`, `geometry-circle` and `geometry-torus`.

## How it was hit

Adding a cone primitive to the modelling workspace example. The Add buttons for every other primitive
then did nothing at all: no exception, no console warning, `generate()` simply returned undefined
because the key was gone. It presents as "my new generator works and every old one broke", which is a
long way from the cause.

The singular `addObject3DGenerator(key, generator)` is safe; it only removes the one key it is about to
overwrite.

## Why it is written that way

`GeometryGeneratorPlugin.onAdded` (`src/plugins/geometry/GeometryGeneratorPlugin.ts:120`) registers its
whole set in one call and pairs it with `removeObject3DGenerators('geometry-')` on unmount. For that
one caller, replace-the-group is the intended behaviour. The problem is that the method is named `add`
and is public, so any other caller gets the surprise.

## Suggested fix

Either:

1. **Make `addObject3DGenerators` additive** and have `GeometryGeneratorPlugin` call
   `removeObject3DGenerators(prefix)` explicitly before it, which is what it already does on unmount.
   This matches what the name promises. It is a behaviour change for any current caller relying on the
   replace, and `GeometryGeneratorPlugin` appears to be the only one in-repo.
2. Or **rename it** to `setObject3DGenerators` and add a genuinely additive `addObject3DGenerators`.

Option 1 is preferable: the current name is the bug.

## Related

A second, smaller trap in the same area: `GeometryGeneratorPlugin` snapshots `Object.keys(this.generators)`
at `onAdded` time, so a geometry generator registered later never gets a matching object generator.
Adding a primitive at runtime needs both registrations. Worth a note in the docs even if the snapshot
behaviour stays.
