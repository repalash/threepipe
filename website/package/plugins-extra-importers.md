---
prev: 
    text: '@threepipe/plugin-gltf-transform'
    link: './plugin-gltf-transform'

next: 
    text: '@threepipe/plugin-network'
    link: './plugin-network'

---

# @threepipe/plugins-extra-importers

Exports several plugins to add support for various file types.

[Example](https://threepipe.org/examples/#extra-importer-plugins/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/extra-importers/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/extra-importers/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugins-extra-importers.svg)](https://www.npmjs.com/package/@threepipe/plugins-extra-importers)

```bash
npm install @threepipe/plugins-extra-importers
```

This package exports several plugins to add support for several file types using the following plugins

- [TDSLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/TDSLoadPlugin.html) - Load 3DS Max (.3ds) files
- [ThreeMFLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/ThreeMFLoadPlugin.html) - Load 3MF (.3mf) files
- [ColladaLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/ColladaLoadPlugin.html) - Load Collada (.dae) files
- [AMFLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/AMFLoadPlugin.html) - Load AMF (.amf) files
- [BVHLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/BVHLoadPlugin.html) - Load BVH (.bvh) files
- [VOXLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/VOXLoadPlugin.html) - Load MagicaVoxel (.vox) files
- [GCodeLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/GCodeLoadPlugin.html) - Load GCode (.gcode) files
- [MDDLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/MDDLoadPlugin.html) - Load MDD (.mdd) files
- [PCDLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/PCDLoadPlugin.html) - Load Point cloud data (.pcd) files
- [TiltLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/TiltLoadPlugin.html) - Load Tilt Brush (.tilt) files
- [VRMLLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/VRMLLoadPlugin.html) - Load VRML (.wrl) files
- [MPDLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/MPDLoadPlugin.html) - Load LDraw (.mpd) files
- [VTKLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/VTKLoadPlugin.html) - Load VTK (.vtk) files
- [XYZLoadPlugin](https://threepipe.org/plugins/extra-importers/docs/classes/XYZLoadPlugin.html) - Load XYZ (.xyz) files

To add all the plugins at once use `extraImporters`. This adds support for loading all the above file types.
```typescript
import {ThreeViewer} from 'threepipe'
import {extraImporters} from '@threepipe/plugins-extra-importers'

const viewer = new ThreeViewer({...})
viewer.addPluginsSync(extraImporters)

// Now load any file as is.
const model = await viewer.load<IObject3D>('file.3mf')

// To load the file as a data url, use the correct mimetype
const model1 = await viewer.load<IObject3D>('data:model/3mf;base64,...')
```

Remove the `<IObject3D>` if using javascript and not typescript.
