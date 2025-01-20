---
prev: 
    text: 'FragmentClippingExtensionPlugin'
    link: './FragmentClippingExtensionPlugin'

next: 
    text: 'HDRiGroundPlugin'
    link: './HDRiGroundPlugin'

---

# ParallaxMappingPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#parallax-mapping-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/ParallaxMappingPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ParallaxMappingPlugin.html)

`ParallaxMappingPlugin` adds a material extension to PhysicalMaterial to add support for [parallax relief mapping](https://en.wikipedia.org/wiki/Relief_mapping_(computer_graphics)). The idea is to walk along a ray that has entered the `bumpMap`'s volume, finding the intersection point of the ray with the `bumpMap`. [Steep parallax mapping](https://en.wikipedia.org/wiki/Parallax_mapping) and [parallax occlusion mapping](https://en.wikipedia.org/wiki/Parallax_occlusion_mapping) are other common names for these techniques.

To use the plugin, add the plugin to the viewer and use the `bumpMap` in `PhysicalMaterial` normally. The max height is determined by the `bumpScale` in the material. This is assumed to be in world scale.

```typescript
import {ThreeViewer, ParallaxMappingPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const parallaxMapping = viewer.addPluginSync(ParallaxMappingPlugin)

// load or create an object 

// set the bump map
object.material.bumpMap = await viewer.load<ITexture>(bumps[0]) || null
// set the bump scale
object.material.bumpScale = 0.1
// setDirty to notify the viewer to update.
object.material.setDirty()
```

## References and related links:

- WebGL implementation by `Rabbid76` - [github.com/Rabbid76/graphics-snippets](https://github.com/Rabbid76/graphics-snippets/blob/master/html/technique/parallax_005_parallax_relief_mapping_derivative_tbn.html)
- Lesson on Parallax Occlusion Mapping in GLSL - [http://sunandblackcat.com/tipFullView.php?topicid=28](https://web.archive.org/web/20190128023901/http://sunandblackcat.com/tipFullView.php?topicid=28)
- Learn OpenGL - https://learnopengl.com/Advanced-Lighting/Parallax-Mapping
