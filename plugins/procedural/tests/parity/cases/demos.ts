/**
 * The examples' DSL graphs against Blender: the procedural-terrain graph at its defaults and with other inputs
 * (resolution, noise, seed), as the example's modifier runs it.
 */

import {terrain} from '../../../../../examples/procedural-terrain/terrain'
import type {NodeGroupLibrary} from '../../../src/runtime/types'
import {ParityCase} from './types'

export function demoCases(): ParityCase[] {
    const base = {library: terrain.json as NodeGroupLibrary, group: terrain.name, input: 'plane' as const}
    return [
        {id: 'terrain-defaults', description: 'procedural-terrain at its defaults', ...base},
        {id: 'terrain-coarse', description: 'procedural-terrain: 24 x 24, high noise scale, seed 7', ...base,
            inputs: {Resolution: 24, 'Noise Scale': 0.6, Seed: 7, Height: 9}},
        {id: 'terrain-detail', description: 'procedural-terrain: 150 x 150, detail 15, roughness 0.9, size 45', ...base,
            inputs: {Resolution: 150, Detail: 15, Roughness: 0.9, Size: 45, Seed: 42.5}},
    ]
}
