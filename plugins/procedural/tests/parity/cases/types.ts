import type {JSONValue, NodeGroupLibrary} from '../../../src/runtime/types'

/** A case for `porting/blender/run_cases.py` (see its docstring). */
export interface ParityCase {
    id: string
    description: string
    library: NodeGroupLibrary
    group: string
    inputs?: Record<string, JSONValue>
    input: 'empty' | 'cube' | 'plane' | {positions: number[], faces: number[][]}
}
