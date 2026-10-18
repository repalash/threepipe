import type {JSONValue, NodeGroupLibrary} from '../../../src/runtime/types'

type Vec3 = [number, number, number]

/** An object `run_cases.py` creates (`make_object`). */
export interface CaseObject {
    name: string
    mesh?: 'cube' | 'plane' | 'empty' | {positions: number[], faces?: number[][], edges?: number[][]}
    location?: Vec3
    rotation?: Vec3
    scale?: Vec3
}

/** A case for `porting/blender/run_cases.py` (see its docstring). */
export interface ParityCase {
    id: string
    description: string
    library: NodeGroupLibrary
    group: string
    inputs?: Record<string, JSONValue>
    input: 'empty' | 'cube' | 'plane' | {positions: number[], faces: number[][]}
    /** Collections with objects, built before the case object. */
    scene?: {collection: string, objects?: CaseObject[], instanceOffset?: Vec3, parent?: string}[]
    /** Objects directly in the scene collection. */
    objects?: CaseObject[]
    /** The modified object's transform. */
    location?: Vec3
    rotation?: Vec3
    scale?: Vec3
}
