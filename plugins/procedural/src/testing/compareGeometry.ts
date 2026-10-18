/**
 * Compare a `GeometrySet` with geometry exported from Blender (`porting/blender/geometry_dump.py`,
 * and the geonodes-kit reference format it extends): counts, topology, element order and every
 * attribute on every domain, instances with transforms and references, recursively.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {DATA_TYPES, DataType} from '../geometry/dataTypes'
import {GeometrySet} from '../geometry/GeometrySet'
import {CurvesGeometry, InstanceReference, Instances, PointCloud} from '../geometry/components'
import {AttributeStorage} from '@threepipe/mesh-kernel'
import {decodeByteColor} from '../blender/color'

export interface ExpectedAttribute {
    name: string
    domain: string
    type: string
    values: (number | null)[] | null
}

export interface ExpectedGeometry {
    name?: string
    mesh?: {
        vertices: number
        edges: number[] | number
        faceStarts?: number[]
        faceSizes?: number[]
        faceOffsets?: number[]
        cornerVertices?: number[]
        attributes: ExpectedAttribute[]
    }
    pointcloud?: {points: number, attributes: ExpectedAttribute[]}
    curves?: {curves: number, points: number, curveOffsets?: number[], attributes: ExpectedAttribute[]}
    instances?: {count: number, attributes: ExpectedAttribute[], references: ExpectedReference[]}
}

export type ExpectedReference =
    | {kind: 'none'}
    | {kind: 'object' | 'collection', name: string}
    | {kind: 'geometry', geometry: ExpectedGeometry}

export interface CompareOptions {
    /** Relative/absolute float tolerance: |a - b| <= tol * max(1, |b|). */
    tolerance?: number
    /** Attributes not compared (editor state). */
    ignore?: readonly string[]
    /**
     * How the export wrote byte colours: `linear` (`ByteColorAttributeValue.color`, decoded floats -
     * the geonodes-kit exporter) or `srgb` (`.color_srgb`, byte / 255 - `porting/blender/geometry_dump.py`).
     */
    byteColor?: 'linear' | 'srgb'
    /**
     * Float tolerance in float32 units in the last place instead of {@link tolerance}: 0 is bit-exact.
     * Used to report how far from exact a case is (platform `sinf`/`powf`/`atan2f` are not correctly rounded).
     */
    ulps?: number
}

type ResolvedOptions = Required<Omit<CompareOptions, 'ulps'>> & Pick<CompareOptions, 'ulps'>

const f32buf = new Float32Array(1)
const i32buf = new Int32Array(f32buf.buffer)

/** Distance between two numbers in float32 ULPs (both rounded to float32; ordered integer mapping). */
export function ulpDistance(a: number, b: number): number {
    f32buf[0] = a
    let x = i32buf[0]
    f32buf[0] = b
    let y = i32buf[0]
    if (x < 0) x = -2147483648 - x
    if (y < 0) y = -2147483648 - y
    return Math.abs(x - y)
}

/** Editor UI state Blender's primitive operators add; geometry nodes only carry them along. */
export const EDITOR_STATE_ATTRIBUTES = [
    '.select_vert', '.select_edge', '.select_poly', '.uv_select_vert', '.uv_select_edge', '.uv_select_face',
    '.hide_vert', '.hide_edge', '.hide_poly',
] as const

const TYPE_NAMES: Record<string, DataType> = {
    FLOAT: 'float', INT: 'int32', INT8: 'int8', BOOLEAN: 'bool', FLOAT2: 'float2', FLOAT_VECTOR: 'float3',
    FLOAT_COLOR: 'float4', BYTE_COLOR: 'byteColor', QUATERNION: 'quaternion', FLOAT4X4: 'float4x4',
    INT32_2D: 'int32x2', INT16_2D: 'int16x2',
}

const DOMAIN_NAMES: Record<string, AttrDomain> = {
    POINT: AttrDomain.Point, EDGE: AttrDomain.Edge, FACE: AttrDomain.Face, CORNER: AttrDomain.Corner,
    CURVE: AttrDomain.Curve, INSTANCE: AttrDomain.Instance,
}

function isEmptyMesh(m: ExpectedGeometry['mesh']): boolean {
    if (!m) return true
    const edges = typeof m.edges === 'number' ? m.edges : m.edges.length
    const faces = m.faceSizes?.length ?? (m.faceOffsets ? m.faceOffsets.length - 1 : 0)
    return m.vertices === 0 && edges === 0 && faces === 0
}

function byteColorAsExported(data: ArrayLike<number>, mode: 'linear' | 'srgb'): number[] {
    const out: number[] = []
    for (let i = 0; i < data.length; i += 4) {
        const px = [data[i], data[i + 1], data[i + 2], data[i + 3]]
        out.push(...(mode === 'linear' ? decodeByteColor(px) : px.map(v => Math.fround(v / 255))))
    }
    return out
}

function compareAttributes(
    where: string, storage: AttributeStorage, expected: ExpectedAttribute[], o: ResolvedOptions,
    domainOverride: AttrDomain | undefined, out: string[],
): void {
    const seen = new Set<string>()
    for (const e of expected) {
        if (o.ignore.includes(e.name)) continue
        // `instance_transform` etc. are reported on the point domain of the instances point cloud.
        if (domainOverride === AttrDomain.Instance && e.name === 'position') continue
        seen.add(e.name)
        const layer = storage.get(e.name)
        const type = TYPE_NAMES[e.type]
        const domain = domainOverride ?? DOMAIN_NAMES[e.domain]
        if (!layer) {
            out.push(`${where}: missing attribute '${e.name}' (${e.domain} ${e.type})`)
            continue
        }
        if (layer.type !== type || layer.domain !== domain) {
            out.push(`${where}: attribute '${e.name}' is ${layer.type} on domain ${layer.domain}, expected ${type} on ${e.domain}`)
            continue
        }
        if (!e.values) continue
        if (layer.data.length !== e.values.length) {
            out.push(`${where}: attribute '${e.name}' has ${layer.data.length} values, expected ${e.values.length}`)
            continue
        }
        const isFloat = DATA_TYPES[type].isFloat || type === 'byteColor'
        let bad = 0
        let first = ''
        const decoded = type === 'byteColor' ? byteColorAsExported(layer.data, o.byteColor) : undefined
        for (let i = 0; i < e.values.length; i++) {
            const want = e.values[i]
            const got = decoded ? decoded[i] : layer.data[i]
            const ok = want === null ? Number.isNaN(got) : isFloat
                ? (o.ulps !== undefined && type !== 'byteColor' ? ulpDistance(got, want) <= o.ulps
                    : Math.abs(got - want) <= o.tolerance * Math.max(1, Math.abs(want)))
                : got === want || (type === 'bool' && (got !== 0) === (want !== 0))
            if (!ok) {
                if (!bad) first = `[${i}] ${got} != ${want}`
                bad++
            }
        }
        if (bad) out.push(`${where}: attribute '${e.name}' differs in ${bad}/${e.values.length} values, first ${first}`)
    }
    for (const name of storage.names()) {
        if (seen.has(name) || o.ignore.includes(name) || name.startsWith('.a_')) continue
        if (expected.some(e => e.name === name)) continue
        out.push(`${where}: unexpected attribute '${name}'`)
    }
}

function compareMesh(m: MeshData | undefined, e: NonNullable<ExpectedGeometry['mesh']>, o: ResolvedOptions, where: string, out: string[]): void {
    if (!m) {
        out.push(`${where}: missing mesh (${e.vertices} vertices expected)`)
        return
    }
    if (m.vertsNum !== e.vertices) out.push(`${where}: ${m.vertsNum} vertices, expected ${e.vertices}`)
    const edgesNum = typeof e.edges === 'number' ? e.edges : e.edges.length / 2
    if (m.edgesNum !== edgesNum) out.push(`${where}: ${m.edgesNum} edges, expected ${edgesNum}`)
    const offsets = e.faceOffsets ?? (e.faceStarts ? [...e.faceStarts, e.faceStarts.length ? e.faceStarts[e.faceStarts.length - 1] + e.faceSizes![e.faceSizes!.length - 1] : 0] : undefined)
    if (offsets && (m.faceOffsets.length !== offsets.length || offsets.some((v, i) => m.faceOffsets[i] !== v))) {
        out.push(`${where}: face offsets differ (${m.facesNum} faces, expected ${offsets.length - 1})`)
    }
    if (out.length) return
    compareAttributes(where, m.attributes, e.attributes, o, undefined, out)
}

function compareReferences(actual: Instances, expected: ExpectedReference[], o: ResolvedOptions, where: string, out: string[]): void {
    if (actual.references.length !== expected.length) {
        out.push(`${where}: ${actual.references.length} references, expected ${expected.length}`)
        return
    }
    expected.forEach((e, i) => {
        const a: InstanceReference = actual.references[i]
        const w = `${where}.references[${i}]`
        if (e.kind === 'none') {
            if (a.type !== 'none') out.push(`${w}: ${a.type}, expected none`)
        } else if (e.kind === 'object' || e.kind === 'collection') {
            if (a.type !== e.kind || a.name !== e.name) out.push(`${w}: ${a.type} ${'name' in a ? a.name : ''}, expected ${e.kind} ${e.name}`)
        } else if (a.type !== 'geometry') {
            out.push(`${w}: ${a.type}, expected geometry`)
        } else {
            out.push(...compareGeometry(a.geometry, (e as {geometry: ExpectedGeometry}).geometry, o, w))
        }
    })
}

/** Differences between `actual` and Blender's `expected`; empty means a match. */
export function compareGeometry(actual: GeometrySet, expected: ExpectedGeometry, options: CompareOptions = {}, where = 'geometry'): string[] {
    const o: ResolvedOptions = {
        tolerance: options.tolerance ?? 1e-5, ignore: options.ignore ?? EDITOR_STATE_ATTRIBUTES, byteColor: options.byteColor ?? 'linear',
        ulps: options.ulps,
    }
    const out: string[] = []
    if (expected.mesh && !isEmptyMesh(expected.mesh)) compareMesh(actual.mesh, expected.mesh, o, `${where}.mesh`, out)
    else if (actual.mesh && !actual.mesh.isEmpty) out.push(`${where}: unexpected mesh (${actual.mesh.describe()})`)
    const pc: PointCloud | undefined = actual.pointCloud
    if (expected.pointcloud) {
        if (!pc) out.push(`${where}: missing point cloud`)
        else {
            if (pc.pointsNum !== expected.pointcloud.points) out.push(`${where}.pointcloud: ${pc.pointsNum} points, expected ${expected.pointcloud.points}`)
            else compareAttributes(`${where}.pointcloud`, pc.attributes, expected.pointcloud.attributes, o, undefined, out)
        }
    } else if (pc && pc.pointsNum) out.push(`${where}: unexpected point cloud (${pc.pointsNum} points)`)
    const cv: CurvesGeometry | undefined = actual.curves
    if (expected.curves) {
        if (!cv) out.push(`${where}: missing curves`)
        else if (cv.curvesNum !== expected.curves.curves || cv.pointsNum !== expected.curves.points) {
            out.push(`${where}.curves: ${cv.curvesNum} curves / ${cv.pointsNum} points, expected ${expected.curves.curves} / ${expected.curves.points}`)
        } else {
            if (expected.curves.curveOffsets && expected.curves.curveOffsets.some((v, i) => cv.curveOffsets[i] !== v)) out.push(`${where}.curves: curve offsets differ`)
            compareAttributes(`${where}.curves`, cv.attributes, expected.curves.attributes, o, undefined, out)
        }
    } else if (cv && cv.curvesNum) out.push(`${where}: unexpected curves (${cv.curvesNum})`)
    const inst = actual.instances
    if (expected.instances) {
        if (!inst) out.push(`${where}: missing instances`)
        else if (inst.instancesNum !== expected.instances.count) out.push(`${where}.instances: ${inst.instancesNum} instances, expected ${expected.instances.count}`)
        else {
            compareAttributes(`${where}.instances`, inst.attributes, expected.instances.attributes, o, AttrDomain.Instance, out)
            compareReferences(inst, expected.instances.references, o, `${where}.instances`, out)
        }
    } else if (inst && inst.instancesNum) out.push(`${where}: unexpected instances (${inst.instancesNum})`)
    return out
}
