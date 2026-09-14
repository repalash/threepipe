# Blend importer: dual publishing (threepipe + vanilla three.js) — plan

## Status

Plan only — not yet implemented. Created 2026-06-06. Pick up after the loader/material work is complete.

---

Publish a single package, `@threepipe/plugin-blend-importer`, that serves **both** threepipe consumers (existing, byte-identical) **and** vanilla three.js consumers (new `./vanilla` entry) from one tarball/version, by hardening the already-present `Ctx` dependency-injection seam into a package boundary.

Owner: maintainer
Target version: `0.3.0` (minor — net-additive `./vanilla` subpath, no breaking changes)
Package: `/Users/palash/Projects/threepipe/plugins/blend-importer/`

---

## 1. Goal & non-goals

### Goal
Publish a single package, `@threepipe/plugin-blend-importer`, that serves **two consumers from one tarball/version**:

1. **threepipe consumers** (existing) — `import {BlendLoadPlugin} from '@threepipe/plugin-blend-importer'` continues to work byte-identically: same class name, same `PluginType`, same options, same enhanced `*2`/`*0` output classes, same asset-pipeline behavior. **Zero source edits for existing users.**
2. **vanilla three.js consumers** (new) — `import {BlendLoader, loadBlend} from '@threepipe/plugin-blend-importer/vanilla'`, requiring only `three` as a peer, with no threepipe in the dependency or type graph. Bytes-in / `THREE.Object3D`-tree-out, Node-safe (graceful degradation of all DOM texture paths in Node — see §11/§8.1).

This is achieved by hardening the already-present `Ctx` dependency-injection seam into a **package boundary**: a threepipe-free, three-only shared core, a new `./vanilla` entry that injects plain three classes, and the existing `BlendLoadPlugin` as the threepipe adapter on the `.` entry.

### Non-goals
- **No breaking rename** of the `.` entry to a vanilla-first default. (That is Option P2; it breaks every existing consumer — `examples/blend-load`, `examples/model-viewer`, `examples/tweakpane-editor` all import the bare name — for little gain given the `@threepipe`-scoped package name. Defer to a deliberate v1.0 with a codemod if ever wanted.)
- **No new `fflate` runtime dependency.** Gzip support is sourced from three's own bundled `three/examples/jsm/libs/fflate.module.js` (see §5.6).
- **No changes to the Blender parser** (`js-blend/parser/parser.js`) or the geometry/material extraction algorithms.
- **No changes to threepipe core.** No approval-gated structural edits.
- **No reactivity/UI/serialization for vanilla consumers** — they get plain three objects. This is documented, not a feature gap.

---

## 2. Current state

### 2.1 Packaging (today)

`package.json` (verified at `/Users/palash/Projects/threepipe/plugins/blend-importer/package.json`):

```jsonc
"version": "0.2.0",
"type": "module",
"main": "dist/index.js",      // UMD/CJS
"module": "dist/index.mjs",   // ESM
"types": "dist/index.d.ts",
"exports": {
  ".":       { "types": "./dist/index.d.ts", "import": "./dist/index.mjs", "require": "./dist/index.js" },
  "./dist/": { "import": "./dist/", "require": "./dist/" }
},
"dependencies":     { "fzstd": "^0.1.1", "threepipe": "file:./../../src/" },  // threepipe is a dev/local link, stripped on publish by clean-package
"peerDependencies": { "threepipe": ">=0.1.0" }
```

Build: single-entry Vite lib (`src/index.ts`), `formats: ['es','umd']` in prod, `vite-plugin-dts` for `.d.ts`.

**Critical build couplings (verified, both must change):**
1. A blanket `@rollup/plugin-replace` rewrites **every** `from 'three'` → `from 'threepipe'` (`vite.config.js:57–61`), and `three`/`threepipe` are marked external with global `threepipe`.
2. **`fzstd` is NOT externalized today** — `globals` lists only `three`/`threepipe`, so `fzstd` is **bundled into `dist`**. This is precisely *why* `clean-package` can safely empty `dependencies` on publish: the only real runtime dep is inlined. **Any plan that externalizes `fzstd` MUST also stop emptying it from `dependencies`** (see §5.2 ship-blocker note).

`tsconfig.json` uses `moduleResolution: bundler`, `target ES2020`, `declaration` + `declarationMap`. `clean-package` strips `scripts`/`devDependencies` and replaces `dependencies` with `{}` on publish.

### 2.2 threepipe-coupling — symbol A/B classification

**Category A** = plain three.js re-export from threepipe (one-line `from 'threepipe'` → `from 'three'` swap, runtime-identical).
**Category B** = genuinely threepipe-specific (plugin framework, or behavioral `*2`/`*0` subclass, or a threepipe-only utility re-export).

| Symbol | Cat | File(s) | Resolution |
|---|---|---|---|
| `gunzipSync` | **B** | `decompress.ts` | Re-route to `three/examples/jsm/libs/fflate.module.js` (§5.6) |
| `Object3D`, `Mesh`, `BufferGeometry`, `BufferAttribute` | A | `ctx.ts`, `index.ts`, `camera.ts`, `BlendLoadPlugin.ts` | `from 'three'` |
| `PerspectiveCamera`, `OrthographicCamera` | A | `ctx.ts` | `from 'three'` |
| `PointLight`, `SpotLight`, `DirectionalLight`, `AmbientLight`, `Light` | A | `ctx.ts`, `light.ts` | `from 'three'` (note: `Light` is used in **type position** at `light.ts:21` `let light: Light | undefined`; three exports `Light` as value+type, verified `lights/Light.js:59` — resolves fine, just don't drop it as unused) |
| `MeshPhysicalMaterial`, `MeshBasicMaterial`, `Texture` | A | `ctx.ts`, `material.ts` | `from 'three'` |
| `DoubleSide`, `FrontSide`, `SRGBColorSpace` | A | `material.ts`, `mesh.ts` | `from 'three'` |
| `Euler`, `EulerOrder`, `Quaternion`, `Vector3` | A | `index.ts` | `from 'three'` |
| `FileLoader`, `TextureLoader`, `Scene` | A | `BlendLoadPlugin.ts` | stays in adapter (and reused in vanilla `BlendLoader`) |
| `IObject3D` | **B** (type only) | `index.ts` | Replace with `Object3D & {setDirty?: () => void}` (§5.6) |
| `BaseImporterPlugin`, `Importer`, `ILoader`, `AnyOptions` | **B** | `BlendLoadPlugin.ts` | Stays in threepipe adapter — never enters core/vanilla |
| `Object3D2`, `Mesh2`, `BufferGeometry2` | **B** | `BlendLoadPlugin.ts` | Injected via `ctx` from adapter only |
| `PhysicalMaterial`, `UnlitMaterial` | **B** | `BlendLoadPlugin.ts` | Injected via `ctx` from adapter only |
| `PointLight2`, `SpotLight2`, `DirectionalLight2`, `AmbientLight2` | **B** | `BlendLoadPlugin.ts` | Injected via `ctx` from adapter only |
| `PerspectiveCamera0`, `OrthographicCamera0` | **B** | `BlendLoadPlugin.ts` | Injected via `ctx` from adapter only |

**Verified `from 'threepipe'` import sites** (8 live files):
`decompress.ts:1`, `BlendLoadPlugin.ts:23`, `loader/ctx.ts:15`, `loader/index.ts:4`, `loader/camera.ts:1`, `loader/mesh.ts:1`, `loader/light.ts:1`, `loader/material.ts:1`.
Plus 5 **dead** files under `src/js-blend/threejs/*` (`blend_three.js`, `light.js`, `material.js`, `mesh.js`, `texture.js`) that import threepipe but are **not** referenced by `index.ts`/`BlendLoadPlugin.ts`/`loader/*` — to be deleted (§6 step 1).

### 2.3 The `decompress.ts` `gunzipSync` coupling (call-out)

`decompress.ts:1` is `import {gunzipSync} from 'threepipe'`. This resolves **only** because:
- threepipe's `src/three/addons.ts:17` does `export * from 'three/examples/jsm/libs/fflate.module.js'`, and
- the build's blanket `from 'three'→'threepipe'` replace would otherwise rewrite it anyway.

`gunzipSync` is **not** a first-class threepipe export (verified: `grep gunzipSync src/` returns no export declaration) — it leaks transitively through the addons barrel. This is the load-bearing, fragile coupling. **Verified fact:** `gunzipSync` is exported at `three.js-modded/examples/jsm/libs/fflate.module.js:1376`, and that is the exact module threepipe re-exports. So the fix is to import it from that module directly — same code, zero new deps (§5.6). `fzstd ^0.1.1` already handles zstd and stays.

---

## 3. How close the core already is (the `ctx` DI pattern)

The loader is **already ~95% framework-agnostic** via the `Ctx` dependency-injection interface (`loader/ctx.ts`).

**Already pure / DI-driven:**
- `js-blend/main.js`, `js-blend/parser/parser.js` — zero framework imports. Pure binary parser.
- `loader/geometry.ts` — **verified** imports only `{Ctx} from './ctx'`. No three/threepipe import at all.
- `loader/index.ts` `createObjects(file, ctx)` and every `create*` helper construct objects exclusively via `new ctx.X(...)` (e.g. `index.ts:30 new ctx.Object3D()`, `mesh.ts`, `light.ts`, `camera.ts`, `geometry.ts`). They **never name** `Object3D2`/`Mesh2`/`PhysicalMaterial`/etc.
- The one behavioral call into a maybe-threepipe object is guarded: `index.ts:112 if (obj.setDirty) obj.setDirty()` — a safe no-op for plain three.
- The external-texture hook is already optional and DI'd: `Ctx.loadExternalTexture?` (`ctx.ts:37`); `loadExternalBlendTexture` already returns `null` when `typeof document === 'undefined'` (Node) — `BlendLoadPlugin.ts:38`.

**What still hard-references threepipe (the entire remaining gap):**
1. The 6 loader files + `decompress.ts` import three.js primitives (Category-A symbols) **from `'threepipe'` instead of `'three'`** — a literal import-source rewrite, no logic change.
2. `loader/index.ts` imports one threepipe-only **type** `IObject3D` (used only to annotate `setTransform`'s param).
3. `decompress.ts` imports `gunzipSync` from `'threepipe'` (the §2.3 coupling).
4. `BlendLoadPlugin.ts` — correctly threepipe-coupled. This is the integration layer and **should stay coupled**; it builds the `*2`/`*0` `ctx` (lines 139–153) and injects it into the shared `createObjects`.

The `Ctx` seam means the threepipe-specific classes live **only** inside the adapter's `ctx` object literal. Making the abstraction the package boundary is the whole job.

---

## 4. Options considered

Three approaches were evaluated; summarized:

- **P1 — Single package, two entries over a threepipe-free core (`.` + `/vanilla`).** Keep one package/version. `.` stays the byte-identical `BlendLoadPlugin` (threepipe peer); new `./vanilla` entry injects plain three classes over the shared core. Per-entry `.d.ts`. Migration risk ~nil (additive). **RECOMMENDED.**
- **P2 — Vanilla-first: `.` becomes the three-only `BlendLoader`, `./threepipe` becomes the optional adapter.** Most idiomatic vanilla surface, **but breaking**: every existing `import {BlendLoadPlugin} from '@threepipe/plugin-blend-importer'` breaks. Its own deprecation shim re-pulls threepipe into `.`, defeating the point.
- **P3 — Minimal-change single-entry Ctx hardening + `./vanilla` subpath, default plain-three ctx.** Smallest diff; correct decompress fix; lowest effort. But isolates vanilla vs threepipe code by **tree-shaking within a shared bundle**, not by entry — a misconfigured bundler / wrong `sideEffects` can drag threepipe refs into a vanilla build.

### RECOMMENDED: **P1, with the decompress fix and build-hygiene framing grafted from P2/P3.**

Justification:

1. **Right shape, zero migration.** One package, one version, byte-identical `.` entry → existing consumers need no edits and a minor bump suffices. Verified all 3 in-repo example consumers import the bare name.
2. **The core is already 95% DI-ready** — the remaining work is mechanical import-source rewrites on Category-A symbols proven to be verbatim three re-exports, plus one type swap.
3. **Entry-level code-split is more robust isolation than P3's tree-shaking.** A vanilla entry built from a separate import graph that never touches threepipe lets a CI grep hard-assert no `threepipe` string leaks in — independent of consumer bundler config.
4. **Established in-repo precedent for dual builds** — but see §4.1: the *exact* multi-entry mechanism is new.

**Grafts onto P1:**
- **Decompress fix (from P2/P3):** import `gunzipSync` from `three/examples/jsm/libs/fflate.module.js` rather than adding an `fflate` dep. Removes a dependency, a license entry, and a version-tracking burden. Verified byte-identical.
- **Build hygiene (from P3):** **remove** the blanket `from 'three'→'threepipe'` replace entirely (it is the coupling mechanism) rather than scoping it; let core import literal `three`, let the adapter import literal `threepipe`, mark both external.
- **Idiomatic vanilla surface (from P3):** export a `BlendLoader extends THREE.FileLoader` in addition to P1's `loadBlend(bytes) → root`, so vanilla three users get a drop-in `new BlendLoader(manager).loadAsync(url)`.

### 4.1 Precedent caveat — multi-entry is NEW build complexity (corrected)

**The cited gltf-transform precedent is the *opposite* pattern.** Verified: gltf-transform uses a **separate config file** `vite.lib.config.js` (`formats: ['es']` only, single `entry: 'src/index.ts'`) invoked as a distinct `compile:esm` script, **plus** the default `vite.config.js` for the umd/dist pass. There is **zero** in-repo precedent for object-multi-entry (`lib.entry: {index, vanilla}`) — `grep "entry:.*{"` across plugin configs returns nothing.

Two viable mechanisms (pick one at implementation time, validate dts + code-splitting under it):

- **(A) Two-config / two-pass (proven pattern).** Keep `vite.config.js` building the `.` entry (`src/index.ts`) as today; add `vite.vanilla.config.js` building `src/vanilla.ts` (ESM, three-only externals, its own dts pass), wired via a `compile:vanilla` script. Mirrors gltf-transform exactly. **Lower risk, recommended default.** The downside (no automatic shared-core code-split across the two passes → core duplicated in `index.*` and `vanilla.*`) is benign: the loader is stateless (see §7 dual-package hazard) and the tarball-size delta is small.
- **(B) Single multi-entry config (`lib.entry: {index, vanilla}`).** Tighter shared-core code-splitting, but **unprecedented in-repo**; UMD cannot express >1 entry (so it forces `cjs`), and dts/code-split behavior under object-entry must be validated from scratch. Treat as new, unproven complexity — not "templated by gltf-transform."

**The §9 effort table assumes (A).** If (B) is chosen, add ~1–2h for build validation.

---

## 5. Concrete design

### 5.1 Module / file layout

```
plugins/blend-importer/src/
  js-blend/
    main.js                 # PURE  (unchanged)
    parser/parser.js        # PURE  (unchanged)
    threejs/*               # DELETE (dead, threepipe-importing — §6 step 1)
  decompress.ts             # CORE  (edit import: gunzipSync source)
  types.ts                  # NEW   (CORE) — threepipe-free BlendFile / options interfaces (§5.6, mandatory)
  loader/
    ctx.ts                  # CORE  (imports → 'three')
    index.ts                # CORE  (imports → 'three'; drop IObject3D)
    mesh.ts                 # CORE  (imports → 'three')
    material.ts             # CORE  (imports → 'three')
    geometry.ts             # CORE  (already pure, no change)
    light.ts                # CORE  (imports → 'three')
    camera.ts               # CORE  (imports → 'three')
    defaultCtx.ts           # NEW   (CORE) — plain-three Ctx
  vanilla.ts                # NEW   — vanilla entry (./vanilla)
  BlendLoadPlugin.ts        # ADAPTER (threepipe imports stay; imports BlendFile from ./types now)
  index.ts                  # ADAPTER entry (.) — unchanged (re-exports BlendLoadPlugin + types)
```

Three layers, split **by import graph** (not folder moves):
- **Shared core** (three-only, Node-safe): `js-blend/*`, `decompress.ts`, `types.ts`, `loader/*` (incl. new `defaultCtx.ts`).
- **Vanilla entry** (`./vanilla`, three peer): new `vanilla.ts`.
- **threepipe adapter** (`.`, threepipe peer): `BlendLoadPlugin.ts` + `index.ts` (essentially unchanged).

### 5.2 `package.json` — exact `exports` map + deps + the fzstd ship-blocker

```jsonc
{
  "name": "@threepipe/plugin-blend-importer",
  "version": "0.3.0",
  "type": "module",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "sideEffects": false,

  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    },
    "./vanilla": {
      "types": "./dist/vanilla.d.ts",
      "import": "./dist/vanilla.mjs",
      "require": "./dist/vanilla.js"     // omit `require` if ./vanilla ships ESM-only (see §7 dual-package note)
    },
    "./dist/": {
      "import": "./dist/",
      "require": "./dist/"
    },
    "./package.json": "./package.json"
  },

  "typesVersions": {                       // downlevel insurance — see §5.5 / critic #9
    "*": { "vanilla": ["./dist/vanilla.d.ts"] }
  },

  "peerDependencies": {
    "three": ">=0.168.0",
    "threepipe": ">=0.1.0"
  },
  "peerDependenciesMeta": {
    "three":     { "optional": true },
    "threepipe": { "optional": true }
  },

  "dependencies": {
    "fzstd": "^0.1.1",
    "threepipe": "file:./../../src/"   // dev/local link only; emptied on publish by clean-package
  }
}
```

**SHIP-BLOCKER — `fzstd` externalization vs `clean-package` emptying `dependencies`.** Pick ONE consistent option:

- **Option (a) — keep `fzstd` BUNDLED (recommended, matches today).** Do **NOT** add `fzstd` to the Vite `external` list (§5.4). It stays inlined into `dist`, exactly as today, so `clean-package.replace.dependencies = {}` remains correct and the published tarball needs no runtime `dependencies`. The draft's earlier external list `['three','threepipe','fzstd']` is **wrong** under this option — use `['three','threepipe']`.
- **Option (b) — externalize `fzstd`.** Then you MUST change `clean-package` so `dependencies` survives publish as `{"fzstd": "^0.1.1"}` (i.e. `clean-package.replace.dependencies = {"fzstd":"^0.1.1"}`, not `{}`), otherwise consumers get `Cannot find module 'fzstd'`.

**Externalizing `fzstd` while publishing empty `dependencies` ships a broken package.** Recommend **(a)** — fewer moving parts, identical to current behavior, `fzstd` remains a bundled implementation detail and is not a declared runtime dep.

Other notes:
- **No `fflate` dependency** — `gunzipSync` comes from the `three` peer's bundled `three/examples/jsm/libs/fflate.module.js` (always externalized via `id.startsWith('three/')`).
- `./dist/` stays a **directory mapping** (leading-dot, trailing-slash, repo convention). NOTE: code-split chunks (if mechanism B) are imported **relatively** between built files and do **not** resolve through `exports` — the `./dist/` mapping is irrelevant to them (corrects an earlier misstatement). It remains for explicit consumer deep-imports.
- `clean-package` strips `scripts`/`devDependencies` as before; `dependencies` handling per the chosen option above. The `three`/`threepipe` peers remain after clean.
- `files` array: `dist` already covers both entries; keep `"src"`.

### 5.3 peerDependencies + peerDependenciesMeta rationale

- `.` (threepipe entry) needs `threepipe` (which bundles its own modded-three). `>=0.1.0` unchanged.
- `./vanilla` entry needs plain `three` only.
- **`three` floor = `>=0.168.0` (corrected).** threepipe ships `three: npm:three-modded@0.168.10006` (verified root `package.json:141/163`). The earlier `>=0.176.0` was invented. Floor at `>=0.168.0` to match the modded baseline whose `gunzipSync`/class APIs the adapter already uses. (Stock three `>=0.168` exposes the same `Light`/material classes and the same `./examples/jsm/*` export key — see §5.6 / critic #6.)
- **Both declared, both optional** via `peerDependenciesMeta`: installing to use one entry won't hard-error on the other's missing peer (npm/pnpm warn only, and only if **neither** is present). README must state which entry needs which peer.

### 5.4 Build-config changes

(Default mechanism **(A) two-config / two-pass**, per §4.1.)

`vite.config.js` (the `.`/threepipe entry — keep building `src/index.ts`):
```js
// 1. Externals: function-based matcher (gltf-transform precedent). NO blanket replace.
//    fzstd is NOT listed here -> it stays BUNDLED (see §5.2 option (a)).
rollupOptions: {
  output: { globals: { three: 'THREE', threepipe: 'threepipe' } },
  external: (id) =>
    ['three', 'threepipe'].some(dep => id === dep || id.startsWith(dep + '/')),
  //                                                  ^ catches three/examples/jsm/libs/fflate.module.js
},

// 2. DELETE the blanket three->threepipe replace plugin (vite.config.js:57-61).
//    Add a comment so future contributors know `from 'three'` in core files is intentional:
//    // NOTE: core/loader files import literally `from 'three'`; the adapter
//    //       (BlendLoadPlugin.ts) imports literally `from 'threepipe'`. Both are
//    //       marked external. There is no longer a global three->threepipe rewrite.
```

New `vite.vanilla.config.js` (the `./vanilla` entry — mirrors gltf-transform's `vite.lib.config.js`):
```js
// Single entry src/vanilla.ts, ESM output, three-only externals + fzstd bundled,
// its own vite-plugin-dts pass emitting dist/vanilla.d.ts.
lib: { entry: 'src/vanilla.ts', formats: ['es'], fileName: () => 'vanilla.mjs' },
// (add a 'cjs' format -> dist/vanilla.js ONLY if you also keep the `require` key in
//  exports./vanilla; otherwise ship ESM-only to sidestep the dual-package hazard, §7.)
rollupOptions: {
  external: (id) => ['three'].some(dep => id === dep || id.startsWith(dep + '/')),
  //                  ^ fzstd intentionally NOT external -> bundled into dist/vanilla.mjs
},
```

- The NODE_ENV `replace`, `glsl`, `json`, `license` plugins stay on each config that needs them.
- **`license` plugin** regenerates `dependencies.txt`; no `fflate` entry (none added). `fzstd` appears as a bundled dep in the license file (it always has).
- **Drop UMD for the new entry:** UMD can't express two entries; the `.` entry's UMD/CJS pass is unchanged. ESM-only for `./vanilla` is the gltf-transform `./lib` convention.
- **Scripts:** add a `compile:vanilla` (or fold into the existing `compile`/`build` script chain) so `npm run build` runs both passes.

### 5.5 TypeScript types delivery per entry

`vite-plugin-dts` emits per-file `.d.ts` from each entry/pass:
- `dist/index.d.ts` — re-exports `{BlendLoadPlugin}` + `{BlendFile, BlendLoadOptions}`. Its `.d.ts` transitively references threepipe types — **fine**, only the `.`-entry consumer resolves it, and they have threepipe installed.
- `dist/vanilla.d.ts` — exports `BlendLoader`, `loadBlend`, `defaultBlendCtx`, `createObjects`, `decompressBlend`, `parseBlend`, and `Ctx`/`BlendFile`/`LoadBlendOptions` types. **Because `BlendFile`/`BlendLoadOptions` move to the threepipe-free `src/types.ts` (§5.6, mandatory), these reference only `three` types** — a vanilla consumer with only `three` installed gets fully-resolved types and **no phantom threepipe dependency**. (Earlier claim that `vanilla.d.ts` already referenced "only three types" was false while `BlendFile` lived in `BlendLoadPlugin.ts`; the `types.ts` move makes it true.)
- Shared `loader/*.d.ts`, `js-blend/*.d.ts` emitted three-typed, resolve for both consumers.

`declarationMap` stays on.

**`typesVersions` for downlevel `require` (corrected — critic #9).** The package publishes a CJS `require` entry. Consumers on classic `node`/`node10` module resolution using `require()` do **not** read subpath `exports.types` and would fail to find `./vanilla` types. Add the cheap insurance `typesVersions: {"*": {"vanilla": ["./dist/vanilla.d.ts"]}}` (already in §5.2) **or** document that `./vanilla` requires TS 4.7+ with `node16`+/`bundler` resolution. The `typesVersions` shim is recommended — near-zero cost.

### 5.6 How the `*2`/`*0` classes, types, and decompress coupling are resolved

**`*2`/`*0` behavioral classes (Category B):** already abstracted by `Ctx`. This design makes the abstraction the package boundary.
- **threepipe entry (`.`):** `BlendLoadPlugin.ts` builds its `ctx` exactly as today (lines 139–153): `{Object3D: Object3D2, Mesh: Mesh2, MeshPhysicalMaterial: PhysicalMaterial, MeshBasicMaterial: UnlitMaterial, PerspectiveCamera: PerspectiveCamera0, OrthographicCamera: OrthographicCamera0, PointLight: PointLight2, DirectionalLight: DirectionalLight2, SpotLight: SpotLight2, AmbientLight: AmbientLight2, BufferGeometry: BufferGeometry2, BufferAttribute, loadExternalTexture: ...}`. Unchanged. The core never names these; `*2`/`*0` stay inside the adapter.
- **vanilla entry (`./vanilla`):** injects `defaultBlendCtx` (new `loader/defaultCtx.ts`) = plain three classes:
  ```ts
  // src/loader/defaultCtx.ts
  import {AmbientLight, BufferAttribute, BufferGeometry, DirectionalLight, Mesh,
          MeshBasicMaterial, MeshPhysicalMaterial, Object3D, OrthographicCamera,
          PerspectiveCamera, PointLight, SpotLight} from 'three'
  import type {Ctx} from './ctx'
  export const defaultBlendCtx: Ctx = {
    Object3D, Mesh, MeshPhysicalMaterial, MeshBasicMaterial,
    PerspectiveCamera, OrthographicCamera,
    PointLight, SpotLight, DirectionalLight, AmbientLight,
    BufferGeometry, BufferAttribute,
    // loadExternalTexture omitted (optional) — vanilla.ts injects a TextureLoader-based one when in DOM
  }
  ```
  Plain three has no `setDirty`; the existing `if (obj.setDirty) obj.setDirty()` (`index.ts:112`) is a safe no-op. Consumers may pass their own `ctx` (e.g. a custom `Mesh` subclass) to override.

**Material color-space identity across both ctx paths (why output is identical — critic #7).** The shared core sets `texture.colorSpace = SRGBColorSpace` **explicitly per texture** for base/emissive maps and leaves data maps at default linear/`NoColorSpace` (verified `material.ts` + the adapter's path-loader sets srgb explicitly). Color management is therefore **not** inherited from the material class — so vanilla `MeshPhysicalMaterial` and threepipe `PhysicalMaterial` produce identical color-space results. (No bug; stated so a reviewer can confirm.)

**`Ctx` type:** lifted from private helper to part of the `./vanilla` public surface. Structurally identical; its fields reference `three` types instead of threepipe re-exports (same runtime classes; threepipe's `*2`/`*0` are structural subtypes, so the adapter's `ctx` literal still type-checks).

**`BlendFile` / `BlendLoadOptions` → `src/types.ts` (MANDATORY, not fallback — critic #12).** `BlendFile`/`BlendLoadOptions` are currently declared in `BlendLoadPlugin.ts`, which imports `Object3D`/`Texture`/etc. **from `'threepipe'` at module top**. A `import type {BlendFile} from './BlendLoadPlugin'` in `vanilla.ts` therefore drags threepipe **types** into `dist/vanilla.d.ts` (and risks a runtime pull if the bundler downgrades the type-only import). **Fix now:** move the `BlendFile`/`BlendLoadOptions` interfaces into a new threepipe-free `src/types.ts` (they only reference `Object3D` + plain data → `from 'three'`), re-export from both `index.ts` and `vanilla.ts`, and have `BlendLoadPlugin.ts` import them from `./types`. This makes `vanilla.d.ts` genuinely threepipe-free and removes the §7 leak risk entirely (CI grep remains as a regression guard).

**`IObject3D` swap (`loader/index.ts`):** `setTransform` uses `setDirty` at line 112. Drop the `IObject3D` import; annotate the param as `Object3D & {setDirty?: () => void}`:
```ts
// loader/index.ts
import {Euler, EulerOrder, Object3D, Quaternion, Vector3} from 'three'
function setTransform(object: any, obj: Object3D & {setDirty?: () => void}) { ... /* keep existing: if (obj.setDirty) obj.setDirty() */ }
```
The loose optional type is correct for both paths — `*2` objects (adapter) have a real `setDirty`, plain three (vanilla) doesn't and the guard no-ops. Keep the existing `if (obj.setDirty) obj.setDirty()` form.

**decompress coupling:** `decompress.ts:1` becomes:
```ts
import {gunzipSync} from 'three/examples/jsm/libs/fflate.module.js'
```
Same fflate three already bundles (verified `three.js-modded/.../fflate.module.js:1376`), same API, byte-identical output, Node-safe. The `./examples/jsm/*` export key exists in three-modded@0.168 **and** in stock three (same key) — so the specifier is portable for vanilla consumers on stock three. Externalized via `id.startsWith('three/')` so Rollup doesn't inline three's fflate. `fzstd` stays bundled for zstd. The whole decompress path is then three-only.

> **Stock-three verification gap (critic #6):** the `three/examples/jsm/libs/fflate.module.js` specifier has only been verified against three-**modded**. Add a CI/scratch check that imports `decompress.ts`'s path against a **stock** `three` install (not just types) — see §8.4.

### 5.7 New `src/vanilla.ts` (sketch)

```ts
import {FileLoader, type LoadingManager, Object3D, TextureLoader, SRGBColorSpace, type Texture} from 'three'
import {parseBlend} from './js-blend/main.js'
import {decompressBlend} from './decompress'
import {createObjects} from './loader'
import {defaultBlendCtx} from './loader/defaultCtx'
import type {Ctx} from './loader/ctx'
import type {BlendFile} from './types'   // threepipe-free module (§5.6) — no runtime/types threepipe pull

export {decompressBlend} from './decompress'
export {parseBlend} from './js-blend/main.js'
export {createObjects} from './loader'
export {defaultBlendCtx} from './loader/defaultCtx'
export type {Ctx} from './loader/ctx'
export type {BlendFile} from './types'

export interface LoadBlendOptions {
  ctx?: Partial<Ctx>
  onBlendLoad?: (blend: BlendFile) => void
}

/** Parse decompressed .blend bytes into a plain three Object3D root. Bytes-in / root-out. */
export async function loadBlend(buffer: ArrayBuffer, options: LoadBlendOptions = {}): Promise<Object3D> {
  const blend = await parseBlend(decompressBlend(buffer))
  const ctx: Ctx = {...defaultBlendCtx, ...options.ctx}
  const objects = await createObjects(blend, ctx)
  const root = new Object3D()
  root.add(...objects)
  blend.scene = root
  options.onBlendLoad?.(blend)
  return root
}

/** Drop-in three loader: `new BlendLoader(manager).loadAsync(url)` → Object3D root. */
export class BlendLoader extends FileLoader {
  constructor(manager?: LoadingManager) { super(manager); this.setResponseType('arraybuffer') }
  async loadAsync(url: string, onProgress?: (e: ProgressEvent) => void): Promise<Object3D> {
    const buf = (await super.loadAsync(url, onProgress)) as ArrayBuffer
    // Optional DOM texture support via three's TextureLoader, mirroring the plugin's path-normalization + Node guard.
    const ctx: Partial<Ctx> = typeof document === 'undefined' ? {} : {
      loadExternalTexture: (p: string, srgb: boolean): Texture | null => {
        const path = p.replace(/^\/\//, '').replace(/\\/g, '/').replace(/^\.\//, '')
        if (!path) return null
        const tex = new TextureLoader(this.manager).load(path, undefined, undefined,
          () => console.warn('BlendLoader - external texture not found:', p))
        if (srgb) tex.colorSpace = SRGBColorSpace
        return tex
      },
    }
    return loadBlend(buf, {ctx})
  }
}
```

> Build-time guard: after the `types.ts` move, `vanilla.*` must not contain the string `threepipe` (runtime) and `vanilla.d.ts` must not reference threepipe types. The CI grep (§8.3) enforces this.

---

## 6. Step-by-step implementation plan (ordered, each independently verifiable)

1. **Delete dead files.** Remove `src/js-blend/threejs/` (5 files: `blend_three.js`, `light.js`, `material.js`, `mesh.js`, `texture.js`) — verified unreferenced. *Verify:* `grep -rn "js-blend/threejs" src` returns nothing; full build still succeeds.

2. **Create `src/types.ts`** and move `BlendFile`/`BlendLoadOptions` interfaces into it (`from 'three'`); update `BlendLoadPlugin.ts` to import them from `./types`; re-export from `index.ts`. *Verify:* `tsc --noEmit` clean; `grep -n "from 'threepipe'" src/types.ts` returns nothing.

3. **Rewrite core import sources `'threepipe'` → `'three'`** in the 6 loader files: `loader/ctx.ts`, `loader/index.ts`, `loader/mesh.ts`, `loader/material.ts`, `loader/light.ts`, `loader/camera.ts`. (`loader/geometry.ts` is already pure.) Keep `Light` in `light.ts` (used in type position). *Verify:* `grep -rn "from 'threepipe'" src/loader` returns nothing.

4. **Resolve `IObject3D` in `loader/index.ts`.** Drop `IObject3D`; annotate `setTransform`'s `obj` param as `Object3D & {setDirty?: () => void}`; keep the `index.ts:112` guard form. *Verify:* `tsc --noEmit` clean on the file.

5. **Fix `decompress.ts`.** Change line 1 to `import {gunzipSync} from 'three/examples/jsm/libs/fflate.module.js'`. *Verify:* `grep -n threepipe src/decompress.ts` returns nothing; a Node unit decode of a gzip-compressed fixture matches an uncompressed/zstd decode of the same scene.

6. **Add `src/loader/defaultCtx.ts`** (plain-three `Ctx`, §5.6). *Verify:* `tsc --noEmit` clean; imports only from `three`.

7. **Add `src/vanilla.ts`** (`loadBlend` + `BlendLoader` + re-exports, §5.7). *Verify:* `tsc --noEmit` clean; `grep -n "from 'threepipe'" src/vanilla.ts` returns nothing.

8. **Build config (§5.4).** Edit `vite.config.js`: function-based `external` `['three','threepipe']` (fzstd NOT external — bundled), **remove** the blanket replace, add the comment. Add `vite.vanilla.config.js` (ESM, three-only external, own dts) and a `compile:vanilla` script wired into `build`. *Verify:* `npm run build` emits `dist/index.mjs`, `dist/index.js`, `dist/vanilla.mjs`, `dist/index.d.ts`, `dist/vanilla.d.ts`.

9. **`package.json` (§5.2/5.3).** Add `"sideEffects": false`, `./vanilla` exports entry, `typesVersions` shim, `peerDependencies` (`three >=0.168.0`, `threepipe >=0.1.0`) + `peerDependenciesMeta` (both optional). **Keep `clean-package.replace.dependencies = {}`** (consistent with fzstd bundled — option (a)). *Verify:* `node -e "require('@threepipe/plugin-blend-importer/package.json')"` resolves; `exports` JSON valid.

10. **Build-output hygiene assertions (CI gate, §8.3):** post-build, assert `dist/vanilla.mjs` contains **no** `threepipe` substring and `dist/vanilla.d.ts` references no threepipe types. *Verify:* grep guard passes.

11. **Vanilla smoke test (Node).** New unit test imports `@threepipe/plugin-blend-importer/vanilla`, runs `loadBlend(fixtureBytes)` in Node across all 3 compression kinds, asserts the returned `Object3D` root + expected child/light/camera/geometry counts. Texture expectations per §8.1 (both external AND packed textures resolve to **null** in Node). *Verify:* `npm run test:unit` passes.

12. **threepipe regression (existing e2e).** Confirm `examples/blend-load` (+ `model-viewer`, `tweakpane-editor`) still load via the Playwright screenshot harness. **Note (corrected — critic #3):** these examples alias the bare name to **`src/index.ts`** (`vite.examples.config.js:22`), NOT `dist/index.mjs` — so e2e exercises the **source** import-rewrite, needs **no dist rebuild**, and the built-bundle isolation is covered only by the §8.3 grep. *Verify:* `npm run test:e2e` for those examples passes; `tests/snapshots/<platform>/blend-load/console.log` clean.

13. **Docs + CHANGELOG.** Add a `./vanilla` usage section to `plugins/blend-importer/README.md`; **create** the website plugin page (none exists yet — critic #16). State which entry needs which peer, that vanilla gets plain three objects (no reactivity/UI/serialization), and that all DOM-texture paths (external + packed) degrade to null in Node. Note `three` optional peer + the `0.3.0` bump in `CHANGELOG.md`. *Verify:* docs render; README examples copy-pasteable.

---

## 7. Risks & open questions

- **`BlendFile` type leak into `vanilla.*`** — **mitigated by the mandatory `types.ts` move (§5.6 step 2)**, so this is no longer a live risk; the §8.3 CI grep remains as a regression guard.
- **Shared-core duplication across entries/formats** (low). With mechanism (A) two-config, core is duplicated in `index.*` and `vanilla.*`. Benign (no correctness issue): loader is stateless. If size matters, switch to mechanism (B) multi-entry (adds build complexity, §4.1).
- **Dual-package hazard (ESM/CJS)** (low — newly addressed, critic #8). If `./vanilla` ships both `.mjs` and `.js` and a consumer's graph pulls both copies, `instanceof`/`WeakMap` identity could diverge across the two parser/decompress copies. **The loader is stateless (no cross-format identity checks), so the hazard is benign here.** Cleanest sidestep: ship `./vanilla` **ESM-only** (drop the CJS `require` key), matching gltf-transform's `./lib`. Recommended unless a CJS-only vanilla consumer is known.
- **Dropping UMD for `./vanilla`** (low). ESM (+ optional CJS) cover all known consumers; UMD global of a Node-safe loader has little value.
- **Two optional peers → npm/pnpm warnings** (low). If a consumer installs **neither** peer, both warn. README must state which entry needs which.
- **Vanilla = stock three, not the modded fork** (low–medium). The loader touches only standard three classes/constants/`SRGBColorSpace` and the `./examples/jsm/*` fflate path (all present in stock three), so stock three works. **Verify against a stock-three install in CI (§8.4)** — a future loader change depending on modded-three behavior would silently break vanilla; the smoke test + stock-three type/import check guard this.
- **`sideEffects: false` correctness** (verified safe — critic #10). No core module has top-level side effects; `material.ts` packed-texture DOM calls (`Blob`/`URL`/`Image`) are inside functions, guarded by `typeof Blob === 'undefined'`. Safe to declare.
- **Open question — resolved:** `three` peer floor is `>=0.168.0` (matches shipped `three-modded@0.168.10006`), no longer open.
- **Open question:** whether to also expose `loadBlend`/`createObjects`/`decompressBlend`/`parseBlend` from the `.` entry for parity. Recommendation: keep `.` minimal (`BlendLoadPlugin` + types only) to avoid widening the threepipe API surface; advanced users use `./vanilla`.
- **Open question — naming (critic #14):** the established repo convention for a secondary entry is `./lib` (gltf-transform). This plan uses `./vanilla` (semantically clearer for "vanilla three.js"). Confirm the preferred subpath name before publishing; `./vanilla` recommended for clarity.

---

## 8. Testing strategy

**Both consumers, plus Node/SSR safety of the texture paths.**

### 8.1 Vanilla (Node, no DOM) smoke test — unit (Vitest)
Import `@threepipe/plugin-blend-importer/vanilla`; `await loadBlend(fixtureBytes)`; assert: returns a `THREE.Object3D` root; expected counts of meshes/lights/cameras for a known fixture `.blend`; geometry has positions; materials are plain `MeshPhysicalMaterial`/`MeshBasicMaterial`. Run against **all three** compression kinds (uncompressed, gzip via the new fflate source, zstd via fzstd) to lock the decompress fix.

**Corrected texture expectation (critic #11):** because `typeof document === 'undefined'` (and `typeof Blob === 'undefined'`) in Node, **both** the external-file-path texture hook (`loadExternalTexture` omitted) **and** the packed-texture path (`material.ts:packedTexture`, which calls `Blob`/`URL`/`Image` directly, not via the ctx hook) resolve to **null** without throwing. The earlier draft's "packed textures still load" was **false** — assert that in Node **both** external and packed textures resolve to null, while geometry/material/transform load fine. This verifies graceful SSR degradation (mirrors the existing Node guard at `BlendLoadPlugin.ts:38`).

### 8.2 threepipe (browser) screenshot harness — existing e2e (Playwright)
Run `examples/blend-load` (+ `model-viewer`, `tweakpane-editor`) unchanged through the screenshot harness; diff against existing snapshots to prove byte-identical plugin behavior (same `*2`/`*0` output, external textures via LoadingManager, asset-pipeline upgrades). Check `tests/snapshots/<platform>/blend-load/console.log`. **No example/importmap edits expected** — examples alias the bare name to `src/index.ts` (`vite.examples.config.js:22`), so the harness re-runs the source import-rewrite directly (no dist rebuild needed). Consequently this path does **not** test the built `dist` bundle — §8.3 is the only thing exercising dist isolation.

### 8.3 Build-output isolation (CI gate)
Post-`npm run build`:
- `grep -L threepipe dist/vanilla.mjs` must show the file (it must NOT contain `threepipe`); likewise `dist/vanilla.js` if CJS is shipped.
- `dist/vanilla.d.ts` must not reference `threepipe` types.
- (Mechanism B only) assert a shared chunk exists / core not duplicated verbatim across `index.mjs` and `vanilla.mjs`.

### 8.4 Type + import resolution against stock three (critic #6/#9)
In a scratch dir with **only stock `three`** installed:
- `tsc` against `import {BlendLoader} from '@threepipe/plugin-blend-importer/vanilla'` resolves with no unresolved-threepipe-type errors.
- **Runtime import** check: `import {gunzipSync} from 'three/examples/jsm/libs/fflate.module.js'` (the `decompress.ts` path) actually resolves against the stock-three install — not just its types.
- Separately, in a dir with only `threepipe`, `import {BlendLoadPlugin} from '@threepipe/plugin-blend-importer'` resolves.
- (Downlevel) optionally verify `./vanilla` types resolve under classic `node` resolution via the `typesVersions` shim.

---

## 9. Effort estimate

**Low–moderate, ~0.5–1 day** (the `Ctx` DI already did the architectural work; remaining work is mechanical). Assumes build **mechanism (A)** (two-config). Add ~1–2h if mechanism (B) multi-entry is chosen.

| Work | Est. |
|---|---|
| Delete dead `js-blend/threejs/*` | 5 min |
| Create `src/types.ts`, move `BlendFile`/`BlendLoadOptions`, rewire imports | 20 min |
| Rewrite 6 loader import sources → `three` | 15 min |
| `IObject3D` → `Object3D & {setDirty?}` swap | 10 min |
| `decompress.ts` gunzipSync source fix | 5 min |
| New `loader/defaultCtx.ts` (~15 lines) | 15 min |
| New `vanilla.ts` (`loadBlend` + `BlendLoader`, ~60 lines) | 45 min |
| `vite.config.js` cleanup + new `vite.vanilla.config.js` + build script | 1–1.5 h |
| `package.json` exports/peers/typesVersions/sideEffects (fzstd-bundled consistency) | 20 min |
| Vanilla Node smoke test + fixture (3 compression kinds, corrected texture asserts) | 1 h |
| CI grep guard + stock-three resolution check + verify e2e snapshots unchanged | 1.5 h |
| README + create website plugin page + CHANGELOG | 1 h |

No core threepipe changes, no parser/algorithm changes, no test rewrites (existing plugin tests pass unchanged). The one genuinely new build element is the **second Vite config** (mechanism A, templated by `plugins/gltf-transform/vite.lib.config.js`) — NOT object-multi-entry, which has no in-repo precedent.

---

## 10. Pick-up checklist (when resuming)

1. Re-read §5.2 ship-blocker: confirm `fzstd` stays **bundled** and `clean-package.replace.dependencies = {}` — do NOT externalize `fzstd` without also un-emptying it.
2. Confirm the `three` peer floor against the *currently shipped* `three-modded` minor (was `0.168.10006`; floor `>=0.168.0`).
3. Do the `src/types.ts` move FIRST — it's a prerequisite for a clean `vanilla.d.ts`.
4. Decide build mechanism (A two-config recommended) and `./vanilla` CJS vs ESM-only (ESM-only sidesteps the dual-package hazard).
5. Decide subpath name `./vanilla` vs `./lib` (repo convention).
6. Implement steps §6.1–13 in order; gate on §8.3 + §8.4.

---

## 11. Relevant files

- `/Users/palash/Projects/threepipe/plugins/blend-importer/package.json`
- `/Users/palash/Projects/threepipe/plugins/blend-importer/vite.config.js`
- `/Users/palash/Projects/threepipe/plugins/blend-importer/src/decompress.ts`
- `/Users/palash/Projects/threepipe/plugins/blend-importer/src/BlendLoadPlugin.ts`
- `/Users/palash/Projects/threepipe/plugins/blend-importer/src/index.ts`
- `/Users/palash/Projects/threepipe/plugins/blend-importer/src/loader/ctx.ts`
- `/Users/palash/Projects/threepipe/plugins/blend-importer/src/loader/index.ts`
- `/Users/palash/Projects/threepipe/plugins/blend-importer/src/loader/material.ts`
- `/Users/palash/Projects/threepipe/plugins/blend-importer/src/loader/geometry.ts`
- `/Users/palash/Projects/threepipe/plugins/blend-importer/src/js-blend/main.js`
- `/Users/palash/Projects/threepipe/plugins/gltf-transform/vite.lib.config.js` (two-config dual-build precedent)
- `/Users/palash/Projects/threepipe/vite.examples.config.js` (line 22 — examples alias the plugin to `src/index.ts`)
- `/Users/palash/Projects/threepipe/package.json` (ships `three: npm:three-modded@0.168.10006`)
- `/Users/palash/Projects/threepipe/three.js-modded/examples/jsm/libs/fflate.module.js` (`gunzipSync` at line 1376)
