import {
    CubicBezierCurve,
    CubicBezierCurve3,
    Curve,
    CurvePath,
    LineCurve,
    LineCurve3,
    QuadraticBezierCurve,
    QuadraticBezierCurve3,
    Vector2,
    Vector3,
} from 'three'
import {CurvePath3} from './curve'

/** A point of a curve: a `Vector3` of a 3D curve, a `Vector2` of a 2D curve */
export type CurveVector = Vector2 | Vector3

/**
 * An editable point of a three.js curve (in the space of the curve), from {@link getCurveEditPoints}.
 *
 * The joint of two curves of a path is one point: the end of a curve and the start of the next one. They can be the
 * same `Vector3` (as `PenToolPlugin` makes them) or two equal vectors (a path loaded from a file), `vecs` has each.
 */
export interface CurveEditPoint {
    /** The position, in the space of the curve. The first of `vecs` */
    vec: CurveVector
    /** Every vector of the curve at this point; {@link setCurveEditPoint} sets them all */
    vecs: CurveVector[]
    /** The path of each vector of `vecs` in the curve, like `v0`, `points.2`, `curves.1.v3` */
    keys: string[]
    /** `anchor`: on the curve. `control`: a Bezier control point (a handle), off the curve */
    kind: 'anchor' | 'control'
    /**
     * For a control point, the anchors (indices in the list) it pulls on: one for a cubic Bezier handle, two for the
     * control point of a quadratic Bezier. A cubic handle moves with its anchor. Empty for an anchor.
     */
    anchors: number[]
}

/** A part of a curve between two anchors, from {@link getCurveSegments} */
export interface CurveSegment {
    /** Index of the segment, for {@link addCurvePoint} */
    index: number
    /** Index of the anchor at the start, in {@link getCurveEditPoints} */
    from: number
    /** Index of the anchor at the end */
    to: number
    /** The point of the curve in the middle of the segment, where {@link addCurvePoint} adds a point */
    mid: Vector3
}

type Kind = 'line' | 'cubic' | 'quad' | 'spline' | 'other'

/** A curve that is not a path (a leaf of the path tree) */
interface Part {
    curve: any
    kind: Kind
    /** The path that has this curve, and its index there; none for a curve that is not in a path */
    parent?: CurvePath<any>
    indexInParent: number
    /** Indices of the points of this curve in the list, in curve order */
    pointIdx: number[]
    /** Indices of its anchors, in curve order */
    anchorIdx: number[]
    /** The number of segments; one for a line or a Bezier, one between two points of a spline */
    segments: number
}

interface Analysis {
    points: CurveEditPoint[]
    parts: Part[]
}

function isVec(v: any): v is CurveVector {
    return !!v && (v.isVector3 || v.isVector2)
}

function isPath(c: any): c is CurvePath<any> {
    return !!c && Array.isArray(c.curves)
}

function kindOf(c: any): Kind {
    if (c.isLineCurve || c.isLineCurve3) return 'line'
    if (c.isCubicBezierCurve || c.isCubicBezierCurve3) return 'cubic'
    if (c.isQuadraticBezierCurve || c.isQuadraticBezierCurve3) return 'quad'
    if ((c.isCatmullRomCurve3 || c.isSplineCurve) && Array.isArray(c.points)) return 'spline'
    return 'other'
}

/** The keys of a curve in curve order, and which ones are anchors */
function partKeys(c: any, kind: Kind): {key: string, anchor: boolean}[] {
    switch (kind) {
    case 'line': return [{key: 'v1', anchor: true}, {key: 'v2', anchor: true}]
    case 'cubic': return [{key: 'v0', anchor: true}, {key: 'v1', anchor: false}, {key: 'v2', anchor: false}, {key: 'v3', anchor: true}]
    case 'quad': return [{key: 'v0', anchor: true}, {key: 'v1', anchor: false}, {key: 'v2', anchor: true}]
    case 'spline': return (c.points as any[]).map((_, i) => ({key: 'points.' + i, anchor: true}))
    default: {
        // another curve type with vector fields: its points, shown as anchors
        const res = ['v0', 'v1', 'v2', 'v3'].filter(k => isVec(c[k])).map(key => ({key, anchor: true}))
        if (Array.isArray(c.points)) (c.points as any[]).forEach((p, i) => isVec(p) && res.push({key: 'points.' + i, anchor: true}))
        return res
    }
    }
}

function getVec(c: any, key: string): CurveVector {
    return key.startsWith('points.') ? c.points[+key.slice(7)] : c[key]
}

function same(a: CurveVector, b: CurveVector) {
    return a === b || a.x === b.x && a.y === b.y && (a as Vector3).z === (b as Vector3).z
}

function leaves(curve: any, prefix: string, out: {curve: any, prefix: string, parent?: CurvePath<any>, index: number}[], parent?: CurvePath<any>, index = 0) {
    if (isPath(curve)) curve.curves.forEach((c, i) => leaves(c, prefix + 'curves.' + i + '.', out, curve, i))
    else if (curve) out.push({curve, prefix, parent, index})
    return out
}

function analyze(curve: Curve<any> | undefined | null): Analysis {
    const points: CurveEditPoint[] = []
    const parts: Part[] = []
    if (!curve) return {points, parts}
    for (const leaf of leaves(curve, '', [])) {
        const kind = kindOf(leaf.curve)
        const keys = partKeys(leaf.curve, kind)
        const part: Part = {curve: leaf.curve, kind, parent: leaf.parent, indexInParent: leaf.index, pointIdx: [], anchorIdx: [], segments: 0}
        const prev = parts[parts.length - 1]
        const prevEnd = prev?.anchorIdx[prev.anchorIdx.length - 1]
        keys.forEach(({key, anchor}, i) => {
            const vec = getVec(leaf.curve, key)
            if (!isVec(vec)) return
            const k = leaf.prefix + key
            let idx: number
            // the start of a curve of a path, at the end of the curve before it: one point, the joint
            if (i === 0 && anchor && prevEnd !== undefined && same(points[prevEnd].vec, vec)) {
                idx = prevEnd
                points[idx].vecs.push(vec)
                points[idx].keys.push(k)
            } else {
                idx = points.length
                points.push({vec, vecs: [vec], keys: [k], kind: anchor ? 'anchor' : 'control', anchors: []})
            }
            part.pointIdx.push(idx)
            if (anchor) part.anchorIdx.push(idx)
        })
        // the anchors each control point pulls on
        if (kind === 'cubic' && part.pointIdx.length === 4) {
            const [a0, c1, c2, a1] = part.pointIdx
            points[c1].anchors.push(a0)
            points[c2].anchors.push(a1)
        } else if (kind === 'quad' && part.pointIdx.length === 3) {
            const [a0, c, a1] = part.pointIdx
            points[c].anchors.push(a0, a1)
        }
        const n = part.anchorIdx.length
        part.segments = kind === 'spline' ? leaf.curve.closed ? n : n - 1 : kind === 'other' ? 0 : 1
        parts.push(part)
    }
    // a closed path: the end of the last curve is the start of the first one
    if (parts.length > 1) {
        const first = parts[0], last = parts[parts.length - 1]
        const a = first.anchorIdx[0], bi = last.anchorIdx.length - 1, b = last.anchorIdx[bi]
        if (a !== undefined && b !== undefined && a !== b && same(points[a].vec, points[b].vec)) merge(points, parts, b, a)
    }
    return {points, parts}
}

/** Merge point `from` into point `into`, and renumber the indices after `from` */
function merge(points: CurveEditPoint[], parts: Part[], from: number, into: number) {
    const p = points[from]
    points[into].vecs.push(...p.vecs)
    points[into].keys.push(...p.keys)
    points.splice(from, 1)
    const re = (i: number) => i === from ? into : i > from ? i - 1 : i
    for (const pt of points) pt.anchors = pt.anchors.map(re)
    for (const part of parts) {
        part.pointIdx = part.pointIdx.map(re)
        part.anchorIdx = part.anchorIdx.map(re)
    }
}

/**
 * The editable points of a three.js curve, in the order of the curve: `v0`..`v3` of lines and Beziers, `points` of
 * splines, and the points of each curve of a `CurvePath` (`curves.i.*`), with each joint between two curves once.
 * The vectors are the ones of the curve (not copies).
 */
export function getCurveEditPoints(curve: Curve<any> | undefined | null): CurveEditPoint[] {
    return analyze(curve).points
}

/** Every vector of a curve (each once), for a snapshot of its points */
export function getCurveVectors(curve: Curve<any> | undefined | null): CurveVector[] {
    return getCurveEditPoints(curve).flatMap(p => p.vecs)
}

/**
 * Call after changing the points of a curve. `CurvePath.updateArcLengths` keeps the cached lengths of its curves, so
 * the lengths of each curve are reset too.
 */
export function updateCurveArcLengths(curve: Curve<any>) {
    if (isPath(curve)) curve.curves.forEach(updateCurveArcLengths)
    curve.updateArcLengths()
}

function setVec(v: CurveVector, p: {x: number, y: number, z?: number}) {
    v.x = p.x
    v.y = p.y
    if ((v as Vector3).isVector3) (v as Vector3).z = p.z ?? 0
}

function toV3(v: {x: number, y: number, z?: number}) {
    return new Vector3(v.x, v.y, v.z ?? 0)
}

export interface SetCurvePointOptions {
    /** Moving an anchor moves its cubic Bezier handles by the same amount, as in Figma or Illustrator. Default `true` */
    moveHandles?: boolean
    /**
     * Moving a handle of a smooth point (two handles on one line through the anchor) turns the other handle to keep
     * the point smooth; its length stays. Default `true`
     */
    keepSmooth?: boolean
}

/**
 * Set the point `index` of {@link getCurveEditPoints} (all its vectors) to a position in the space of the curve. A 2D
 * curve takes `x` and `y`. Updates the arc lengths of the curve.
 */
export function setCurveEditPoint(curve: Curve<any>, index: number, position: {x: number, y: number, z?: number}, options: SetCurvePointOptions = {}) {
    const points = getCurveEditPoints(curve)
    const p = points[index]
    if (!p) return
    const before = toV3(p.vec)
    const delta = toV3(position).sub(before)
    if (p.kind === 'anchor' && (options.moveHandles ?? true)) {
        for (const c of points) {
            if (c.kind !== 'control' || c.anchors.length !== 1 || c.anchors[0] !== index) continue
            const q = toV3(c.vec).add(delta)
            c.vecs.forEach(v => setVec(v, q))
        }
    } else if (p.kind === 'control' && p.anchors.length === 1 && (options.keepSmooth ?? true)) {
        const ai = p.anchors[0]
        const anchor = toV3(points[ai].vec)
        const others = points.filter(c => c !== p && c.kind === 'control' && c.anchors.length === 1 && c.anchors[0] === ai)
        if (others.length === 1) {
            const o = others[0]
            const d0 = before.clone().sub(anchor), d1 = toV3(o.vec).sub(anchor)
            const l0 = d0.length(), l1 = d1.length()
            // smooth: the two handles point in opposite directions
            if (l0 > 1e-9 && l1 > 1e-9 && d0.dot(d1) / (l0 * l1) < -0.9999) {
                const dir = toV3(position).sub(anchor)
                if (dir.lengthSq() > 1e-18) {
                    const q = anchor.clone().addScaledVector(dir.normalize(), -l1)
                    o.vecs.forEach(v => setVec(v, q))
                }
            }
        }
    }
    p.vecs.forEach(v => setVec(v, position))
    updateCurveArcLengths(curve)
}

/**
 * A copy of the curve. Vectors that are shared in the curve (the joints of a path) are shared in the copy, and the
 * copy shares no vector with the curve.
 */
export function cloneCurve<T extends Curve<any>>(curve: T, map = new Map<CurveVector, CurveVector>()): T {
    const v = (x: CurveVector) => {
        let y = map.get(x)
        if (!y) {
            y = x.clone()
            map.set(x, y)
        }
        return y
    }
    if (isPath(curve)) {
        const path = new (curve.constructor as any)() as CurvePath<any>
        path.autoClose = curve.autoClose
        curve.curves.forEach(c => path.curves.push(cloneCurve(c, map)))
        return path as any
    }
    const c = curve.clone() as any
    for (const k of ['v0', 'v1', 'v2', 'v3']) if (isVec((curve as any)[k])) c[k] = v((curve as any)[k])
    if (Array.isArray((curve as any).points)) c.points = (curve as any).points.map((p: any) => isVec(p) ? v(p) : p)
    return c
}

/** True when {@link addCurvePoint} can add a point to the curve: lines, Beziers, splines and paths of them */
export function canAddCurvePoints(curve: Curve<any> | undefined | null): boolean {
    return getCurveSegments(curve).length > 0
}

function partOfSegment(parts: Part[], segment: number) {
    let s = segment
    for (const part of parts) {
        if (s < part.segments) return {part, local: s}
        s -= part.segments
    }
    return undefined
}

/** The parameter of a spline in the middle of its segment `i` */
function splineT(c: any, i: number) {
    const n = c.points.length
    return (i + 0.5) / (c.closed ? n : n - 1)
}

/** The segments of a curve: between two anchors of a line, a Bezier or a spline. Empty for other curves (an ellipse) */
export function getCurveSegments(curve: Curve<any> | undefined | null): CurveSegment[] {
    const {parts} = analyze(curve)
    const res: CurveSegment[] = []
    for (const part of parts) {
        const a = part.anchorIdx
        for (let i = 0; i < part.segments; i++) {
            const mid = part.curve.getPoint(part.kind === 'spline' ? splineT(part.curve, i) : 0.5)
            res.push({index: res.length, from: a[i], to: a[(i + 1) % a.length], mid: toV3(mid)})
        }
    }
    return res
}

function lerp(a: CurveVector, b: CurveVector, t: number): CurveVector {
    return (a.clone() as any).lerp(b, t)
}

/** The curve split in two at `t` (de Casteljau), sharing the new middle point; the ends stay the same vectors */
function split(c: any, kind: Kind, t: number): any[] {
    const is3 = (c.v0 ?? c.v1).isVector3 === true
    if (kind === 'line') {
        const m = lerp(c.v1, c.v2, t)
        return is3 ? [new LineCurve3(c.v1, m as Vector3), new LineCurve3(m as Vector3, c.v2)] :
            [new LineCurve(c.v1, m as Vector2), new LineCurve(m as Vector2, c.v2)]
    }
    if (kind === 'quad') {
        const a = lerp(c.v0, c.v1, t), b = lerp(c.v1, c.v2, t), m = lerp(a, b, t)
        const Q = is3 ? QuadraticBezierCurve3 : QuadraticBezierCurve
        return [new (Q as any)(c.v0, a, m), new (Q as any)(m, b, c.v2)]
    }
    // cubic
    const a = lerp(c.v0, c.v1, t), b = lerp(c.v1, c.v2, t), d = lerp(c.v2, c.v3, t)
    const e = lerp(a, b, t), f = lerp(b, d, t), m = lerp(e, f, t)
    const C = is3 ? CubicBezierCurve3 : CubicBezierCurve
    return [new (C as any)(c.v0, a, e, m), new (C as any)(m, f, d, c.v3)]
}

function newPath(is3: boolean): CurvePath<any> {
    return is3 ? new CurvePath3() : new CurvePath<Vector2>()
}

/** The first anchor of a line or a Bezier */
function startOf(part: Part): CurveVector {
    return part.kind === 'line' ? part.curve.v1 : part.curve.v0
}

/** The last anchor of a line or a Bezier */
function endOf(part: Part): CurveVector {
    return part.kind === 'cubic' ? part.curve.v3 : part.curve.v2
}

/**
 * Add a point in the middle of segment `segment` of {@link getCurveSegments}, and keep the shape of the curve: a line
 * or a Bezier is split in two at its middle (de Casteljau for Beziers), with the new point shared by both halves; a
 * spline gets a point on it. A curve that is not a path (a line, a Bezier) becomes a `CurvePath3` (`CurvePath` in 2D)
 * of the two halves.
 *
 * The curve is not changed: the result is a new curve (see {@link cloneCurve}), so the old one can be put back on
 * undo. `index` is the index of the new point in {@link getCurveEditPoints} of the new curve. Null when the segment
 * does not exist.
 */
export function addCurvePoint<T extends Curve<any>>(curve: T, segment: number): {curve: Curve<any>, index: number} | null {
    const next = cloneCurve(curve)
    const {parts} = analyze(next)
    const found = partOfSegment(parts, segment)
    if (!found) return null
    const {part, local} = found
    const c = part.curve
    let result: Curve<any> = next
    let added: CurveVector
    if (part.kind === 'spline') {
        added = c.getPoint(splineT(c, local))
        c.points.splice(local + 1, 0, added)
    } else {
        const halves = split(c, part.kind, 0.5)
        added = endOf({...part, curve: halves[0]})
        if (part.parent) part.parent.curves.splice(part.indexInParent, 1, ...halves)
        else {
            const path = newPath((startOf(part) as Vector3).isVector3 === true)
            path.curves.push(...halves)
            result = path
        }
    }
    updateCurveArcLengths(result)
    const index = getCurveEditPoints(result).findIndex(p => p.vecs.includes(added))
    return {curve: result, index}
}

/** The handle of a curve at its start (`atEnd` false) or end, as the control point of a cubic Bezier */
function cubicHandle(part: Part, atEnd: boolean): CurveVector {
    const c = part.curve
    if (part.kind === 'cubic') return (atEnd ? c.v2 : c.v1).clone()
    if (part.kind === 'quad') return lerp(atEnd ? c.v2 : c.v0, c.v1, 2 / 3) // degree elevation
    return (atEnd ? c.v2 : c.v1).clone() // a line: no handle
}

/** The fewest anchors a curve keeps when a point is removed */
const MIN_ANCHORS = 2

/**
 * Remove the point `index` of {@link getCurveEditPoints}, with the curve kept valid:
 * - a point of a spline is removed (a spline keeps 2 points, 3 when closed),
 * - an anchor between two curves of a path joins them in one curve: a line for two lines, else a cubic Bezier with
 *   the outer handles of both,
 * - the first or the last anchor of an open path removes its curve,
 * - a cubic Bezier handle goes back to its anchor (a corner); the control point of a quadratic Bezier goes to the
 *   middle of its anchors (a straight segment).
 *
 * A curve keeps at least 2 anchors. Like {@link addCurvePoint}, the result is a new curve and the curve is not
 * changed. Null when the point cannot be removed.
 */
export function removeCurvePoint<T extends Curve<any>>(curve: T, index: number): Curve<any> | null {
    const next = cloneCurve(curve)
    const {points, parts} = analyze(next)
    const p = points[index]
    if (!p) return null
    if (p.kind === 'control') {
        if (p.anchors.length === 1) {
            const a = points[p.anchors[0]].vec
            p.vecs.forEach(v => setVec(v, a))
        } else if (p.anchors.length === 2) {
            const m = lerp(points[p.anchors[0]].vec, points[p.anchors[1]].vec, 0.5)
            p.vecs.forEach(v => setVec(v, m))
        } else return null
        updateCurveArcLengths(next)
        return next
    }
    const anchors = points.filter(q => q.kind === 'anchor').length
    if (anchors <= MIN_ANCHORS) return null
    // the curves with this anchor at the end (before) and at the start (after); a closed path has both at its ends
    const simple = (q: Part) => q.kind === 'line' || q.kind === 'cubic' || q.kind === 'quad'
    const before = parts.find(q => simple(q) && q.anchorIdx[q.anchorIdx.length - 1] === index)
    const after = parts.find(q => simple(q) && q.anchorIdx[0] === index)
    const spline = parts.find(q => q.kind === 'spline' && q.anchorIdx.includes(index))
    if (parts.some(q => q.kind === 'other' && q.anchorIdx.includes(index))) return null
    if (spline) {
        // a point of a spline that is not a joint with another curve
        const c = spline.curve
        const i = spline.anchorIdx.indexOf(index)
        const isEnd = i === 0 || i === spline.anchorIdx.length - 1
        if (isEnd && parts.length > 1) return null
        if (c.points.length <= (c.closed ? 3 : 2)) return null
        c.points.splice(i, 1)
    } else if (before && after && before !== after) {
        if (before.parent !== after.parent || !before.parent) return null
        const path = before.parent
        const is3 = (startOf(before) as Vector3).isVector3 === true
        let joined: Curve<any>
        const a = startOf(before), b = endOf(after)
        if (before.kind === 'line' && after.kind === 'line') joined = is3 ? new LineCurve3(a as Vector3, b as Vector3) : new LineCurve(a as Vector2, b as Vector2)
        else {
            const C = is3 ? CubicBezierCurve3 : CubicBezierCurve
            joined = new (C as any)(a, cubicHandle(before, false), cubicHandle(after, true), b)
        }
        // `before` is the last curve and `after` the first one of a closed path: the joined curve goes last
        const bi = path.curves.indexOf(before.curve), ai = path.curves.indexOf(after.curve)
        if (ai === bi + 1) path.curves.splice(bi, 2, joined)
        else {
            path.curves.splice(bi, 1, joined)
            path.curves.splice(ai, 1)
        }
    } else {
        const only = before ?? after
        if (!only?.parent) return null
        only.parent.curves.splice(only.parent.curves.indexOf(only.curve), 1)
    }
    updateCurveArcLengths(next)
    return next
}
