---
prev:
  text: 'ShaderToy Shaders in Three.js'
  link: './shadertoy-player'

next:
  text: 'Saving three.js properties in glTF'
  link: './gltf-three-extras-ext'

aside: false
---

# Using Vanilla Three.js code in Threepipe

Threepipe is built on top of three.js, so most vanilla three.js code should work without any issues. 

However, since threepipe uses [a fork of three.js](https://github.com/repalash/three.js-modded), it is bundled within the package instead of being a separate dependency. 
This means you can use threepipe as a drop-in replacement for three.js in many cases.

The three.js fork is [updated till r158](https://github.com/repalash/three.js-modded/releases), and is regularly updated with new features and bug fixes.

## Importing three.js objects

Classes, types, constants, and functions from three.js can be imported from `threepipe` in the same way as you would import from `three`.
With npm modules -
```typescript
import { Scene, PerspectiveCamera, WebGLRenderer, Mesh, BoxGeometry, MeshBasicMaterial } from 'threepipe';
```

In many cases, threepipe provides an extended class as an alternative to the original three.js class. 
These extended classes provide additional features and methods that are not available in the original three.js classes and provide better experience with typescript and autocomplete. It's not necessary to use these extended classes, and standard ones would work fine, but they are recommended for better experience.

Some examples are - 
- `MeshPhysicalMaterial`, `MeshStandardMaterial` -> `PhysicalMaterial`
- `MeshBasicMaterial` -> `UnlitMaterial`
- `Mesh2` -> `Mesh`
- `BufferGeometry2` -> `BufferGeometry`

See also - [`GeometryGeneratorPlugin`](./../package/plugin-geometry-generator), [`Object3DGeneratorPlugin`](./../plugin/Object3DGeneratorPlugin) to generate 3d objects, lights, cameras, geometries along with schema and UI configuration.

Check more [here](./../guide/viewer-api#other-classes-and-interfaces)

Read the [Viewer API guide](./../guide/viewer-api) for more details on classes provided by threepipe.

## Using `THREE.` style

You can use the `THREE.` style code in Threepipe, but you need to import the necessary classes from `threepipe` instead of `three`.

With npm modules -
```typescript
import * as THREE from 'threepipe';
```

With UMD modules -
```html
<script>window.THREE = window.threepipe</script>
```

With import map -
```html
<script async src="https://unpkg.com/es-module-shims@1.6.3/dist/es-module-shims.js"></script>
<script type="importmap">
{
    "imports": {
        "three": "https://unpkg.com/threepipe/dist/index.mjs",
        "threepipe": "https://unpkg.com/threepipe/dist/index.mjs"
    }
}
</script>
```

## Using packages that depend on `three`

If you are using packages that depend on `three`, override in package.json to use `threepipe` as the `three` dependency.

```json
{
  "dependencies": {
    "three": "./node_modules/threepipe/",
    "threepipe": "^0.0.52"
  },
  "overrides": {
    "three": "$three"
  }
}
```

If using `vite`, add a plugin to replace `three` import to `threepipe` in your `vite.config.js`(or rollup)
```javascript
import {defineConfig} from 'vite'
import replace from '@rollup/plugin-replace';

export default defineConfig({
    plugins: [
        replace({
            'from \'three\'': 'from \'threepipe\'',
            'from \'three/examples/jsm/loaders/GLTFLoader.js\'': 'from \'threepipe\'',
            'from \'three/examples/jsm/postprocessing/Pass.js\'': 'from \'threepipe\'',
            'from \'three/examples/jsm/utils/BufferGeometryUtils.js\'': 'from \'threepipe\'',
            // add more that are being used
            
            // 'from \'three/examples/jsm/.*\'': 'from \'threepipe\'', // Note - regex doesnt work...
            delimiters: ['', ''],
            preventAssignment: true,
        }),
        replace({ // this is added to throw an error, in that case, add it to above
            'from \'three/': 'from \'unknown/',
            delimiters: ['', ''],
            preventAssignment: true,
        }),
    ]
})
```

[//]: # (todo add sample with vite for above using some three.js library that has it as dependency/peerDependency)
