/**
 * Our own parity cases (`tests/parity/cases/<set>.ts`, written with the DSL) against Blender 5.2.2.
 * `tests/parity/cases/<set>.json` is the committed case list Blender evaluates (queue
 * `run_cases.py <set>.json tmp/gt-5.2.2/cases/<set>` on the Blender worker); this test fails when it is out of
 * date with the generator (`UPDATE_PARITY_CASES=1 npm run test -- tests/parity/cases` rewrites it).
 * Blender's results are read from `tests/parity/cases/<set>.gt/` when committed, else from
 * `<worktree>/tmp/gt-5.2.2/cases/<set>/`; cases without a result are skipped with that reason.
 */
import {describe, expect, it} from 'vitest'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {compareGeometry, ExpectedGeometry, GeometryNodesEvaluator} from '../../src'
import {binResolver, DumpReferenced, geometryFromDump, inlineBinRefs, sceneFromDump} from '../../src/io/geometryFromDump'
import type {EvalOptions, SceneProvider} from '../../src/runtime/context'
import {CaseImage, ParityCase} from './cases/types'
import {imageTextureCases} from './cases/imageTexture'
import {zoneCases} from './cases/zones'
import {proximityCases} from './cases/proximity'
import {raycastCases} from './cases/raycast'
import {demoCases} from './cases/demos'
import {curveSetterCases} from './cases/curveSetters'
import {fieldNodeCases} from './cases/fieldNodes'
import {topologyCases} from './cases/topology'
import {inputCases} from './cases/inputs'
import {geometryOpCases} from './cases/geometryOps'
import {materialOpCases} from './cases/materialOps'
import {functionMathCases} from './cases/functionMath'
import {functionRandomCases} from './cases/functionRandom'
import {functionRotationCases} from './cases/functionRotation'
import {functionCurvesCases} from './cases/functionCurves'
import {functionSwitchCases} from './cases/functionSwitch'
import {textureCases} from './cases/textures'
import {instanceCases} from './cases/instances'
import {geometryCases} from './cases/geometry'
import {sceneCases} from './cases/scene'
import {meshInputCases} from './cases/meshInputs'
import {meshAttributeCases} from './cases/meshAttribute'
import {meshSampleCases} from './cases/meshSample'
import {meshMaterialCases} from './cases/meshMaterial'
import {meshEditCases} from './cases/meshEdit'
import {meshPrimitiveCases} from './cases/meshPrimitive'
import {meshMergeCases} from './cases/meshMerge'
import {curvesBasicCases} from './cases/curvesBasic'
import {curvesOpsCases} from './cases/curvesOps'
import {distributeCases} from './cases/distribute'
import {subdivMeshCases} from './cases/subdivMesh'

/** The case's images over the scene Blender built: the pixels Blender's float buffer holds (`foreach_set`). */
function withCaseImages(scene: SceneProvider | undefined, images: CaseImage[]): SceneProvider {
    const byName = new Map(images.map(i => [i.name, {width: i.width, height: i.height, pixels: Float32Array.from(i.pixels), alphaMode: i.alphaMode, isData: i.isData}]))
    return {...scene, image: name => byName.get(name) ?? scene?.image?.(name)}
}

const SETS: Record<string, () => ParityCase[]> = {textures: textureCases, instances: instanceCases, geometry: geometryCases, scene: sceneCases, distribute: distributeCases}
SETS.functionMath = functionMathCases
SETS.functionRandom = functionRandomCases
SETS.functionRotation = functionRotationCases
SETS.functionCurves = functionCurvesCases
SETS.functionSwitch = functionSwitchCases
SETS.meshInputs = meshInputCases
SETS.meshAttribute = meshAttributeCases
SETS.meshSample = meshSampleCases
SETS.meshMaterial = meshMaterialCases
SETS.imageTexture = imageTextureCases
SETS.zones = zoneCases
SETS.proximity = proximityCases
SETS.raycast = raycastCases
SETS.demos = demoCases
SETS.curveSetters = curveSetterCases
SETS.fieldNodes = fieldNodeCases
SETS.topology = topologyCases
SETS.inputs = inputCases
SETS.geometryOps = geometryOpCases
SETS.materialOps = materialOpCases
SETS.meshEdit = meshEditCases
SETS.meshPrimitive = meshPrimitiveCases
SETS.meshMerge = meshMergeCases
SETS.curvesBasic = curvesBasicCases
SETS.curvesOps = curvesOpsCases
SETS.subdivMesh = subdivMeshCases

for (const [set, generate] of Object.entries(SETS)) {
    describe(`parity cases: ${set}`, () => {
        const cases = generate()
        const file = join(__dirname, 'cases', `${set}.json`)
        // One case per line: compact, and diffs stay per case.
        const text = '[\n' + cases.map(c => JSON.stringify(c)).join(',\n') + '\n]\n'
        it('the committed case list matches the generator', () => {
            if (process.env.UPDATE_PARITY_CASES) writeFileSync(file, text)
            expect(existsSync(file) && readFileSync(file, 'utf8') === text, `${set}.json is out of date`).toBe(true)
        })
        const dirs = [join(__dirname, 'cases', `${set}.gt`), join(__dirname, '../../../../tmp/gt-5.2.2/cases', set)]
        const status: Record<string, string> = {}
        for (const c of cases) {
            const dir = dirs.find(d => existsSync(join(d, `${c.id}.json`)))
            if (!dir) {
                status[c.id] = 'no Blender result'
                it.skip(`${c.id} (no Blender result yet)`, () => undefined)
                continue
            }
            it(c.id, () => {
                const gt = JSON.parse(readFileSync(join(dir, `${c.id}.json`), 'utf8')) as {geometry?: ExpectedGeometry, error?: string, scene?: DumpReferenced, input?: ExpectedGeometry}
                if (gt.error) throw new Error(`Blender failed on this case: ${gt.error}`)
                const bin = join(dir, `${c.id}.bin`)
                const resolver = binResolver(existsSync(bin) ? {[`${c.id}.bin`]: readFileSync(bin)} : {})
                const expected = inlineBinRefs(gt.geometry!, resolver)
                // The case's object is named after the case (`run_cases.py`); Object/Collection Info read the scene Blender built.
                const options: EvalOptions = gt.scene ? {scene: sceneFromDump(gt.scene, resolver), selfObject: c.id} : {}
                if (c.images) options.scene = withCaseImages(options.scene, c.images)
                // The modifier's input: the mesh Blender built for the case object (`input`), or nothing.
                const evaluate = () => {
                    const ev = new GeometryNodesEvaluator(c.library, c.group, options)
                    if (c.input !== 'empty' && gt.input) ev.setInputGeometry(geometryFromDump(gt.input, resolver))
                    // The modifier's input values, by interface socket name (`run_cases.py` sets them the same way).
                    for (const [k, v] of Object.entries(c.inputs ?? {})) ev.setInput(k, v)
                    return ev.evaluate()
                }
                let diffs: string[]
                try {
                    const out = evaluate()
                    diffs = compareGeometry(out.geometry!, expected, {byteColor: 'srgb'})
                } catch (e) {
                    diffs = [`error: ${(e as Error).message}`]
                }
                if (c.blocked) {
                    status[c.id] = `blocked: ${c.blocked}`
                    expect(diffs.length === 1 && /^error: .*not ported/.test(diffs[0]), `${c.description}: expected the 'not ported' error (${c.blocked}), got ${diffs.join(' | ') || 'a result'}`).toBe(true)
                    return
                }
                if (c.blenderBug) {
                    // Blender's result is a Blender bug: the port computes the intended values, so it must differ.
                    status[c.id] = `blender-bug: ${c.blenderBug}`
                    expect(diffs.filter(d => !d.startsWith('error:')), `${c.description}: expected to differ from Blender (${c.blenderBug})`).not.toEqual([])
                    expect(diffs.filter(d => d.startsWith('error:'))).toEqual([])
                    return
                }
                // Float32 policy: record whether the case is bit-exact, not only within the 1e-5 tolerance.
                if (!diffs.length) {
                    const actual = evaluate().geometry!
                    const ulps = [0, 1, 2, 4, 16].find(u => !compareGeometry(actual, expected, {byteColor: 'srgb', ulps: u}).length)
                    status[c.id] = ulps === 0 ? 'exact' : `pass (${ulps === undefined ? '> 16' : `<= ${ulps}`} ulp)`
                } else {
                    status[c.id] = diffs.slice(0, 3).join(' | ')
                }
                expect(diffs, c.description).toEqual([])
            })
        }
        it('writes the status file', () => {
            writeFileSync(join(__dirname, 'cases', `${set}.status.json`), JSON.stringify(status, null, 1) + '\n')
        })
    })
}
