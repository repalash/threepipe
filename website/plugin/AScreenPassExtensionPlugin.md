---
prev:
    text: 'PipelinePassPlugin'
    link: './PipelinePassPlugin'

next: false

aside: false
---

# AScreenPassExtensionPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/AScreenPassExtensionPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/AScreenPassExtensionPlugin.html)

Abstract base plugin for screen-space post-processing effects. Instead of adding a new render pass (like [PipelinePassPlugin](./PipelinePassPlugin)), this injects GLSL code into the existing ScreenPass shader at the `#glMarker` injection point. This is more efficient for simple effects since they share a single draw call.

The class is simultaneously a **viewer plugin**, a **material extension** (modifies shader code and uniforms), and a **GBuffer updater** (can write per-pixel flags).

For a comprehensive guide, see [Screen Pass Shaders](../guide/screen-pass).

## Creating a Custom Effect

```typescript
import {AScreenPassExtensionPlugin, Color, glsl} from 'threepipe'
import {uiFolderContainer, uiSlider, uiToggle, uiColor} from 'uiconfig.js'
import {onChange, serialize} from 'ts-browser-helpers'
import {uniform} from 'threepipe'

@uiFolderContainer('Color Tint')
export class ColorTintPlugin extends AScreenPassExtensionPlugin {
    static readonly PluginType = 'ColorTint'

    // GPU uniforms
    readonly extraUniforms = {
        tintIntensity: {value: 0.5},
        tintColor: {value: new Color(1, 0.8, 0.6)},
    } as const

    // Enabled toggle
    @onChange(ColorTintPlugin.prototype.setDirty)
    @uiToggle('Enable')
    @serialize() enabled = true

    // Properties synced to GPU via @uniform
    @uiSlider('Intensity', [0, 1], 0.01)
    @uniform({propKey: 'tintIntensity'})
    @serialize() intensity = 0.5

    @uiColor('Color')
    @uniform({propKey: 'tintColor'})
    @serialize() color = new Color(1, 0.8, 0.6)

    priority = -50

    // GLSL declarations (injected before main())
    parsFragmentSnippet = () => {
        if (this.isDisabled()) return ''
        return glsl`
            uniform float tintIntensity;
            uniform vec3 tintColor;
            vec4 colorTint(vec4 color) {
                return vec4(mix(color.rgb, color.rgb * tintColor, tintIntensity), color.a);
            }
        `
    }

    // Code injected at #glMarker (inside main(), modifies diffuseColor)
    protected _shaderPatch = 'diffuseColor = colorTint(diffuseColor);'

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }
}
```

## How It Works

1. On `onAdded`: registers itself as a material extension on `viewer.renderManager.screenPass.material`
2. During shader compilation, `shaderExtender()` prepends `_shaderPatch` before `#glMarker` in the ScreenPass fragment shader
3. `parsFragmentSnippet` injects uniform declarations and helper functions before `main()`
4. The `@uniform` decorator syncs TypeScript property values to GPU uniforms automatically
5. When any property changes, `setDirty()` bumps the material extension version and triggers re-render
6. `computeCacheKey` returns `'0'` when disabled or `'1'` when enabled, controlling shader recompilation

The key shader variable available at `#glMarker` is **`diffuseColor`** (`vec4`) — the final pixel color that your effect modifies in place.

## Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | — | Abstract, must be implemented. Controls whether the effect is active. |
| `priority` | `number` | `-100` | Ordering for material extension application. Lower = applied later. Subclasses typically use `-50`. |
| `_shaderPatch` | `string` | `''` | GLSL code injected at `#glMarker` inside `main()`. |
| `extraUniforms` | `object` | — | Uniform declarations (defined in subclass). The `@uniform` decorator syncs property values here. |

## Lifecycle

**`onAdded(viewer)`**:
1. Registers as a GBuffer updater (via `GBufferPlugin.registerGBufferUpdater` if GBufferPlugin is present)
2. Registers as a material extension on the ScreenPass material

**`onRemove(viewer)`**:
1. Unregisters from GBuffer and ScreenPass material

**`setDirty()`**: Bumps the material extension version and marks the screen pass for re-render. Call this (or use `@onChange`) whenever a property changes.

## Decorator Pattern

Each property typically uses this decorator chain:

```typescript
@uiSlider('Label', [min, max], step)  // UI control
@uniform({propKey: 'uniformName'})     // Sync to GPU uniform
@serialize()                           // Save/restore
propertyName = defaultValue
```

The `@onChange(Cls.prototype.setDirty)` decorator on `enabled` ensures the shader recompiles when the effect is toggled.

## Built-in Subclasses

| Plugin | Effect | Key Properties |
|---|---|---|
| [TonemapPlugin](./TonemapPlugin) | Tone mapping + exposure | `toneMapping`, `exposure`, `saturation`, `contrast` |
| [VignettePlugin](./VignettePlugin) | Edge darkening | `power`, `color` |
| [ChromaticAberrationPlugin](./ChromaticAberrationPlugin) | RGB channel offset | `intensity` |
| [FilmicGrainPlugin](./FilmicGrainPlugin) | Film grain noise | `intensity`, `multiply` |

## Related

- [Screen Pass Shaders](../guide/screen-pass) — Comprehensive guide with full examples
- [PipelinePassPlugin](./PipelinePassPlugin) — For effects that need a separate render pass
- [Material Extension](../guide/material-extension) — Lower-level material extension system
