/**
 * Point distribution functions for procedural generation.
 * Maps to Blender's "Distribute Points on Faces" and related nodes.
 *
 * Every placement problem reduces to: generate PointCloud → instance at points.
 * These functions generate PointClouds from various source geometries.
 *
 * References:
 * - Bridson's Poisson disk sampling: Bridson, R. (2007)
 *   "Fast Poisson Disk Sampling in Arbitrary Dimensions"
 *   https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf
 * - Sample elimination: Yuksel, C. (2015)
 *   "Sample Elimination for Generating Poisson Disk Sample Sets"
 *   http://www.cemyuksel.com/research/sampleelimination/
 * - Area-weighted triangle sampling via CDF + barycentric coordinates:
 *   standard technique, see Three.js MeshSurfaceSampler source
 *   https://github.com/mrdoob/three.js/blob/master/examples/jsm/math/MeshSurfaceSampler.js
 *
 * NOTE: We implement our own seeded area-weighted sampler instead of using
 * MeshSurfaceSampler because it uses Math.random() internally and cannot be seeded.
 * Determinism (same seed = same output) is a core requirement.
 */

import {BufferAttribute, BufferGeometry, CurvePath, Euler, Matrix4, Vector3} from 'threepipe'
import {SeededRandom} from '../utils/SeededRandom'
import type {PointCloud, ProcPoint} from './types'

// Reusable temporaries
const _v0 = new Vector3()
const _v1 = new Vector3()
const _v2 = new Vector3()
const _edge1 = new Vector3()
const _edge2 = new Vector3()
const _faceNormal = new Vector3()

/**
 * Options for distributing points on mesh faces.
 */
export interface DistributeOnFacesOptions {
    /** 'random' uses area-weighted sampling (fast). 'poisson' uses rejection-based Poisson disk (even spacing). */
    method: 'random' | 'poisson'
    /** Points per unit area. Mutually exclusive with count. */
    density?: number
    /** Exact number of points. Mutually exclusive with density. */
    count?: number
    /** Minimum distance between points (Poisson only). If 0 or undefined, auto-computed from density. */
    minDistance?: number
    /** Spatially varying density multiplier. Returns 0-1. Points are rejected with probability (1 - densityField). */
    densityField?: (position: Vector3) => number
    /** Random seed. */
    seed: number
}

/**
 * Internal: seeded area-weighted triangle sampler.
 * Builds a CDF of triangle areas, then for each sample:
 * 1. Binary search CDF to pick a triangle (probability proportional to area)
 * 2. Generate random barycentric coordinates within the triangle
 * 3. Interpolate position and normal
 *
 * The barycentric coordinate sampling uses the standard square-root method:
 *   u = 1 - sqrt(r1), v = sqrt(r1) * r2
 * Reference: Osada et al. (2002) "Shape Distributions", Section 4.2
 * https://doi.org/10.1145/571647.571648
 */
class SeededSurfaceSampler {
    private _cdf: Float64Array
    private _positions: BufferAttribute
    private _normals: BufferAttribute | null
    private _index: BufferAttribute | null
    private _faceCount: number
    private _totalArea: number

    constructor(geo: BufferGeometry) {
        this._positions = geo.getAttribute('position') as BufferAttribute
        this._normals = geo.getAttribute('normal') as BufferAttribute | null
        this._index = geo.getIndex() as BufferAttribute | null
        this._faceCount = this._index ? this._index.count / 3 : this._positions.count / 3

        // Build CDF of triangle areas
        this._cdf = new Float64Array(this._faceCount)
        let cumArea = 0
        for (let f = 0; f < this._faceCount; f++) {
            const i0 = this._index ? this._index.getX(f * 3) : f * 3
            const i1 = this._index ? this._index.getX(f * 3 + 1) : f * 3 + 1
            const i2 = this._index ? this._index.getX(f * 3 + 2) : f * 3 + 2

            _v0.set(this._positions.getX(i0), this._positions.getY(i0), this._positions.getZ(i0))
            _v1.set(this._positions.getX(i1), this._positions.getY(i1), this._positions.getZ(i1))
            _v2.set(this._positions.getX(i2), this._positions.getY(i2), this._positions.getZ(i2))

            _edge1.subVectors(_v1, _v0)
            _edge2.subVectors(_v2, _v0)
            const area = _edge1.cross(_edge2).length() * 0.5

            cumArea += area
            this._cdf[f] = cumArea
        }
        this._totalArea = cumArea

        // Normalize CDF to [0, 1]
        if (cumArea > 0) {
            for (let f = 0; f < this._faceCount; f++) {
                this._cdf[f] /= cumArea
            }
        }
    }

    get totalArea(): number { return this._totalArea }

    /** Sample a random point on the surface. Writes position and normal to the provided vectors. */
    sample(rng: SeededRandom, outPos: Vector3, outNormal: Vector3): void {
        // Pick triangle via binary search on CDF
        const r = rng.next()
        let lo = 0, hi = this._faceCount - 1
        while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (this._cdf[mid] < r) lo = mid + 1
            else hi = mid
        }
        const faceIdx = lo

        // Get triangle vertices
        const i0 = this._index ? this._index.getX(faceIdx * 3) : faceIdx * 3
        const i1 = this._index ? this._index.getX(faceIdx * 3 + 1) : faceIdx * 3 + 1
        const i2 = this._index ? this._index.getX(faceIdx * 3 + 2) : faceIdx * 3 + 2

        _v0.set(this._positions.getX(i0), this._positions.getY(i0), this._positions.getZ(i0))
        _v1.set(this._positions.getX(i1), this._positions.getY(i1), this._positions.getZ(i1))
        _v2.set(this._positions.getX(i2), this._positions.getY(i2), this._positions.getZ(i2))

        // Random barycentric coordinates via square-root method
        // Reference: Osada et al. (2002), ensures uniform distribution within triangle
        const r1 = rng.next()
        const r2 = rng.next()
        const sqrtR1 = Math.sqrt(r1)
        const u = 1 - sqrtR1
        const v = sqrtR1 * r2
        const w = 1 - u - v

        // Interpolate position
        outPos.set(
            _v0.x * u + _v1.x * v + _v2.x * w,
            _v0.y * u + _v1.y * v + _v2.y * w,
            _v0.z * u + _v1.z * v + _v2.z * w,
        )

        // Interpolate normal (from vertex normals if available, else compute face normal)
        if (this._normals) {
            outNormal.set(
                this._normals.getX(i0) * u + this._normals.getX(i1) * v + this._normals.getX(i2) * w,
                this._normals.getY(i0) * u + this._normals.getY(i1) * v + this._normals.getY(i2) * w,
                this._normals.getZ(i0) * u + this._normals.getZ(i1) * v + this._normals.getZ(i2) * w,
            ).normalize()
        } else {
            _edge1.subVectors(_v1, _v0)
            _edge2.subVectors(_v2, _v0)
            outNormal.crossVectors(_edge1, _edge2).normalize()
        }
    }
}

/**
 * Distribute points on mesh faces.
 *
 * 'random' mode: Area-weighted random sampling using seeded CDF + barycentric.
 * Equivalent to Blender's "Distribute Points on Faces" with Random method.
 *
 * 'poisson' mode: Oversample randomly, then reject points that are too close
 * using a 3D spatial hash. Uses Euclidean distance in 3D (not geodesic).
 * This is the "sample elimination" approach recommended by Yuksel (2015).
 */
export function onFaces(geo: BufferGeometry, options: DistributeOnFacesOptions): PointCloud {
    if (!geo) throw new Error('Distribute.onFaces: no geometry provided')

    const rng = new SeededRandom(options.seed)
    const sampler = new SeededSurfaceSampler(geo)

    // Compute target count from density or explicit count
    let targetCount: number
    if (options.count !== undefined) {
        targetCount = Math.max(0, Math.floor(options.count))
    } else if (options.density !== undefined) {
        targetCount = Math.max(0, Math.floor(sampler.totalArea * options.density))
    } else {
        throw new Error('Distribute.onFaces: must specify either density or count')
    }

    if (targetCount === 0) return []

    if (options.method === 'random') {
        return _sampleRandom(sampler, targetCount, rng, options)
    } else {
        return _samplePoisson(sampler, targetCount, rng, options)
    }
}

function _sampleRandom(
    sampler: SeededSurfaceSampler,
    targetCount: number,
    rng: SeededRandom,
    options: DistributeOnFacesOptions,
): PointCloud {
    const cloud: PointCloud = []
    const pos = new Vector3()
    const normal = new Vector3()
    const maxAttempts = targetCount * 4

    let attempts = 0
    while (cloud.length < targetCount && attempts < maxAttempts) {
        sampler.sample(rng, pos, normal)
        attempts++

        if (options.densityField) {
            if (rng.next() > options.densityField(pos)) continue
        }

        cloud.push({
            position: pos.clone(),
            normal: normal.clone(),
            attrs: {},
        })
    }

    return cloud
}

/**
 * Poisson disk via oversampling + rejection with spatial hash.
 * 3D spatial hash grid for O(1) neighbor lookups.
 *
 * Reference: Bridson, R. (2007) spatial grid structure
 * https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf
 */
function _samplePoisson(
    sampler: SeededSurfaceSampler,
    targetCount: number,
    rng: SeededRandom,
    options: DistributeOnFacesOptions,
): PointCloud {
    const cloud: PointCloud = []
    const pos = new Vector3()
    const normal = new Vector3()

    // Auto-compute min distance from target density if not provided.
    // Derived from circle packing: area per point ≈ π*(r/2)² → r ≈ sqrt(area/(count*π)) * 2
    // Simplified: minDist ≈ sqrt(totalArea / targetCount) * 0.8
    const minDist = (options.minDistance && options.minDistance > 0)
        ? options.minDistance
        : Math.sqrt(sampler.totalArea / targetCount) * 0.8

    const minDist2 = minDist * minDist
    const cellSize = minDist / Math.sqrt(3) // cell size for 3D grid per Bridson

    // Spatial hash for fast neighbor lookups
    const cells = new Map<number, Vector3[]>()

    function hashKey(x: number, y: number, z: number): number {
        // Simple spatial hash — cheaper than string concatenation
        const ix = Math.floor(x / cellSize)
        const iy = Math.floor(y / cellSize)
        const iz = Math.floor(z / cellSize)
        return (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)
    }

    function hasNearbyPoint(p: Vector3): boolean {
        const cx = Math.floor(p.x / cellSize)
        const cy = Math.floor(p.y / cellSize)
        const cz = Math.floor(p.z / cellSize)
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const key = ((cx + dx) * 73856093) ^ ((cy + dy) * 19349663) ^ ((cz + dz) * 83492791)
                    const cell = cells.get(key)
                    if (!cell) continue
                    for (const q of cell) {
                        if (p.distanceToSquared(q) < minDist2) return true
                    }
                }
            }
        }
        return false
    }

    // Phase 1: Generate spatially-valid candidates (distance check only, no density rejection).
    // This ensures the RNG sequence for spatial positions is independent of the density field.
    // Changing the density field won't change which positions are sampled.
    // Reference: Blender decouples these phases — see node_geo_distribute_points_on_faces.cc
    const oversampleFactor = options.densityField ? 50 : 30
    const maxAttempts = targetCount * oversampleFactor
    let attempts = 0

    // Collect all spatially-valid candidates first
    const candidates: {position: Vector3, normal: Vector3}[] = []
    while (candidates.length < targetCount * 3 && attempts < maxAttempts) {
        sampler.sample(rng, pos, normal)
        attempts++

        if (hasNearbyPoint(pos)) continue

        const p = pos.clone()
        candidates.push({position: p, normal: normal.clone()})

        const key = hashKey(p.x, p.y, p.z)
        if (!cells.has(key)) cells.set(key, [])
        cells.get(key)!.push(p)
    }

    // Phase 2: Apply density field as a separate pass using a separate RNG.
    // This ensures density field changes don't affect spatial positions.
    const densityRng = rng.fork()
    for (const candidate of candidates) {
        if (cloud.length >= targetCount) break

        if (options.densityField) {
            if (densityRng.next() > options.densityField(candidate.position)) continue
        }

        cloud.push({
            position: candidate.position,
            normal: candidate.normal,
            attrs: {},
        })
    }

    return cloud
}

/**
 * Options for grid-based distribution.
 */
export interface DistributeOnGridOptions {
    /**
     * Random offset as fraction of cell size.
     * 0 = perfect grid, 0.5 = recommended default (good spacing + breaks grid pattern).
     * Values above 0.6 risk distance outliers.
     * Reference: Red Blob Games jitter analysis https://www.redblobgames.com/x/1830-jittered-grid/
     */
    jitter?: number
    /** Mask function: return false to skip a grid cell. */
    mask?: (x: number, z: number) => boolean
    /** Random seed (required if jitter > 0). */
    seed?: number
}

/**
 * Generate points on a regular grid on the XZ plane (Y=0).
 * Used for city block layouts, array placements, LED panels.
 */
export function onGrid(
    sizeX: number, sizeZ: number,
    spacingX: number, spacingZ: number,
    options?: DistributeOnGridOptions,
): PointCloud {
    const cloud: PointCloud = []
    const rng = options?.seed !== undefined ? new SeededRandom(options.seed) : undefined
    const jitter = options?.jitter ?? 0
    const halfX = sizeX / 2
    const halfZ = sizeZ / 2
    const up = new Vector3(0, 1, 0)

    for (let x = -halfX + spacingX / 2; x < halfX; x += spacingX) {
        for (let z = -halfZ + spacingZ / 2; z < halfZ; z += spacingZ) {
            if (options?.mask && !options.mask(x, z)) continue

            let px = x
            let pz = z
            if (jitter > 0 && rng) {
                px += (rng.next() - 0.5) * spacingX * jitter
                pz += (rng.next() - 0.5) * spacingZ * jitter
            }

            cloud.push({
                position: new Vector3(px, 0, pz),
                normal: up.clone(),
                attrs: {},
            })
        }
    }

    return cloud
}

/**
 * Options for curve-based distribution.
 */
export interface DistributeAlongCurveOptions {
    /** Distance between points along the curve. Mutually exclusive with count. */
    spacing?: number
    /** Exact number of points. Mutually exclusive with spacing. */
    count?: number
    /** Lateral offset perpendicular to curve (positive = right of travel direction). */
    offset?: number
    /** Place on left, right, both sides, or center. Default: 'center'. */
    side?: 'left' | 'right' | 'both' | 'center'
}

/**
 * Generate points evenly spaced along a 3D curve.
 * Each point gets tangent-aligned orientation for proper placement of
 * lamp posts, fence posts, guardrails, etc.
 *
 * Uses the curve's tangent and an assumed UP vector to compute the right/normal frame.
 * For road-following objects, the right vector is projected to horizontal to avoid
 * tilting on banked curves.
 */
export function alongCurve(
    curve: CurvePath<Vector3>,
    options: DistributeAlongCurveOptions,
): PointCloud {
    const cloud: PointCloud = []
    const curveLength = curve.getLength()
    if (curveLength === 0) return cloud

    let pointCount: number
    if (options.count !== undefined) {
        pointCount = Math.max(1, Math.floor(options.count))
    } else if (options.spacing !== undefined) {
        pointCount = Math.max(1, Math.floor(curveLength / options.spacing))
    } else {
        throw new Error('Distribute.alongCurve: must specify either spacing or count')
    }

    const offset = options.offset ?? 0
    const side = options.side ?? 'center'
    const up = new Vector3(0, 1, 0)

    for (let i = 0; i <= pointCount; i++) {
        const t = i / pointCount
        const point = curve.getPointAt(t)
        const tangent = curve.getTangentAt(t).normalize()

        // Compute right vector (perpendicular to tangent, projected to horizontal)
        const right = new Vector3().crossVectors(tangent, up).normalize()
        if (right.lengthSq() < 0.001) right.set(1, 0, 0) // degenerate case: vertical tangent
        const normal = new Vector3().crossVectors(right, tangent).normalize()

        const rotation = new Euler()
        rotation.y = Math.atan2(tangent.x, tangent.z)

        const addPoint = (lateralOffset: number) => {
            const pos = point.clone()
            if (lateralOffset !== 0) pos.addScaledVector(right, lateralOffset)
            cloud.push({
                position: pos,
                normal: normal.clone(),
                rotation: rotation.clone(),
                attrs: {t},
            })
        }

        if (side === 'both') {
            addPoint(offset)
            addPoint(-offset)
        } else if (side === 'left') {
            addPoint(-Math.abs(offset))
        } else if (side === 'right') {
            addPoint(Math.abs(offset))
        } else {
            addPoint(0)
        }
    }

    return cloud
}

/**
 * Options for wall grid distribution.
 */
export interface DistributeOnWallGridOptions {
    /** Wall center position in world space. */
    origin: Vector3
    /** Wall facing direction (outward normal). */
    normal: Vector3
    /** Floor height for computing floorIndex attribute. */
    floorHeight?: number
}

/**
 * Generate points on a wall grid — the building facade pattern.
 * Creates a baysX × baysY grid of points on a wall surface, each tagged
 * with bay coordinates and floor index for rule-based module placement.
 *
 * This directly mirrors the Buildify pattern:
 * wall faces → point grid → instance modules at points.
 */
export function onWallGrid(
    width: number, height: number,
    baysX: number, baysY: number,
    options: DistributeOnWallGridOptions,
): PointCloud {
    const cloud: PointCloud = []
    const baysXi = Math.max(1, Math.floor(baysX))
    const baysYi = Math.max(1, Math.floor(baysY))
    const bayW = width / baysXi
    const bayH = height / baysYi
    const floorHeight = options.floorHeight ?? bayH

    const n = options.normal.clone().normalize()
    const up = new Vector3(0, 1, 0)
    const right = new Vector3().crossVectors(up, n).normalize()
    if (right.lengthSq() < 0.001) right.set(1, 0, 0)

    for (let iy = 0; iy < baysYi; iy++) {
        const y = (iy + 0.5) * bayH
        for (let ix = 0; ix < baysXi; ix++) {
            const x = (ix + 0.5) * bayW - width / 2

            const pos = options.origin.clone()
                .addScaledVector(right, x)
                .addScaledVector(up, y)

            cloud.push({
                position: pos,
                normal: n.clone(),
                attrs: {
                    bayX: ix,
                    bayY: iy,
                    floorIndex: Math.floor(y / floorHeight),
                },
            })
        }
    }

    return cloud
}

// --- PointCloud transform/filter utilities ---

/** Filter points by a predicate. */
export function filter(cloud: PointCloud, pred: (pt: ProcPoint) => boolean): PointCloud {
    return cloud.filter(pred)
}

/** Add or update a named attribute on every point. */
export function tag(cloud: PointCloud, name: string, fn: (pt: ProcPoint, index: number) => number | string): PointCloud {
    for (let i = 0; i < cloud.length; i++) {
        cloud[i].attrs[name] = fn(cloud[i], i)
    }
    return cloud
}

/** Add random positional jitter to all points. */
export function jitter(cloud: PointCloud, amount: Vector3, rng: SeededRandom): PointCloud {
    for (const pt of cloud) {
        pt.position.x += (rng.next() - 0.5) * amount.x
        pt.position.y += (rng.next() - 0.5) * amount.y
        pt.position.z += (rng.next() - 0.5) * amount.z
    }
    return cloud
}

/** Apply a matrix transform to all point positions and normals. */
export function transform(cloud: PointCloud, matrix: Matrix4): PointCloud {
    const normalMatrix = new Matrix4().copy(matrix).invert().transpose()
    for (const pt of cloud) {
        pt.position.applyMatrix4(matrix)
        pt.normal.applyMatrix4(normalMatrix).normalize()
    }
    return cloud
}

/** Merge multiple point clouds into one. */
export function merge(...clouds: PointCloud[]): PointCloud {
    const result: PointCloud = []
    for (const cloud of clouds) {
        result.push(...cloud)
    }
    return result
}
