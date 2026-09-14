# WebGPU Shader Research: GLSL, TSL, and Migration Reality

**Date**: 2026-03-24
**Status**: Research complete, findings definitive
**Relevance**: Critical for threepipe WebGPU migration strategy

---

## Executive Summary

The WebGPURenderer uses a **completely new shader pipeline** based on the Node Material system and TSL (Three Shading Language). There is **NO GLSL support** in the WebGPU backend. Standard three.js materials (MeshStandardMaterial, etc.) work automatically because they are **silently converted to NodeMaterials**. Custom GLSL shaders via `onBeforeCompile`, `ShaderMaterial`, and `RawShaderMaterial` are **completely unsupported** and silently fail or throw errors. The `glslFn()` function is **WebGL-backend only** -- it does NOT transpile GLSL to WGSL. There is no built-in GLSL-to-WGSL transpiler in three.js and no plan to add one.

---

## Q1: How Does WebGPURenderer Handle Standard Materials?

### Answer: Automatic conversion via NodeMaterial.fromMaterial()

When a `MeshStandardMaterial` or `MeshPhysicalMaterial` is passed to the renderer, the node system **automatically converts it** to its node-based equivalent. The flow is:

1. `Renderer._renderObjectDirect()` calls `this._nodes.updateForRender(renderObject)`
2. `Nodes.getForRender()` calls `this.backend.createNodeBuilder()`, which creates either:
   - `WGSLNodeBuilder` (WebGPU backend) -- uses `WGSLNodeParser`
   - `GLSLNodeBuilder` (WebGL backend) -- uses `GLSLNodeParser`
3. `nodeBuilder.build()` calls **`NodeMaterial.fromMaterial(material)`** at line 1098 of `NodeBuilder.js`
4. This creates e.g. `MeshStandardNodeMaterial` from `MeshStandardMaterial` by:
   - Looking up `"MeshStandardNodeMaterial"` in a registry (replacing `"Material"` with `"NodeMaterial"` in the type string)
   - Copying all properties from the original material
5. The NodeMaterial then **builds itself entirely through the node graph** -- calling `setup()`, `setupPosition()`, `setupDiffuseColor()`, `setupVariants()`, `setupLighting()`, etc.
6. Each of these methods constructs a **node tree in JavaScript** (TSL), NOT GLSL strings
7. The node tree is then traversed by the NodeBuilder to generate either WGSL (WebGPU) or GLSL (WebGL)

### Key Insight

**TSL is involved in ALL material paths.** Even a plain `MeshStandardMaterial` loaded by GLTFLoader goes through TSL. The original GLSL shader chunks (`meshphysical.glsl.js`, etc.) in `three/src/renderers/shaders/` are **only used by the legacy WebGLRenderer** -- they are NEVER used by WebGPURenderer.

The node-based materials (`MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, etc.) are **reimplementations** of the same lighting/PBR logic, but expressed as node graphs instead of GLSL templates. They produce visually equivalent results but through a completely different code path.

### Source Files (in threepipe's three.js v0.163.10003)

- Conversion: `/node_modules/three/examples/jsm/nodes/core/NodeBuilder.js` line 1098
- `fromMaterial()`: `/node_modules/three/examples/jsm/nodes/materials/NodeMaterial.js` line 564
- Standard node material: `/node_modules/three/examples/jsm/nodes/materials/MeshStandardNodeMaterial.js`
- WGSL code generation: `/node_modules/three/examples/jsm/renderers/webgpu/nodes/WGSLNodeBuilder.js`
- WebGPU backend entry: `/node_modules/three/examples/jsm/renderers/webgpu/WebGPUBackend.js` line 1115

---

## Q2: Can GLSL Be Used With WebGPU At All?

### Answer: NOT natively. External transpilers exist but are heavy.

**The WebGPU API only accepts WGSL.** There is no GLSL extension in the WebGPU spec. Chrome's Dawn (via Tint) and Firefox's wgpu (via Naga) both compile WGSL internally, but do not expose GLSL input to the web.

### Available Transpiler Options

| Tool | Route | Size | Status | Usable in Browser? |
|------|-------|------|--------|-------------------|
| **Naga (wasm-naga)** | GLSL -> WGSL directly | ~694KB uncompressed, ~100KB gzipped target | Dormant (last commit 2020) | Yes (WASM) |
| **BabylonJS/twgsl** | SPIR-V -> WGSL (needs glslang for GLSL->SPIR-V first) | ~2MB WASM total pipeline | Maintained by BabylonJS team | Yes (WASM) |
| **Babylon.js runtime** | GLSL -> SPIR-V -> WGSL | ~2MB WASM compiler download | Production (Babylon 8.0) | Yes, but Babylon-specific |
| **cross-shader** | GLSL -> SPIR-V -> various (NO WGSL output) | Unknown | Dormant (last commit 2023) | Yes (WASM) |
| **@use-gpu/shader** | Linking only, no transpilation | Small | Active | Yes |
| **Tint (Chrome)** | SPIR-V/WGSL -> various | Not available standalone for web | N/A | No (C++ only) |

### Bottom Line

There is **no lightweight, maintained, JavaScript GLSL-to-WGSL transpiler** suitable for embedding in a library like threepipe. The only production-quality solution is Babylon.js's approach (2MB WASM download), which is specific to their engine.

**Three.js's official stance** (from issue #26719): *"We do not, to my knowledge, plan to transpile shaders from GLSL to WGSL."*

---

## Q3: What Does onBeforeCompile Do With WebGPURenderer?

### Answer: It is SILENTLY IGNORED.

`onBeforeCompile` is defined on the `Material` base class at `three/src/materials/Material.js:111` as an empty function. It is **only called** in `WebGLRenderer.js:1729`:

```javascript
material.onBeforeCompile( parameters, _this );
```

The WebGPURenderer (both its Renderer base class and its backends) **never calls onBeforeCompile**. There is zero reference to it in:
- `/examples/jsm/renderers/common/Renderer.js`
- `/examples/jsm/renderers/common/nodes/Nodes.js`
- `/examples/jsm/renderers/webgpu/WebGPUBackend.js`
- `/examples/jsm/renderers/webgl/WebGLBackend.js`
- Any node material file

**It does not throw an error.** The callback is simply never invoked. Any shader modifications made through `onBeforeCompile` will silently produce incorrect rendering -- the material will render with its default behavior as if the callback was never set.

### Migration Path

The official replacement is **TSL node properties** on NodeMaterials:
- `material.colorNode` -- replaces diffuseColor modifications
- `material.normalNode` -- replaces normal modifications
- `material.positionNode` -- replaces vertex position modifications
- `material.opacityNode` -- replaces alpha/opacity modifications
- `material.outputNode` -- replaces final color modifications
- `material.fragmentNode` -- replaces entire fragment shader
- `material.vertexNode` -- replaces entire vertex shader

Example migration from `onBeforeCompile`:
```javascript
// OLD (onBeforeCompile):
material.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    'vec4 diffuseColor = vec4( diffuse, opacity );',
    'vec4 diffuseColor = vec4( diffuse, opacity );\n' +
    'float alphaFactor = smoothstep(-fade, 0.0, edgePos);\n' +
    'diffuseColor.a *= alphaFactor;'
  );
};

// NEW (TSL):
import { Fn, uv, smoothstep, fwidth, materialOpacity } from 'three/tsl';

material.opacityNode = Fn(() => {
  const mapUv = uv();
  const alphaFactor = smoothstep(
    fwidth(mapUv.x).mul(1.5).negate(), 0, mapUv.x
  );
  return materialOpacity.mul(alphaFactor);
})();
```

---

## Q4: What Is glslFn() Really Capable Of?

### Answer: Individual functions only, WebGL backend only.

`glslFn()` creates a `FunctionNode` with `language='glsl'`. It can define **individual functions**, not complete shaders. It works by:

1. The FunctionNode stores the GLSL code string and `language='glsl'`
2. When `generate()` is called, it invokes `builder.parser.parseFunction(this.code)`
3. The **builder's parser** is determined by the backend:
   - WebGPU backend: `WGSLNodeParser` -- expects WGSL `fn` syntax
   - WebGL backend: `GLSLNodeParser` -- expects GLSL function syntax

### CRITICAL FINDING: glslFn() FAILS with the WebGPU backend

When the WebGPU backend is active, `WGSLNodeParser.parseFunction()` tries to parse a GLSL function declaration like `float myFunc(vec3 a) { ... }` using a regex that expects WGSL syntax like `fn myFunc(a: vec3<f32>) -> f32 { ... }`. This will **throw an error**: `"FunctionNode: Function is not a WGSL code."`

**There is NO cross-compilation.** The `language` property on CodeNode/FunctionNode is stored but **never checked** by the node builder to select an appropriate parser. The builder always uses the parser matching its backend.

### What glslFn CAN do (WebGL backend only)

- Define individual GLSL utility functions
- Reference other glslFn functions via includes
- Be called from TSL nodes (e.g., assigned to `material.colorNode`)
- Accept TSL node inputs as parameters

### What glslFn CANNOT do

- Work with the WebGPU backend (throws error)
- Define complete vertex or fragment shaders
- Replace onBeforeCompile patches
- Access three.js built-in uniforms/varyings directly (must pass as parameters)

### Source Evidence

- `FunctionNode.getNodeFunction()`: `NodeBuilder.js` line 35 -- calls `builder.parser.parseFunction()`
- `WGSLNodeParser.parseFunction()`: throws on non-WGSL code
- `WGSLNodeFunction` regex: `/^[fn]*\s*([a-z_0-9]+)?\s*\(([\s\S]*?)\)\s*[\-\>]*\s*([a-z_0-9]+)?/i`
- This regex requires `fn` keyword and WGSL parameter syntax

---

## Q5: Community Solutions for GLSL -> WebGPU in Three.js?

### Answer: None that are production-ready.

There are **no known community packages** that solve GLSL-to-WebGPU for three.js specifically. The community consensus is:

1. **Rewrite in TSL** -- the official recommended path
2. **Use wgslFn() for native WGSL** -- if you must write raw shader code for the WebGPU backend
3. **Dual code paths** -- write both `glslFn()` for WebGL and `wgslFn()` for WebGPU, selected at runtime based on backend
4. **Pure TSL** -- avoid native code entirely, use the JavaScript-based TSL nodes

### The `Fn()` TSL Function -- The Real Alternative

The recommended replacement for both `glslFn()` and `onBeforeCompile` is `Fn()` (the TSL function builder):

```javascript
import { Fn, float, vec3, dot, pow, sub } from 'three/tsl';

const fresnel = Fn(({ viewDir, normal }) => {
  const vDotN = dot(viewDir, normal);
  return pow(sub(1.0, vDotN), float(3.0));
});

material.colorNode = fresnel({ viewDir: viewDirection, normal: normalLocal });
```

TSL `Fn()` compiles to **both WGSL and GLSL** automatically, making it the only truly cross-backend solution.

---

## Q6: How Does WebGLBackend of WebGPURenderer Handle Shaders?

### Answer: It generates GLSL through the node system, NOT through the legacy WebGLRenderer path.

When `WebGPURenderer` uses the `WebGLBackend` (either through `forceWebGL: true` or automatic fallback):

1. `WebGLBackend.createNodeBuilder()` returns `new GLSLNodeBuilder()`
2. `GLSLNodeBuilder` uses `GLSLNodeParser` and generates **GLSL output**
3. The node material system is still used (NodeMaterial.fromMaterial() is still called)
4. TSL code compiles to GLSL via `GLSLNodeBuilder`
5. The resulting GLSL is passed to WebGL2

### Key Point

**onBeforeCompile STILL does NOT work** with the WebGLBackend of WebGPURenderer. The WebGLBackend uses a completely different code path than the legacy WebGLRenderer. It's WebGL2 + node system, not WebGL2 + traditional shader program compilation.

However, **glslFn() DOES work** with the WebGLBackend, because the `GLSLNodeBuilder` uses `GLSLNodeParser` which can parse GLSL function syntax.

### Summary Table

| Feature | Legacy WebGLRenderer | WebGPURenderer + WebGLBackend | WebGPURenderer + WebGPUBackend |
|---------|---------------------|-------------------------------|-------------------------------|
| Standard materials | GLSL templates | Node system -> GLSL | Node system -> WGSL |
| onBeforeCompile | Works | **IGNORED** | **IGNORED** |
| ShaderMaterial | Works | **NOT SUPPORTED** | **NOT SUPPORTED** |
| RawShaderMaterial | Works | **NOT SUPPORTED** | **NOT SUPPORTED** |
| glslFn() | N/A | **Works** | **FAILS (throws error)** |
| wgslFn() | N/A | **FAILS** | **Works** |
| TSL Fn() | N/A | **Works (generates GLSL)** | **Works (generates WGSL)** |
| Node material properties | N/A | **Works** | **Works** |

---

## Q7: WGSL Tools and Cross-Compilation

### Available Tools

- **wgsl_reflect** (npm): WGSL parser and reflection library. Useful for analyzing WGSL shaders but doesn't help with GLSL conversion.
- **@use-gpu/shader**: Links shader snippets (WGSL or GLSL) with tree-shaking. Does NOT transpile between languages.
- **BabylonJS/twgsl**: SPIR-V to WGSL via Google's Tint compiled to WASM. Could theoretically be used with a separate GLSL->SPIR-V step (via glslang), but results in a ~2MB WASM dependency. Not an npm package.
- **wasm-naga**: Naga compiled to WASM, supports GLSL input -> WGSL output. ~100KB gzipped. But dormant since 2020.

### Recommendation

For threepipe's migration, **do NOT rely on GLSL-to-WGSL transpilation**. The only viable path is:

1. **TSL (Fn())** for all new shader code -- works on both backends
2. **Node material properties** (colorNode, positionNode, etc.) for extending standard materials
3. **Conditional glslFn()/wgslFn()** only when absolutely necessary for performance-critical native code, with detection of the active backend
4. **Complete rewrite of onBeforeCompile patches** to TSL node-based equivalents

---

## Implications for Threepipe

### What Breaks

1. **ALL onBeforeCompile patches** -- silently produce wrong results
2. **ALL ShaderMaterial / RawShaderMaterial usage** -- will not render
3. **ALL glslFn() calls** -- will throw on WebGPU backend
4. **Any direct GLSL string manipulation** -- no longer applicable

### What Works Automatically

1. Standard materials (MeshStandardMaterial, MeshPhysicalMaterial, etc.) -- auto-converted via NodeMaterial.fromMaterial()
2. Material properties (color, roughness, metalness, map, normalMap, etc.) -- transferred to node material
3. GLTFLoader-loaded models with standard materials -- work out of the box
4. Scene graph, geometry, textures, lights -- all unchanged

### Migration Strategy

The migration MUST go through TSL. There is no shortcut, no transpiler, no compatibility layer. Every piece of custom shader code in threepipe needs to be:

1. **Identified** -- audit all onBeforeCompile, ShaderMaterial, glslFn usage
2. **Understood** -- what does each shader patch actually do?
3. **Rewritten in TSL** -- using Fn(), node properties, or wgslFn() for native code
4. **Tested on both backends** -- ensure WebGL fallback still works

### Three.js Version Note

The version in threepipe (0.163.10003) is a custom build. The latest three.js (r183+) has moved NodeMaterial code into the core (`three/src/nodes/`) and added `renderer.library.fromMaterial()` as the material conversion entry point. The architecture is the same but the file locations differ in newer versions.

---

## Sources

- Three.js source code: `/Users/palash/Projects/threepipe/node_modules/three/`
- [Three.js WebGPURenderer Manual](https://threejs.org/manual/en/webgpurenderer.html)
- [Custom shader support for WebGPURenderer - Issue #26719](https://github.com/mrdoob/three.js/issues/26719)
- [Need a Raw Shader solution for WebGPURenderer - Issue #29781](https://github.com/mrdoob/three.js/issues/29781)
- [How to port onBeforeCompile to TSL nodes](https://discourse.threejs.org/t/how-to-port-onbeforecompile-patch-to-tsl-nodes/88730)
- [Field Guide to TSL and WebGPU](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
- [Migrate Three.js to WebGPU (2026)](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- [Three.js Shading Language Wiki](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [FunctionNode Docs](https://threejs.org/docs/pages/FunctionNode.html)
- [wasm-naga GitHub](https://github.com/pjoe/wasm-naga)
- [BabylonJS/twgsl GitHub](https://github.com/BabylonJS/twgsl)
- [How To Convert GLSL Shaders to TSL](https://threejsroadmap.com/blog/how-to-convert-glsl-shaders-to-tsl)
