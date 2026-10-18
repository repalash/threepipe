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
    /**
     * Blender's output for this case is wrong (a Blender bug, analysed in the named issue): the port must still
     * differ from it, so the case stays visible and flips when Blender's output becomes the intended one.
     */
    blenderBug?: string
    /**
     * The port cannot run this case yet: a Blender function it needs is not ported (the named blocker). The
     * evaluation must fail with an error saying so, so the case stays visible and flips when the port lands.
     */
    blocked?: string
    /** Materials `run_cases.py` creates (`bpy.data.materials.new`) before building the node groups. */
    materials?: string[]
    /** The modified object's transform. */
    location?: Vec3
    rotation?: Vec3
    scale?: Vec3
}
