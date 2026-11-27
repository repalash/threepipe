import type {TransferFunctionPreset} from '../TransferFunction'
import {volViewPresets} from './volviewPresets'
import {colorMaps} from './colorMaps'

export {volViewPresets, colorMaps}

/**
 * Transfer function presets that ship with the plugin, by name. Add your own with {@link registerVolumePreset}.
 *
 * - The medical presets from VolView (CT-Bone, CT-Soft-Tissue, MR-Default, ...), with absolute ranges in data units.
 * - One relative preset per colour map (`colormap:viridis`, ...): the colour map with an opacity ramp from 0 to 1.
 */
export const volumePresets: Record<string, TransferFunctionPreset> = {}

/**
 * Add or replace a preset in {@link volumePresets}.
 */
export function registerVolumePreset(preset: TransferFunctionPreset) {
    volumePresets[preset.name] = preset
}

for (const p of volViewPresets) registerVolumePreset(p)
for (const [name, stops] of Object.entries(colorMaps)) {
    registerVolumePreset({
        name: 'colormap:' + name,
        absolute: false,
        colors: stops,
        opacities: [[0, 0], [1, 1]],
    })
}

/**
 * The preset used when nothing else is set: a grey ramp, transparent at the low end.
 */
export const defaultVolumePresetName = 'colormap:grayscale'
