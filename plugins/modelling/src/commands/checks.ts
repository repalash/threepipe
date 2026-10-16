/**
 * Measured checks: `validate` and `diff`, and the `locality` report every mutating command carries.
 *
 * The order an agent should work in is build, measure, validate, then look - a render is the last
 * check, not the first (3DCodeBench, CADTests, WorldBench all point the same way). These commands are
 * the middle of that list. The geometry work is in `@threepipe/mesh-kernel` (`bmMeshIsValid`, a port of
 * Blender's `BM_mesh_is_valid`; `diffMeshData`; `verifySpec`), so the same functions are importable by
 * a script that never touches the command layer.
 */

import {
    bakeGeometry,
    bmFromMesh,
    bmMeshIsValid,
    diffMeshData,
    DiffSelection,
    measureMesh,
    MeshData,
    MeshDiff,
    MeshSpec,
    verifySpec,
} from '@threepipe/mesh-kernel'
import {CommandDefinition, CommandContext, S, schema, Command} from './types'
import {readIntList, readTargets} from './params'
import {EntrySnapshot, ModellingDocument, ModellingEntry} from '../document'
import {evaluateModifiers} from '../modifiers'

type Verdict = 'PASS' | 'FAIL' | 'UNVERIFIED'

interface Check {
    id: string
    verdict: Verdict
    evidence: 'structural' | 'measured' | 'derived' | 'unverified'
    /** Where the check comes from. */
    source: string
    errors?: string[]
    note?: string
}

function combine(verdicts: Verdict[]): Verdict {
    if (verdicts.includes('FAIL')) return 'FAIL'
    if (verdicts.includes('UNVERIFIED')) return 'UNVERIFIED'
    return 'PASS'
}

/** The structural checks on one mesh: arrays first, then Blender's BMesh validator on top of them. */
export function structuralChecks(mesh: MeshData, prefix = ''): Check[] {
    const checks: Check[] = []
    const structure = mesh.validate()
    checks.push({
        id: prefix + 'structure', verdict: structure.length ? 'FAIL' : 'PASS', evidence: 'structural',
        source: 'MeshData.validate - array sizes, offsets, index ranges, corner/edge agreement',
        errors: structure.length ? structure.slice(0, 20) : undefined,
    })
    if (structure.length) {
        checks.push({
            id: prefix + 'bmesh', verdict: 'UNVERIFIED', evidence: 'unverified',
            source: 'bmesh_mesh_validate.cc:63 BM_mesh_is_valid',
            note: 'a BMesh cannot be built from arrays that fail the structure check',
        })
    } else {
        const errors = bmMeshIsValid(bmFromMesh(mesh))
        checks.push({
            id: prefix + 'bmesh', verdict: errors.length ? 'FAIL' : 'PASS', evidence: 'structural',
            source: 'bmesh_mesh_validate.cc:63 BM_mesh_is_valid - hidden+selected, duplicate edges and faces, '
                + 'repeated loops/verts/edges in a face, loop and radial links',
            errors: errors.length ? errors.slice(0, 20) : undefined,
        })
    }
    try {
        bakeGeometry(mesh, {includeNormals: true})
        checks.push({id: prefix + 'bake', verdict: 'PASS', evidence: 'structural', source: 'bakeGeometry - tessellates and bakes'})
    } catch (e) {
        checks.push({id: prefix + 'bake', verdict: 'FAIL', evidence: 'structural', source: 'bakeGeometry',
            errors: [(e as Error).message]})
    }
    return checks
}

/** The mesh at a point in history, for a baseline. */
export function meshAt(ctx: CommandContext, entry: ModellingEntry, at: string, evaluated: boolean): MeshData | null {
    const snap = ctx.plugin.history.snapshotAt(at, entry.id)
    if (snap === 'current') return evaluated ? entry.evaluated : entry.mesh
    if (!snap.mesh) return null
    return evaluated ? evaluateModifiers(snap.mesh, snap.modifiers) : snap.mesh
}

export const validateCommand: CommandDefinition = {
    op: 'validate',
    summary: 'Check objects for invalid topology (a port of Blender\'s BM_mesh_is_valid) and, with `spec`, '
        + 'against written requirements. Every check is PASS, FAIL or UNVERIFIED.',
    description:
        'Without `spec`: per object, the array-level structure check, Blender\'s `BM_mesh_is_valid` '
        + '(`bmesh_mesh_validate.cc`), and a render bake - on the master mesh, and on the evaluated mesh '
        + 'when a modifier stack is present. Topology facts (closed, winding, Euler characteristic, '
        + 'holes) come back as `measure`, not as verdicts: an open mesh is not an invalid one.\n\n'
        + 'With `spec`: `verifySpec` - `bbox {size|min|max: [x, y, z]}` (world space), `counts`, `volume`, '
        + '`area`, `manifold {closed, orientable}`, `valid`, `genus`, `boundaryLoops`, `components`, '
        + '`attributeLayers`, `materialSlots`, and `unchanged: [group]` with `groups: {name: {faces, verts}}` '
        + 'checked against the mesh at `against` (a checkpoint, `start` or `previous`). Numbers are exact '
        + '(within `tolerance`, default 1e-4), `[min, max]` or `{min, max}`. Each requirement is tagged '
        + 'with its evidence: measured, structural, derived or unverified. `conforms` is true only when '
        + 'nothing failed, nothing was unverified, and something was checked - an empty spec does not pass.',
    mutates: false,
    schema: schema({
        object: S.objectRef('Objects to check. Default every object.'),
        objects: S.objectRef('Alias for `object`.'),
        spec: {type: 'object', description: 'Requirements to verify; see the description for the keys.'},
        against: S.string('Baseline for `spec.unchanged`: a checkpoint name, `start` or `previous`.'),
        mesh: S.enum('`evaluated` (default: what is drawn, through the modifier stack) or `master` (what indices address).',
            ['evaluated', 'master']),
        space: S.enum('Space for `bbox`, `area`, `volume`: `world` (default) or `local`.', ['world', 'local']),
    }),

    run(p: Record<string, unknown>, ctx) {
        const targets = readTargets(p, ctx.doc, false)
        const entries = targets.length ? targets : ctx.doc.entries
        const useEvaluated = (p.mesh as string | undefined) !== 'master'
        const spec = p.spec as MeshSpec | undefined
        const objects = entries.map(entry => {
            const checks = structuralChecks(entry.mesh)
            if (entry.modifiers.length) checks.push(...structuralChecks(entry.evaluated, 'evaluated.'))
            const mesh = useEvaluated ? entry.evaluated : entry.mesh
            entry.object.updateWorldMatrix(true, false)
            const matrix = p.space === 'local' ? null : entry.object.matrixWorld.elements
            const measured = measureMesh(mesh, {matrix})
            const out: Record<string, unknown> = {
                name: entry.name,
                verdict: combine(checks.map(c => c.verdict)),
                checks,
                measure: summariseMeasure(measured),
            }
            if (spec) {
                if (spec.unchanged?.length && p.against === undefined) {
                    ctx.warn('`spec.unchanged` needs `against` (a checkpoint, `start` or `previous`) - those requirements are UNVERIFIED')
                }
                const baseline = p.against !== undefined ? meshAt(ctx, entry, p.against as string, useEvaluated) : null
                const r = verifySpec(mesh, spec, {matrix, baseline})
                out.spec = {conforms: r.conforms, passed: r.passed, failed: r.failed, unverified: r.unverified, results: r.results}
                out.verdict = combine([out.verdict as Verdict,
                    r.failed ? 'FAIL' : r.unverified || !r.passed ? 'UNVERIFIED' : 'PASS'])
            }
            return out
        })
        const verdicts = objects.map(o => o.verdict as Verdict)
        if (!objects.length) ctx.warn('the document is empty - nothing was checked')
        return {
            objects: entries.map(e => e.name),
            data: {
                verdict: objects.length ? combine(verdicts) : 'UNVERIFIED',
                conforms: objects.length > 0 && verdicts.every(v => v === 'PASS'),
                mesh: useEvaluated ? 'evaluated' : 'master',
                objects,
            },
        }
    },
}

function round(n: number): number {
    return Math.round(n * 1e5) / 1e5
}

export function summariseMeasure(m: ReturnType<typeof measureMesh>) {
    return {
        verts: m.verts, edges: m.edges, faces: m.faces, tris: m.tris,
        bounds: m.bounds && {min: m.bounds.min.map(round), max: m.bounds.max.map(round), size: m.bounds.size.map(round)},
        area: round(m.area), volume: round(m.volume),
        closed: m.closed, consistentWinding: m.consistentWinding, edgeUse: m.edgeUse, looseVerts: m.looseVerts,
        eulerCharacteristic: m.eulerCharacteristic, components: m.components, boundaryLoops: m.boundaryLoops,
        genus: m.genus, attributeLayers: m.attributeLayers, materialSlots: m.materialSlots,
    }
}

// region diff

/**
 * What a command said it would change in one object's mesh: its `verts` / `edges` / `faces`
 * parameters as indices into the mesh before it ran, or `'all'` when it named the object only.
 */
export function claimOf(params: Record<string, unknown>): DiffSelection | 'all' {
    const sel: DiffSelection = {}
    let any = false
    for (const key of ['verts', 'edges', 'faces'] as const) {
        const value = params[key]
        if (value === undefined) continue
        try {
            sel[key] = readIntList(value, key)
        } catch {
            // `vertices {verts: [[index, x, y, z]]}` and `{id, position}` entries
            if (!Array.isArray(value)) return 'all'
            const ids: number[] = []
            for (const v of value) {
                const id = Array.isArray(v) ? v[0] : v && typeof v === 'object' ? (v as {id?: unknown, index?: unknown}).id ?? (v as {index?: unknown}).index : undefined
                if (!Number.isInteger(id)) return 'all'
                ids.push(id as number)
            }
            sel[key] = ids
        }
        any = true
    }
    return any ? sel : 'all'
}

/** A diff, trimmed to what an agent reads: counts, collateral, and the layers that moved. */
export function summariseDiff(d: MeshDiff) {
    return {
        local: d.local,
        identical: d.identical,
        claimed: d.claimed,
        verts: d.verts, edges: d.edges, faces: d.faces,
        collateral: d.collateral,
        layers: d.layers.filter(l => l.status !== 'unchanged'),
    }
}

export const diffCommand: CommandDefinition = {
    op: 'diff',
    summary: 'What changed in an object since a checkpoint (or between two objects), split into claimed and collateral.',
    description:
        'Elements are matched by geometry, not index, so a renumbering is not a change - it is reported '
        + 'separately as `renumbered`, which tells you indices from an earlier `inspect` are stale. '
        + '`claim: {verts, edges, faces}` (indices into the *earlier* mesh) says what you meant to change; '
        + 'faces touching it are claimed too, and anything else that changed is `collateral`. Without '
        + '`claim` the whole object is claimed. Attribute layers (UVs, sharp flags, material indices, '
        + 'custom data) are compared on the elements that survived, and a removed layer is never local.\n\n'
        + '`from` is a checkpoint name, `start` or `previous` (before the last command). `other` compares '
        + 'with a second object instead. Every mutating command already reports this for its own edit as '
        + '`locality`, so `diff` is for spans of several commands.',
    mutates: false,
    schema: schema({
        object: S.string('The object to compare.'),
        from: S.string('Baseline: a checkpoint name, `start`, or `previous`. Default `previous`.'),
        other: S.string('Compare against this object instead of a point in history.'),
        claim: {type: 'object', description: '`{verts?, edges?, faces?}` - what you meant to change, as indices into the baseline.'},
        mesh: S.enum('`master` (default: what indices address) or `evaluated`.', ['master', 'evaluated']),
    }, ['object']),

    run(p: Record<string, unknown>, ctx) {
        const entry = ctx.doc.require(p.object as string)
        const evaluated = p.mesh === 'evaluated'
        let before: MeshData | null
        let label: string
        if (p.other !== undefined) {
            const other = ctx.doc.require(p.other as string)
            before = evaluated ? other.evaluated : other.mesh
            label = `object ${other.name}`
        } else {
            const at = (p.from as string | undefined) ?? 'previous'
            before = meshAt(ctx, entry, at, evaluated)
            label = at
        }
        const after = evaluated ? entry.evaluated : entry.mesh
        if (!before) {
            return {objects: [entry.name], data: {object: entry.name, from: label, created: true,
                note: `"${entry.name}" did not exist at ${label}`}}
        }
        const claim = p.claim === undefined ? 'all' : claimOf(p.claim as Record<string, unknown>)
        const d = diffMeshData(before, after, {claim})
        return {objects: [entry.name], data: {object: entry.name, from: label, ...summariseDiff(d)}}
    },
}

// endregion

// region locality

/** The object references a command names, resolved before it runs. */
export function targetIds(command: Command, doc: ModellingDocument): string[] {
    const ref = (command.objects ?? command.object) as string | string[] | undefined
    if (ref === undefined) return []
    try {
        return doc.resolve(ref).map(e => e.id)
    } catch {
        return []
    }
}

function sameState(snap: EntrySnapshot, entry: ModellingEntry): boolean {
    const o = entry.object
    const eq = (a: number[], b: number[]) => a.every((v, i) => v === b[i])
    const mat = o.material as {color?: {getHexString(): string}} | undefined
    return snap.name === entry.name
        && eq(snap.position, o.position.toArray()) && eq(snap.rotation, [o.rotation.x, o.rotation.y, o.rotation.z])
        && eq(snap.scale, o.scale.toArray()) && snap.visible === o.visible
        && (snap.materialColor ?? null) === (mat?.color ? '#' + mat.color.getHexString() : null)
        && JSON.stringify(snap.modifiers) === JSON.stringify(entry.modifiers)
}

export interface Locality {
    /** Nothing outside what the command named, and nothing outside its selection within those, changed. */
    local: boolean
    objects: {claimed: string[], created: string[], deleted: string[], changed: string[], collateral: string[]}
    /** Per changed mesh: counts, collateral elements, changed layers. */
    meshes: Record<string, ReturnType<typeof summariseDiff>>
}

/**
 * What a finished command changed, from the before-states the document recorded for undo - so this
 * costs one geometric diff per touched object and no extra snapshot.
 */
export function computeLocality(
    command: Command, before: EntrySnapshot[], doc: ModellingDocument, targets: string[],
): Locality {
    const claimedIds = new Set(targets)
    const objects: Locality['objects'] = {claimed: [], created: [], deleted: [], changed: [], collateral: []}
    const meshes: Locality['meshes'] = {}
    let local = true
    const claim = claimOf(command as Record<string, unknown>)
    for (const snap of before) {
        const entry = doc.find(snap.id)
        if (!snap.mesh) {
            if (entry) objects.created.push(entry.name)
            continue
        }
        const claimed = claimedIds.has(snap.id)
        if (claimed) objects.claimed.push(snap.name)
        if (!entry) {
            objects.deleted.push(snap.name)
            if (!claimed) {
                objects.collateral.push(snap.name)
                local = false
            }
            continue
        }
        const d = diffMeshData(snap.mesh, entry.mesh, {claim: claimed ? claim : 'none'})
        const changed = !d.identical || !sameState(snap, entry)
        if (!changed) continue
        objects.changed.push(entry.name)
        if (!d.identical) meshes[entry.name] = summariseDiff(d)
        if (!claimed) {
            objects.collateral.push(entry.name)
            local = false
        } else if (!d.local) local = false
    }
    return {local, objects, meshes}
}

// endregion

export const checkCommands = [validateCommand, diffCommand]
