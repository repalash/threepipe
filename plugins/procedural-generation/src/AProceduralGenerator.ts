/**
 * Abstract base class for procedural generators.
 *
 * Generators produce entire scene graphs (Group2 containing Mesh2/InstancedMesh2).
 * The key design: generate(params, rng) is pure — it takes explicit params and doesn't
 * read from `this`. This enables clean composition (a city generator can call a building
 * generator with explicit params, no state mutation).
 */

import {generateUiConfig, type UiObjectConfig} from 'threepipe'
import type {IObject3D} from 'threepipe'
import {SeededRandom} from './utils/SeededRandom'
import {getOrCall} from 'threepipe'

export abstract class AProceduralGenerator<TParams extends object = object> {
    constructor(public readonly type: string) {}

    /** Default parameters for this generator. */
    abstract defaultParams: TParams

    /**
     * Generate a new scene graph from the given parameters.
     * This is the core method — pure function, no side effects.
     * @param params Generation parameters
     * @param rng Seeded random number generator
     * @returns A new IObject3D (typically a Group2) containing the generated content
     */
    abstract generate(params: TParams, rng: SeededRandom): IObject3D

    /**
     * Create UI config for the given generated object's parameters.
     * Auto-generates sliders/toggles from the generationParams in userData.
     * Override for custom UI.
     */
    createUiConfig(object: IObject3D): UiObjectConfig[] {
        const params = object.userData?.generationParams
        if (!params) return []
        const ui = (generateUiConfig(params)
            ?.flatMap(v => getOrCall(v))
            .filter(v => getOrCall((v as any).property)?.[1] !== 'type') || []) as UiObjectConfig[]
        return ui
    }

    /** Update default parameters. */
    setDefaultParams(params: Partial<TParams>): this {
        Object.assign(this.defaultParams, params)
        return this
    }
}
