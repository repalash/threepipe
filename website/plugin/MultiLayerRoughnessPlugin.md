---
prev:
    text: 'ParallaxMappingPlugin'
    link: './ParallaxMappingPlugin'

next:
    text: 'CanvasSnapshotPlugin'
    link: './CanvasSnapshotPlugin'

---

# MultiLayerRoughnessPlugin

[Example](https://threepipe.org/examples/#multi-layer-roughness-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/material/MultiLayerRoughnessPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/MultiLayerRoughnessPlugin.html)

<iframe src="https://threepipe.org/examples/multi-layer-roughness-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Multi Layer Roughness Plugin Example"></iframe>

Multi Layer Roughness Plugin adds a material extension to PhysicalMaterial that blends multiple specular (GGX) lobes with different roughness values on the same surface.

Real metal almost always shows several reflections at once — a sharp core reflection paired with one or more rougher, fainter "tail-off" reflections. This is caused by sub-pixel micro scratches that vary in depth, density and size: below visual acuity they read as several coexisting roughness values instead of one. A single roughness value or map can never reproduce this — no matter how it's tweaked, it only changes the blurriness of a single reflection.

The technique of blending two specular lobes goes back to the shaders ILM used on Iron Man (2008), and dual-lobe specular is standard in production renderers (RenderMan PxrSurface's Rough Specular, Unreal's dual-lobe skin shading, O3DE dual specular). This plugin generalizes it to up to 4 extra lobes on top of the material's base specular lobe, evaluated for both direct lights and image-based (environment) lighting with per-lobe multi-scattering energy compensation.

## Features

- **Up to 4 extra specular lobes** per material, each with its own roughness and weight
- **Base roughness influence**: layer roughness can be absolute or "lift" the material's (mapped) roughness, so roughness maps flow into the layers
- **Three blend modes**:
  - `mix` (default) — energy conserving, the base lobe gets the remaining weight
  - `additive` — lobes are added on top (the classic ILM two-lobe look, not energy conserving)
  - `chain` — sequential mix chain, like chained Mix Shader nodes in Blender
- **Direct + IBL**: lobes affect punctual/directional lights and environment reflections (one extra env sample per layer)
- **Energy compensation**: per-lobe multi-scattering (Kulla-Conty style, via three.js `computeMultiscattering`), with indirect diffuse rebalanced by the weighted total scattering
- **Works with other extensions**: composes with the webgi AnisotropyPlugin (layers become anisotropic lobes), iridescence, clearcoat, sheen
- **Material Extension UI**: add/remove/edit layers in the material inspector
- **glTF Extension Support**: uses `WEBGI_materials_multi_layer_roughness` for import/export
- **Per-Material Control**: enable/disable per material with custom parameters

## Basic Setup

```typescript
import {ThreeViewer, PhysicalMaterial, MultiLayerRoughnessPlugin} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('canvas'),
    msaa: true,
})

const mlr = viewer.addPluginSync(new MultiLayerRoughnessPlugin())

const material = viewer.scene.getObjectByName('Metal')?.material as PhysicalMaterial

// Enable with default settings (one extra layer)
MultiLayerRoughnessPlugin.AddMultiLayerRoughness(material)

// Or enable with custom layers - sharp base + two rougher, fainter lobes
MultiLayerRoughnessPlugin.AddMultiLayerRoughness(material, {
    layers: [
        {weight: 0.35, roughness: 0.35, baseInfluence: 0},
        {weight: 0.15, roughness: 0.7, baseInfluence: 0},
    ],
})
```

## Configuration

### Layers

Each layer is an extra specular lobe with:

- `weight` (0-1) — presence of the lobe. How it maps to the final lobe weight depends on the blend mode.
- `roughness` (0-1) — roughness of the lobe.
- `baseInfluence` (0-1) — how much of the material's (mapped) roughness is added to the lobe:
  `lobeRoughness = clamp(roughness + baseRoughness * baseInfluence, 0.0525, 1)`.
  With `baseInfluence: 0` the layer roughness is absolute; with `1` the base roughness (including roughness maps) is "lifted" by the layer's roughness, so scratches or wear painted in the roughness map remain visible in the tail-off.

```typescript
material.userData._multiLayerRoughness = {
    enabled: true,
    blendMode: 'mix',
    layers: [
        {weight: 0.3, roughness: 0.45, baseInfluence: 0},
    ],
}
material.setDirty()
```

### Blend Modes

- `mix` (default, recommended): layer weights are normalized so the total stays energy conserving. The base lobe gets `1 - sum(weights)`; if the weights sum to more than 1, everything is renormalized.
- `additive`: the base lobe stays at full strength and layers are added on top. This reproduces the additive two-lobe shaders used on Iron Man (2008) but breaks energy conservation - bright environments can blow out.
- `chain`: a sequential mix chain, `mix(mix(base, layer1, w1), layer2, w2)...` - matches chaining Mix Shader nodes in Blender. Each layer scales down everything below it, so order matters.

All modes resolve to per-lobe weights on the CPU - there's no extra per-pixel cost for any particular mode.

### Per-Material UI

When a UI plugin (e.g. TweakpaneUiPlugin) and PickingPlugin are active, the material UI shows a "Multi Layer Roughness" folder with an enable checkbox, blend mode dropdown, per-layer weight/roughness/baseInfluence sliders and add/remove layer buttons.

```typescript
import {PickingPlugin} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

viewer.addPluginSync(PickingPlugin)
const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
ui.setupPluginUi(MultiLayerRoughnessPlugin)
```

## glTF Extension

Materials with layers are saved with the `WEBGI_materials_multi_layer_roughness` extension:

```json
{
  "materials": [
    {
      "name": "TailoffMetal",
      "pbrMetallicRoughness": {},
      "extensions": {
        "WEBGI_materials_multi_layer_roughness": {
          "enabled": true,
          "blendMode": "mix",
          "layers": [
            {"weight": 0.35, "roughness": 0.35, "baseInfluence": 0},
            {"weight": 0.15, "roughness": 0.7, "baseInfluence": 0}
          ]
        }
      }
    }
  ]
}
```

Models with the extension load automatically when the plugin is added.

## Technical Details

- Direct lights: the specular BRDF (`BRDF_GGX`) is evaluated once per lobe with the lobe's roughness and the material's F0/specular color (all lobes are the same physical interface, so Fresnel is shared - this matches Unreal's `DualSpecularGGX`, Unity HDRP StackLit and O3DE dual specular).
- Environment: one extra `getIBLRadiance` (prefiltered env mip) sample per lobe, with per-lobe DFG/multi-scattering (`computeMultiscattering`) and the indirect diffuse rebalanced using the weighted total scattering of all lobes.
- The shader patches are applied via the material extension system and compose with the webgi `AnisotropyPlugin` (its `BRDF_GGX_Anisotropy` and bent-normal IBL are picked up automatically, making the extra lobes anisotropic too).

### Limitations

- Screen-space effects (SSR from SSReflectionPlugin, SSGI) read the single base roughness from the GBuffer - extra lobes only show in environment and light reflections, not in screen-space reflections. (Same class of limitation as anisotropy.)
- Rect area lights (LTC) evaluate only the base lobe.
- Each layer adds one environment sample and one BRDF evaluation per light - with 1-2 layers the cost is comparable to enabling clearcoat.

## Examples

- [Multi Layer Roughness Plugin](https://threepipe.org/examples/#multi-layer-roughness-plugin/) - comparison grid: single roughness vs tail weight/roughness sweeps and blend modes
- [Multi Layer Roughness Scene](https://threepipe.org/examples/#multi-layer-roughness-scene/) - appliance-style metals (door panels, cooking pot) combining layers with AnisotropyPlugin, SSReflectionPlugin, BloomPlugin and a neon sign, like the real-world references

## Related Plugins

- [AnisotropyPlugin](./AnisotropyPlugin) - Anisotropic reflections (composes with layers)
- [ClearcoatTintPlugin](./ClearcoatTintPlugin) - Tinted clearcoat layers
- [CustomBumpMapPlugin](./CustomBumpMapPlugin) - Custom bump/normal mapping
