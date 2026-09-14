/**
 * Face classification system for procedural generation.
 * Classifies every face in a geometry based on declarative rules.
 *
 * This is the entry point for all architectural generators. In Blender,
 * people chain Normal → Dot Product → Compare → Separate Geometry nodes
 * (4-6 nodes per classification). This makes it one function call.
 *
 * The prebuilt BUILDING_RULES encode the actual patterns observed in
 * Buildify, Gauthier's Auto-Building, and Coan's PBG:
 * - Face normal direction → wall/roof/floor classification
 * - Face center Y position → ground floor vs upper floor
 * - Face area → small/medium/large detail level
 *
 * References:
 * - Buildify: https://paveloliva.gumroad.com/l/buildify
 * - Auto-Building (Gauthier): https://juliengauthier.gumroad.com/l/nzifx
 *   (material index for face roles, edge crease for pillars)
 * - Coan's PBG: https://coan.gumroad.com/l/pbg-2
 *   (works on any mesh, analyzes face width/height)
 */

import {BufferAttribute, BufferGeometry, Vector3} from 'threepipe'

// Reusable vectors to avoid per-face allocation
const _v0 = new Vector3()
const _v1 = new Vector3()
const _v2 = new Vector3()
const _edge1 = new Vector3()
const _edge2 = new Vector3()
const _normal = new Vector3()
const _center = new Vector3()

/**
 * Information about a single face, precomputed for rule evaluation.
 */
export interface FaceInfo {
    /** Face index (triangle index, not vertex index). */
    index: number
    /** Face normal (computed from cross product of edges). */
    normal: Vector3
    /** Face center (average of three vertices). */
    center: Vector3
    /** Face area in world units. */
    area: number
    /** Slope angle from UP vector in degrees (0 = horizontal, 90 = vertical). */
    slopeAngle: number
    /**
     * Cardinal direction the face is most aligned with.
     * Determined by which axis the face normal projects onto most strongly.
     */
    facingDirection: 'up' | 'down' | 'north' | 'south' | 'east' | 'west'
}

/**
 * A classification rule: name + condition predicate + optional priority.
 */
export interface ClassificationRule {
    /** Label for faces matching this rule (e.g., 'roof', 'wall_north'). */
    name: string
    /** Predicate that returns true if the face matches this rule. */
    condition: (face: FaceInfo) => boolean
    /** Higher priority wins when multiple rules match. Default 0. */
    priority?: number
}

/**
 * Result of face classification.
 */
export interface FaceClassification {
    /** Per-face label (one string per face). */
    labels: string[]
    /** Map from label to array of face indices with that label. */
    groups: Map<string, number[]>
    /** Precomputed FaceInfo for all faces. */
    faceInfos: FaceInfo[]
}

function computeFacingDirection(normal: Vector3): FaceInfo['facingDirection'] {
    const ax = Math.abs(normal.x)
    const ay = Math.abs(normal.y)
    const az = Math.abs(normal.z)
    if (ay >= ax && ay >= az) return normal.y > 0 ? 'up' : 'down'
    if (ax >= ay && ax >= az) return normal.x > 0 ? 'east' : 'west'
    return normal.z > 0 ? 'south' : 'north'
}

/**
 * Classify every face in a geometry according to the given rules.
 * Rules are evaluated in priority order (highest first). The first matching rule wins.
 * Faces that match no rule get the label 'unclassified'.
 */
export function classify(geo: BufferGeometry, rules: ClassificationRule[]): FaceClassification {
    const positions = geo.getAttribute('position') as BufferAttribute
    const index = geo.getIndex()
    if (!positions) throw new Error('FaceClassifier.classify: geometry has no positions.')

    // Sort rules by priority (descending)
    const sortedRules = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    const faceCount = index ? index.count / 3 : positions.count / 3
    const faceInfos: FaceInfo[] = new Array(faceCount)
    const labels: string[] = new Array(faceCount)
    const groups = new Map<string, number[]>()

    for (let f = 0; f < faceCount; f++) {
        // Get vertex positions for this face
        let i0: number, i1: number, i2: number
        if (index) {
            i0 = index.getX(f * 3)
            i1 = index.getX(f * 3 + 1)
            i2 = index.getX(f * 3 + 2)
        } else {
            i0 = f * 3
            i1 = f * 3 + 1
            i2 = f * 3 + 2
        }

        _v0.set(positions.getX(i0), positions.getY(i0), positions.getZ(i0))
        _v1.set(positions.getX(i1), positions.getY(i1), positions.getZ(i1))
        _v2.set(positions.getX(i2), positions.getY(i2), positions.getZ(i2))

        // Compute face normal via cross product
        _edge1.subVectors(_v1, _v0)
        _edge2.subVectors(_v2, _v0)
        _normal.crossVectors(_edge1, _edge2)

        // Area = 0.5 * |cross product|
        const area = _normal.length() * 0.5
        _normal.normalize()

        // Center = average of three vertices
        _center.addVectors(_v0, _v1).add(_v2).divideScalar(3)

        // Slope angle from UP
        const dot = Math.min(1, Math.max(-1, _normal.y))
        const slopeAngle = Math.acos(dot) * (180 / Math.PI)

        const info: FaceInfo = {
            index: f,
            normal: _normal.clone(),
            center: _center.clone(),
            area,
            slopeAngle,
            facingDirection: computeFacingDirection(_normal),
        }
        faceInfos[f] = info

        // Evaluate rules in priority order
        let matched = false
        for (const rule of sortedRules) {
            if (rule.condition(info)) {
                labels[f] = rule.name
                if (!groups.has(rule.name)) groups.set(rule.name, [])
                groups.get(rule.name)!.push(f)
                matched = true
                break
            }
        }
        if (!matched) {
            labels[f] = 'unclassified'
            if (!groups.has('unclassified')) groups.set('unclassified', [])
            groups.get('unclassified')!.push(f)
        }
    }

    return {labels, groups, faceInfos}
}

/**
 * Prebuilt rules for building face classification.
 * Encodes the standard Blender building generator patterns:
 * - Roof: face pointing up (slope < 20°)
 * - Floor: face pointing down (normal.y < -0.7)
 * - Walls: face mostly vertical (slope > 70°), subdivided by cardinal direction
 *
 * Priority ensures specific wall directions match before the generic 'wall' fallback.
 */
export const BUILDING_RULES: ClassificationRule[] = [
    {name: 'roof', condition: f => f.slopeAngle < 20, priority: 10},
    {name: 'floor', condition: f => f.normal.y < -0.7, priority: 10},
    {name: 'wall_north', condition: f => f.facingDirection === 'north' && f.slopeAngle > 70},
    {name: 'wall_south', condition: f => f.facingDirection === 'south' && f.slopeAngle > 70},
    {name: 'wall_east', condition: f => f.facingDirection === 'east' && f.slopeAngle > 70},
    {name: 'wall_west', condition: f => f.facingDirection === 'west' && f.slopeAngle > 70},
    {name: 'wall', condition: f => f.slopeAngle > 70, priority: -1},
]

/**
 * Prebuilt rules for terrain face classification.
 * Useful for material assignment: cliff faces get rock texture,
 * flat faces get grass, etc.
 */
export const TERRAIN_RULES: ClassificationRule[] = [
    {name: 'cliff', condition: f => f.slopeAngle > 60, priority: 10},
    {name: 'steep', condition: f => f.slopeAngle > 30},
    {name: 'flat', condition: f => f.slopeAngle < 15, priority: 5},
    {name: 'moderate', condition: () => true, priority: -1},
]

/**
 * Extract faces from a geometry into a new BufferGeometry.
 * Produces dual output like Blender's Separate Geometry node:
 * - selected: geometry containing only the specified faces
 * - remainder: geometry containing all other faces
 *
 * Handles vertex compaction — only vertices referenced by the selected faces are included,
 * with index remapping. Copies position, normal, uv, and color attributes.
 *
 * Reference: Blender separate_geometry.cc
 * https://projects.blender.org/blender/blender/src/branch/main/source/blender/nodes/geometry/nodes/node_geo_separate_geometry.cc
 *
 * @param geo Source geometry (must be indexed triangles)
 * @param faceIndices Array of face indices to extract
 */
export function extractFaces(
    geo: BufferGeometry,
    faceIndices: number[],
): {selected: BufferGeometry, remainder: BufferGeometry} {
    const srcPositions = geo.getAttribute('position') as BufferAttribute
    const srcIndex = geo.getIndex()
    if (!srcPositions) throw new Error('FaceClassifier.extractFaces: geometry has no positions')

    const totalFaces = srcIndex ? srcIndex.count / 3 : srcPositions.count / 3
    const selectedSet = new Set(faceIndices)

    // Separate faces into two groups
    const selectedFaces: number[] = []
    const remainderFaces: number[] = []
    for (let f = 0; f < totalFaces; f++) {
        if (selectedSet.has(f)) selectedFaces.push(f)
        else remainderFaces.push(f)
    }

    return {
        selected: _buildSubGeometry(geo, selectedFaces),
        remainder: _buildSubGeometry(geo, remainderFaces),
    }
}

/**
 * Build a new BufferGeometry from a subset of faces, with vertex compaction.
 */
function _buildSubGeometry(geo: BufferGeometry, faceIndices: number[]): BufferGeometry {
    const srcPositions = geo.getAttribute('position') as BufferAttribute
    const srcNormals = geo.getAttribute('normal') as BufferAttribute | null
    const srcUvs = geo.getAttribute('uv') as BufferAttribute | null
    const srcColors = geo.getAttribute('color') as BufferAttribute | null
    const srcIndex = geo.getIndex()

    // Collect unique vertices and build remapping
    const vertexMap = new Map<number, number>() // old index → new index
    const usedVertices: number[] = []

    for (const f of faceIndices) {
        for (let v = 0; v < 3; v++) {
            const srcVert = srcIndex ? srcIndex.getX(f * 3 + v) : f * 3 + v
            if (!vertexMap.has(srcVert)) {
                vertexMap.set(srcVert, usedVertices.length)
                usedVertices.push(srcVert)
            }
        }
    }

    // Build compacted vertex arrays
    const positions = new Float32Array(usedVertices.length * 3)
    const normals = srcNormals ? new Float32Array(usedVertices.length * 3) : null
    const uvs = srcUvs ? new Float32Array(usedVertices.length * 2) : null
    const colors = srcColors ? new Float32Array(usedVertices.length * srcColors.itemSize) : null

    for (let i = 0; i < usedVertices.length; i++) {
        const src = usedVertices[i]
        positions[i * 3] = srcPositions.getX(src)
        positions[i * 3 + 1] = srcPositions.getY(src)
        positions[i * 3 + 2] = srcPositions.getZ(src)
        if (normals && srcNormals) {
            normals[i * 3] = srcNormals.getX(src)
            normals[i * 3 + 1] = srcNormals.getY(src)
            normals[i * 3 + 2] = srcNormals.getZ(src)
        }
        if (uvs && srcUvs) {
            uvs[i * 2] = srcUvs.getX(src)
            uvs[i * 2 + 1] = srcUvs.getY(src)
        }
        if (colors && srcColors) {
            for (let c = 0; c < srcColors.itemSize; c++) {
                colors[i * srcColors.itemSize + c] = (srcColors.array as Float32Array)[src * srcColors.itemSize + c]
            }
        }
    }

    // Build remapped indices
    const indexCount = faceIndices.length * 3
    const indices = usedVertices.length > 65535
        ? new Uint32Array(indexCount)
        : new Uint16Array(indexCount)

    for (let f = 0; f < faceIndices.length; f++) {
        const srcFace = faceIndices[f]
        for (let v = 0; v < 3; v++) {
            const srcVert = srcIndex ? srcIndex.getX(srcFace * 3 + v) : srcFace * 3 + v
            indices[f * 3 + v] = vertexMap.get(srcVert)!
        }
    }

    const result = new BufferGeometry()
    result.setAttribute('position', new BufferAttribute(positions, 3))
    if (normals) result.setAttribute('normal', new BufferAttribute(normals, 3))
    if (uvs) result.setAttribute('uv', new BufferAttribute(uvs, 2))
    if (colors) result.setAttribute('color', new BufferAttribute(colors, srcColors!.itemSize))
    result.setIndex(new BufferAttribute(indices, 1))

    return result
}
