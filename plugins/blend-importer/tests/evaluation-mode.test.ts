/**
 * Viewport or render evaluation of a modifier stack.
 *
 * Blender evaluates every stack in one of two modes, and the mode decides which modifiers run
 * (`mesh_data_update.cc:303`: `required_mode = use_render ? eModifierMode_Render : eModifierMode_Realtime`)
 * and which Subsurf level is used (`MOD_subsurf.cc:86`). Its exporters default to the viewport
 * (`IO_wavefront_obj.hh:53`). The importer used to mix the two: it ran modifiers by their render flag at
 * their render level - which for the 171 MB bugatti test car, authored Subsurf `levels: 0,
 * renderLevels: 2` on its densest parts, meant far more geometry than Blender itself shows interactively.
 */

import {describe, expect, it} from 'vitest'
import * as THREE from 'threepipe'
import {fixturePath, loadBlend} from './fixtures'
import {createMesh} from '../src/loader/mesh'
import type {BlendEvaluationMode} from '../src/loader/ctx'

const PREVIEW = fixturePath('blender-5.0.0-preview.blend')
const B282 = fixturePath('Blender-282.blend')

const ctxFor = (evaluationMode?: BlendEvaluationMode): any => ({
    Object3D: THREE.Object3D, Mesh: THREE.Mesh, BufferGeometry: THREE.BufferGeometry,
    BufferAttribute: THREE.BufferAttribute, MeshPhysicalMaterial: THREE.MeshPhysicalMaterial,
    MeshBasicMaterial: THREE.MeshBasicMaterial, evaluationMode,
})

// DNA_modifier_types.h
const eModifierMode_Realtime = 1 << 0, eModifierMode_Render = 1 << 1
const eModifierType_Subsurf = 1, eModifierType_Solidify = 33

function listToArray(lb: any): any[] {
    const out: any[] = []
    let n = lb && lb.first, g = 0
    while (n && g++ < 4096) { out.push(n); n = n.next }
    return out
}

async function object(file: string, name: string, type: number) {
    const blend = await loadBlend(file)
    const o = (blend.objects.Object ?? []).find((x: any) => x.id?.name === name)
    expect(o).toBeTruthy()
    const modifier = listToArray(o.modifiers).find((m: any) => m.modifier?.type === type)
    expect(modifier).toBeTruthy()
    return {o, modifier}
}

/** Build the object, and report whether its stack changed the base geometry. */
function build(o: any, mode?: BlendEvaluationMode) {
    const loaded = new WeakMap()
    const mesh: any = createMesh(o, loaded, ctxFor(mode))
    return {mesh, modified: mesh.geometry !== loaded.get(o.data)}
}

const triangles = (mesh: any) => (mesh.geometry.getIndex()?.count ?? 0) / 3

describe.skipIf(!B282)('which modifiers run', () => {
    it('a modifier shown only in the viewport runs by default, and not for render', async() => {
        const {o, modifier} = await object(B282!, 'OBcolumn.001', eModifierType_Solidify)
        expect(modifier.modifier.mode & eModifierMode_Realtime).toBeTruthy()
        expect(modifier.modifier.mode & eModifierMode_Render).toBeFalsy()

        expect(build(o).modified).toBe(true)
        expect(build(o, 'viewport').modified).toBe(true)
        expect(build(o, 'render').modified).toBe(false)
    })

    it('a modifier enabled only for render is skipped by default, and runs for render', async() => {
        const {o, modifier} = await object(B282!, 'OBarc.001', eModifierType_Solidify)
        expect(modifier.modifier.mode & eModifierMode_Realtime).toBeFalsy()
        expect(modifier.modifier.mode & eModifierMode_Render).toBeTruthy()

        expect(build(o).modified).toBe(false)
        expect(build(o, 'render').modified).toBe(true)
    })
})

describe.skipIf(!PREVIEW)('which Subsurf level is used', () => {
    it('the viewport level by default, the render level when asked', async() => {
        const {o, modifier} = await object(PREVIEW!, 'OBpreview_fluid_drops', eModifierType_Subsurf)
        expect(modifier.modifier.mode & (eModifierMode_Realtime | eModifierMode_Render))
            .toBe(eModifierMode_Realtime | eModifierMode_Render)
        expect(modifier.levels).toBe(1)
        expect(modifier.renderLevels).toBe(2)

        const viewport = build(o)
        const render = build(o, 'render')
        expect(viewport.modified).toBe(true)
        // One extra level quadruples the result.
        expect(triangles(render.mesh)).toBe(triangles(viewport.mesh) * 4)
        expect(triangles(build(o, 'viewport').mesh)).toBe(triangles(viewport.mesh))
    })

    it('a viewport level of 0 leaves the cage as it is', async() => {
        // No fixture has a viewport-enabled Subsurf at level 0, so take a real one and set its level -
        // the stack is evaluated from the DNA each time, so this is the same as authoring it that way.
        const {o, modifier} = await object(PREVIEW!, 'OBpreview_fluid_drops', eModifierType_Subsurf)
        const levels = modifier.levels
        modifier.levels = 0
        try {
            expect(build(o).modified).toBe(false)
            expect(build(o, 'render').modified).toBe(true)
        } finally {
            modifier.levels = levels
        }
    })
})
