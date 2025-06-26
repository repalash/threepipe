---
prev: 
    text: '@threepipe/plugin-3d-tiles-renderer'
    link: './plugin-3d-tiles-renderer'

next:
  text: '@threepipe/plugin-path-tracing'
  link: './plugin-path-tracing'

---

# @threepipe/plugin-assimpjs
 
This package exports [AssimpJsPlugin](https://threepipe.org/plugins/assimpjs/docs/classes/AssimpJsPlugin.html) which loads the assimpjs library and provides `ajs` interface.

[Example](https://threepipe.org/examples/#assimpjs-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/assimpjs/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/assimpjs/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-assimpjs.svg)](https://www.npmjs.com/package/@threepipe/plugin-assimpjs)

This package uses a custom fork of [assimpjs](https://github.com/kovacsv/assimpjs) with custom build to support fbx export etc - https://github.com/repalash/assimpjs

```bash
npm install @threepipe/plugin-assimpjs
```

## Sample Usage 

### Convert any format to glTF/glb and load in viewer
Any set of 3d files can be loaded into assimp, and converted to glTF/glb format. The converted files can then be loaded into the viewer as blobs.

```typescript
import {ThreeViewer} from 'threepipe'
import {AssimpJsPlugin} from '@threepipe/plugin-assimpjs'

const viewer = new ThreeViewer({...})
const assimpjs = viewer.addPluginSync(AssimpJsPlugin)
await assimp.init() // load the assimpjs library and wait for it to be ready. It also loads automatically when plugin is added to the viewer if autoInit is true.

// Prepare a list of files to load
const files = [
    'https://threejs.org/examples/models/obj/male02/male02.obj',
]
// Download the files
const fe = files.map(async f=>fetch(`${f}`).then(async t=>t.arrayBuffer()))
const responses = await Promise.all(fe)
const fileList: Record<string, ArrayBuffer> = {}
for (let i = 0; i < files.length; i++) {
    fileList[files[i]] = responses[i]
}
const fbx = assimp.convertFiles(fileList, 'glb2')
if (!fbx) {
    console.error('Failed to convert files to glb')
    return
}

// load the glb file
await viewer.load<IObject3D>({path: 'file.glb', file: glb})
```

Check the [assimpjs-plugin](https://threepipe.org/examples/#assimpjs-plugin/) example for a live demo.

### Export to FBX / Convert to FBX

Assimp includes a FBX exporter, which can be used to convert any 3D file format to FBX. 
To export the current scene to FBX, the scene can be exported to glTF/glb format, and then converted to FBX using the `AssimpJsPlugin`'s `convertFiles` function.

```typescript
import {ThreeViewer, downloadBlob} from 'threepipe'
import {AssimpJsPlugin} from '@threepipe/plugin-assimpjs'

const viewer = new ThreeViewer({...})
const assimpjs = viewer.addPluginSync(AssimpJsPlugin)
await assimp.init() // load the assimpjs library and wait for it to be ready. It also loads automatically when plugin is added to the viewer if autoInit is true.

// load some models
const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf')

const fbxBlob = await assimp.exportModel('fbx', result, {
    embedUrlImages: true,
})

// download the fbx file
downloadBlob(fbxBlob, 'model.fbx')
```

Check full example - [fbx-export](https://threepipe.org/examples/#fbx-export/).
