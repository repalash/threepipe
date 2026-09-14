# PolyhavenMaterialGLTFLoader — pre-existing TypeScript errors surfaced by dts build

**Severity:** low (type-strictness only; runtime + JS emit unaffected)

**File:** `src/assetmanager/import/PolyhavenMaterialGLTFLoader.ts` (committed in `b16b97d`)

## Symptom

`vite-plugin-dts` (run during any dependent build, e.g. `plugins/blend-importer`
`npm run build`) emits two type errors from this core file. The build still
succeeds (RC=0) because dts logs them as warnings, but they are real:

1. **Line 7** — `class PolyhavenMaterialGLTFLoader extends GLTFLoader implements
   ILoader<GLTF, PhysicalMaterial|undefined>`:
   > Type 'PolyhavenMaterialGLTFLoader' is missing the following properties from
   > type 'ILoader<...>': `loadAsync`, `crossOrigin`, `withCredentials`, `path`,
   > and 9 more.

   `GLTFLoader` (three) does not structurally satisfy threepipe's `ILoader`
   interface — the `implements` clause is aspirational. Other loaders in
   `src/assetmanager/import/` extend a base that supplies these, or cast.

2. **Line 30** — `res.scene.traverse(o => { ... })`:
   > TS7006: Parameter 'o' implicitly has an 'any' type.

   Missing explicit `o: Object3D` annotation.

## Notes

- Pre-existing; **not** introduced by the blend-importer / PBR work. Discovered
  while building `@threepipe/plugin-blend-importer` (the dts step type-checks the
  whole `threepipe` source graph via tsconfig path mapping).
- Fix is mechanical: annotate `o: Object3D`, and either extend the same loader
  base the other importers use or narrow the `implements` to the subset actually
  honored. Left untouched here — core change, out of scope for the blend work,
  needs owner sign-off.
