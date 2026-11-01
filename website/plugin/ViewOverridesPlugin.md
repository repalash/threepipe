---
prev:
    text: 'FrameFadePlugin'
    link: './FrameFadePlugin'

next:
    text: '@threepipe/webgi-plugins'
    link: '../package/webgi-plugins'

---

# ViewOverridesPlugin

[Example](https://threepipe.org/examples/#view-overrides-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/rendering/ViewOverridesPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ViewOverridesPlugin.html)

ViewOverridesPlugin shows the scene with one debug material for every mesh, or with other lights or another environment map, without changing the scene. Use it for the view menu of an editor: check the normals, the UVs or the material assignment, or see a model in other lighting.

Material views (`setMaterial`):

| Key | View |
|---|---|
| `unlit` | The base color, color map, AO map and light map of each mesh, without lights |
| `depth` | Linear view depth, white at the front of the models and black at the back (the range fits the models in each frame) |
| `normal` | View-space normals |
| `normalWorld` | World-space normals: the normal of the `normal` view (with normal maps, skinning and morphs) in world space |
| `materialId` | One flat color for each material |
| `uv` | U in red and V in green for the UV set `uvChannel` (0 for `uv`, 1 to 3 for `uv1` to `uv3`). Magenta where a mesh has no such UV set |

The unlit, material ID and UV views keep the side, opacity, alpha map, alpha test and wireframe of the mesh material.

Fat lines (`LineSegments2`, `Line2`, `MeshLine` with a `LineMaterial`) stay lines in every view: their width (in pixels or world units), dashes and alpha to coverage do not change.

| View | Fat line |
|---|---|
| `unlit` | Its own material: a fat line is unlit |
| `depth` | The depth ramp of the meshes, with the same range |
| `materialId` | The color of its material, as a mesh with that material |
| `normal`, `normalWorld` | Neutral grey (0.5 in each channel, the color of a zero normal): a line has no surface normal |
| `uv` | Magenta, as a mesh without the UV set: a line has no UV set |

A line material with `allowOverride` false keeps its own material in every view.

Lighting presets (`setLighting`, the list is in `lightingPresets`):

| Key | Lighting |
|---|---|
| `lights-day`, `lights-night`, `lights-studio`, `lights-none` | Preset lights in place of the scene lights. The environment map is off too, unless `lightsKeepEnvironment` is true |
| `env-day`, `env-night`, `env-studio`, `env-indoors`, `env-outdoors` | Another environment map in place of the scene lights and environment. The map loads on the first use, then it is cached |

A material view and a lighting preset are exclusive: choosing one turns the other off, as the debug materials are unlit.

```typescript
import {ThreeViewer, ViewOverridesPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})
const overrides = viewer.addPluginSync(ViewOverridesPlugin)

overrides.setMaterial('normal')
overrides.setMaterial('uv')
overrides.uvChannel = 1 // the uv1 set

await overrides.setLighting('env-studio') // resolves when the map is loaded and applied
overrides.lightsKeepEnvironment = true // keep the environment map (reflections) with the lights preset that is on
await overrides.setLighting('lights-night')

overrides.clear() // the scene as it is
overrides.enabled = false // keeps the choice, shows the scene, until enabled again

// a menu: the items, the current state and the change event
overrides.materialTypes // [{key: 'unlit', label: 'Unlit'}, ...]
overrides.lightingPresets // [{key: 'lights-day', label: 'Day', group: 'lights'}, ...]
overrides.addEventListener('change', () => {
    console.log(overrides.material, overrides.lighting, overrides.loading)
})

// another environment map, or a new preset, before its first use
overrides.lightingPresets.find(p => p.key === 'env-studio')!.url = 'https://example.com/studio.hdr'
overrides.lightingPresets.push({key: 'env-mine', label: 'Mine', group: 'env', url: 'https://example.com/mine.exr'})
```

The plugin UI (`uiConfig`) has a Material and a Lighting dropdown, the UV set (in the UV view), Lights Keep Env and Clear.

## How it works

The overrides apply only while the viewer renders, between its `preRender` and `postRender` events:
- The override material of the main render pass (`renderManager.renderPass.overrideMaterial`) is the material of the view. An override material that the app set is restored after each render.
- Fat lines are quads that only a line shader draws as lines, so the debug materials of the meshes cannot draw them. In the depth, material ID, normal and UV views, each line object gets a line variant of its line material as `forcedOverrideMaterial`: a material that keeps the shader of the line material (the shared `mergeLineShader`, as the depth and GBuffer line materials of threepipe) and changes only the output color. The forced material that the object had is restored after the render. The variants are cached for each line material, disposed when no line in the scene uses that material and when the plugin is removed. In the unlit view, the line material keeps `allowOverride` false during the render. A line object that is not a threepipe object (it has no `forcedOverrideMaterial`) keeps its own material in every view.
- The scene lights are hidden with their layers mask (0), and their mask is restored after the render. The `visible` flag does not change, so progressive rendering does not restart in each frame.
- The environment map is `scene.overrideRenderEnvironment`, restored after the render.
- The preset lights are in a group in the scene root (`lightsRoot`, not in the model root), which is not selectable, has no bounding box and is not exported. The group is visible only during a render with a lighting preset on.

Outside a render, the scene, its materials and its lights are as the user left them, so an export, the scene UI and the light toggles see the real scene. `clear()`, `enabled = false` and removing the plugin show the scene as before. On remove, the plugin also removes its lights group and disposes the environment maps that it loaded and that the scene does not use.

The state is not saved with the viewer config (`serializeWithViewer = false`).
