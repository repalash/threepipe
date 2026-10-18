/**
 * What a node's `execute` sees - Blender's `GeoNodeExecParams` (`nodes/NOD_geometry_exec.hh`) in the
 * shape this runtime needs. Inputs are pulled lazily: a node that never reads an input never causes
 * its upstream to run (Switch, `node_geo_switch.cc`).
 */

import {GeometrySet} from '../geometry/GeometrySet'
import {GField} from '../fields/field'
import {evaluateConstantField} from '../fields/evaluate'
import type {NodeInstance} from './registry'
import type {SocketValue} from './values'
import type {IDRef} from './types'
import type {EvalOptions} from './context'

export class BlenderNodeError extends Error {}

export interface ExecParams {
    readonly node: NodeInstance
    readonly options: EvalOptions
    /** The input's value (converted to the socket's type). */
    get(identifier: string): SocketValue
    /** All values of a multi-input socket, in evaluation order. */
    getMulti(identifier: string): SocketValue[]
    /** A field-capable input as a field. */
    field(identifier: string): GField
    /** A field-capable input that must be a single value (`get_input<T>` on a single-value socket). */
    single(identifier: string): readonly number[]
    float(identifier: string): number
    int(identifier: string): number
    bool(identifier: string): boolean
    vector(identifier: string): [number, number, number]
    /** A geometry input, as a copy the node may modify (components are cloned on first write). */
    geometry(identifier: string): GeometrySet
    string(identifier: string): string
    idRef(identifier: string): IDRef | null
    set(identifier: string, value: SocketValue): void
    /** Whether anything reads this output (anonymous attributes are only created for used outputs). */
    outputUsed(identifier: string): boolean
    /** A stable, unique anonymous attribute name for this node's output (`hash_to_anonymous_attribute_name`). */
    anonymousName(outputIdentifier: string): string
    /** Record a node warning (`params.error_message_add`). */
    warn(message: string): void
    /** Re-run this node when `key`'s version changes (external data such as an object's geometry). */
    dependsOn(key: string, version: number | string): void
}

/** Helpers shared by the evaluator's params implementation. */
export function singleOf(name: string, v: SocketValue): readonly number[] {
    if (!(v instanceof GField)) throw new BlenderNodeError(`input '${name}' is not a value socket`)
    if (v.dependsOnInput) throw new BlenderNodeError(`input '${name}' does not support fields`)
    return evaluateConstantField(v)
}
