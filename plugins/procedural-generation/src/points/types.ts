/**
 * Point cloud types for procedural generation.
 * A PointCloud is the universal intermediate between distribution and instancing.
 * Every placement problem (windows on walls, trees on terrain, lamps along roads)
 * reduces to: generate PointCloud → instance objects at points.
 */

import {Euler, Vector3} from 'threepipe'

/**
 * A single point in a procedural point cloud.
 * Carries position, orientation, and arbitrary named attributes
 * that can be used for rule-based instancing decisions.
 */
export interface ProcPoint {
    /** World-space position of the point. */
    position: Vector3
    /** Surface normal at the point (for align-to-normal instancing). */
    normal: Vector3
    /** Optional explicit rotation override. If undefined, computed from normal. */
    rotation?: Euler
    /** Optional per-point scale. */
    scale?: Vector3
    /** Arbitrary named attributes for rule-based instancing (e.g., zone, floor, slope). */
    attrs: Record<string, number | string>
}

/**
 * An array of procedural points — the universal data structure
 * flowing between Distribute and Instance functions.
 */
export type PointCloud = ProcPoint[]
