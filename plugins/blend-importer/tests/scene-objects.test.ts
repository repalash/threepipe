/**
 * Which objects are imported: those Blender shows in the active scene, with collection instances expanded.
 *
 * `collection-instances-5.3.blend` (made with Blender 5.3): a Ground cube in the scene, and a collection
 * "Asset" linked to no scene (instance offset (1, 2, 0.5), a parented object and a child collection) placed by
 * two empties, one rotated and scaled. Blender draws 7 meshes: Ground and two copies of the 3 asset meshes.
 * It used to import 4: Ground, and the asset's own 3 at their source position, as a stray copy.
 */
import {describe, expect, it} from 'vitest'
import * as THREE from 'threepipe'
import {fixturePath, loadBlend} from './fixtures'
import {createObjects} from '../src/loader'
import {createCtx} from '../src/loader/ctx'

const FILE = fixturePath('collection-instances-5.3.blend')

async function meshes(allObjects = false) {
    const blend = await loadBlend(FILE!)
    const roots = await createObjects(blend, createCtx(THREE, {allObjects} as any))
    const root = new THREE.Object3D()
    root.add(...roots)
    root.updateMatrixWorld(true)
    const out: {name: string, at: number[]}[] = []
    root.traverse((o: any) => {
        if (!o.isMesh) return
        const v = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
        out.push({name: o.name, at: [v.x, -v.z, v.y].map(x => Math.round(x * 1000) / 1000 + 0)}) // back to Blender's Z-up
    })
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.at[0] - b.at[0])
}

describe.skipIf(!FILE)('scene objects and collection instances', () => {
    it('imports what Blender draws, at Blender\'s positions', async() => {
        // positions from Blender's depsgraph (`object_instances[].matrix_world.translation`)
        expect(await meshes()).toEqual([
            {name: 'AssetBase', at: [-4, 3, 1]},
            {name: 'AssetBase', at: [5, 0, 0]},
            {name: 'AssetSide', at: [-2.913, 5.796, 1]},
            {name: 'AssetSide', at: [7, 0, 0]},
            {name: 'AssetTop', at: [-3.587, 2.839, 2.433]},
            {name: 'AssetTop', at: [5, 0, 1]},
            {name: 'Ground', at: [0, 0, -1]},
        ])
    })

    it('imports the collection\'s own objects too with allObjects', async() => {
        const names = (await meshes(true)).map(m => m.name)
        expect(names.filter(n => n === 'AssetBase')).toHaveLength(3) // the source and the two copies
    })
})

// `hidden-5.3.blend` (Blender 5.3): one object per way of hiding it. Blender's viewport shows Shown,
// ObjHideRender and InCollHideRender; its renderer also shows ObjHideViewport and InCollHideViewport, and the
// eye icons (InCollEye, ObjEye) hide only in the viewport. CollExcluded is excluded in the view layer: never.
const HIDDEN = fixturePath('hidden-5.3.blend')

describe.skipIf(!HIDDEN)('what Blender hides', () => {
    const names = async(evaluationMode: 'viewport' | 'render') => {
        const roots = await createObjects(await loadBlend(HIDDEN!), createCtx(THREE, {evaluationMode} as any))
        const out: string[] = []
        for (const r of roots) r.traverse((o: any) => o.isMesh && out.push(o.name))
        return out.sort()
    }
    it('in the viewport', async() => {
        expect(await names('viewport')).toEqual(['InCollHideRender', 'ObjHideRender', 'Shown'])
    })
    it('in renders', async() => {
        expect(await names('render')).toEqual(['InCollEye', 'InCollHideViewport', 'ObjEye', 'ObjHideViewport', 'Shown'])
    })
})
