# `IAssetImporter` does not declare `resolveURL` (or the URL modifiers)

`AssetImporter` has a public `resolveURL`:

```ts
// src/assetmanager/AssetImporter.ts:632
resolveURL(url: string): string {
    return this._loadingManager.resolveURL(url)
}
```

along with `addURLModifier` and `removeURLModifier` just below it. None of the three are on
`IAssetImporter` (`src/assetmanager/IAssetImporter.ts:244`), which is the type every plugin sees.

So a plugin that resolves a path — `@threepipe/plugin-blend-importer` does, to find a `.blend`'s
sibling textures — has to call a method its own types say does not exist:

```
src/BlendLoadPlugin.ts(49,24): error TS2339: Property 'resolveURL' does not exist on
    type 'IAssetImporter<IAssetImporterEventMap>'.
```

It works at runtime, so nothing is broken; it just cannot be typechecked. Declaring the three on the
interface is behaviour-neutral and cannot break a consumer, since it only widens the type — but it is
a core change, so it is filed rather than made.

This is the one remaining error in `npm run typecheck --prefix plugins/blend-importer`, which is why
that package is not yet in the root `typecheck:plugins` chain.

## Related, and fixed

`plugins/blend-importer/tsconfig.json` had no `threepipe` path mapping. With `"threepipe":
"file:./../../src/"` in its `package.json`, TypeScript resolved the import to threepipe's **source**
and typechecked the whole of it as part of this package — surfacing five unrelated core errors
(`PolyhavenMaterialGLTFLoader`, `GLTFWriter2`'s `import.meta.env`, `AssetManager`) that have nothing
to do with the importer. Adding the mapping, pointed at `dist/index.d.ts` the way every other plugin
does, takes it from six errors to one. Note the package's `baseUrl` is `./src`, not `.`, so its
relative paths need one more `../` than the other plugins'.
