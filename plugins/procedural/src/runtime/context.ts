/**
 * Evaluation inputs that come from outside the node tree: the scene (objects, collections, images the
 * tree references by name), the object the modifier is on, and time.
 */

import type {GeometrySet} from '../geometry/GeometrySet'

export interface SceneObject {
    /** World matrix, 16 floats column major (`Object::object_to_world()`). */
    transform: ArrayLike<number>
    /** Evaluated geometry of the object (what Object Info outputs). */
    geometry: GeometrySet
    /** Bumped when the object's transform or geometry changes; drives re-evaluation. */
    version?: number
}

export interface SceneCollection {
    /** Direct child objects, in the collection's order. */
    objects: string[]
    /** Direct child collections, in order. */
    children: string[]
    /** `Collection::instance_offset`. */
    instanceOffset: [number, number, number]
    version?: number
}

export interface SceneImage {
    width: number
    height: number
    /** RGBA float pixels, row major from the bottom row, as Blender's `ImBuf::float_buffer`. */
    pixels: Float32Array
    version?: number
}

/** The host's view of the scene. Every member is optional; missing data reads as empty. */
export interface SceneProvider {
    object?(name: string): SceneObject | undefined
    collection?(name: string): SceneCollection | undefined
    image?(name: string): SceneImage | undefined
}

export interface EvalOptions {
    scene?: SceneProvider
    /** The object the modifier runs on (Self Object, relative transforms). */
    selfObject?: string
    /** Scene time in seconds and frame (Scene Time node). */
    seconds?: number
    frame?: number
}
