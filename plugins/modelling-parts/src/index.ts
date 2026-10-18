/**
 * `@threepipe/modelling-parts` - parametric parts as editable n-gon meshes (16-realism.md §4). Node-safe: depends on
 * `@threepipe/mesh-kernel` only. `plugin-modelling`'s `part` command builds them into the document by id.
 */
import {PartDefinition} from './types'
import {button, dial, knurledRing, lensBarrel} from './product/round'
import {eyecup, pad, rocker, strapLug} from './product/shaped'

export * from './types'
export * from './revolve'
export * from './labels'
export * from './product/round'
export * from './product/shaped'

export const PRODUCT_PARTS: PartDefinition<any>[] = [knurledRing, dial, button, lensBarrel, rocker, eyecup, strapLug, pad]

export const PARTS: Map<string, PartDefinition<any>> = new Map(PRODUCT_PARTS.map(p => [p.id, p]))
