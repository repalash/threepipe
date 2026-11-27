/**
 * Picking a scene by name, background scenes, color management, and light intensities.
 *
 * `scenes-lights-5.3.blend` (made with Blender 5.3, `bpy`): scenes "Main" (open when saved; a cube and four
 * lights; its Background Scene is "Backdrop"), "Other" (a sphere and a point light) and "Backdrop" (a cone).
 * Main's color management: AgX, look "AgX - Punchy", exposure 1.5; Other's: Standard, exposure -0.5.
 * Main's lights: AreaNorm (square 2 m, 100 W, normalized), AreaUnnorm (ellipse 2 x 0.5 m, object scale 2 x 3,
 * 100 W, "Normalize" unticked), PointUnnorm (radius 0.5 m, 100 W, unticked), SunUnnorm (3 W/m², angle 10°,
 * unticked). Blender stores each light's power twice: `energy_new` (what it renders) and `energy` for older
 * versions (exposure applied, area lights / (π/4)).
 *
 * The expected intensities are the ones Blender's renders show: measured with Cycles in Blender 5.3 (Standard,
 * exposure 0) on a white diffuse plane 2 m under each light, a point or spot light of P watts gives the radiance
 * of intensity P / 4π, a sun of S the irradiance S, a small normalized area light P / π straight ahead, and an
 * unticked "Normalize" multiplies the power by the area of BKE_light_area.
 */
import {describe, expect, it, vi} from 'vitest'
import * as THREE from 'threepipe'
import {fixturePath, loadBlend} from './fixtures'
import {createObjects} from '../src/loader'
import {createCtx} from '../src/loader/ctx'
import {blendScenes, blendViewSettings} from '../src/loader/scene'
import {jpegComponents} from '../src/loader/material'

const FILE = fixturePath('scenes-lights-5.3.blend')

async function load(file: string, options: any = {}) {
    const blend = await loadBlend(file)
    const roots = await createObjects(blend, createCtx(THREE, options))
    const byName = new Map<string, any>()
    for (const r of roots) r.traverse((o: any) => o.name && byName.set(o.name, o))
    return {blend, byName, meshes: [...byName.values()].filter(o => o.isMesh).map(o => o.name).sort()}
}

describe.skipIf(!FILE)('scenes', () => {
    it('lists the scenes, and which is open', async() => {
        expect(blendScenes(await loadBlend(FILE!))).toEqual([
            {name: 'Backdrop', active: false},
            {name: 'Main', active: true, backgroundScene: 'Backdrop'},
            {name: 'Other', active: false},
        ])
    })

    it('imports the open scene with its background scene', async() => {
        const {meshes, byName} = await load(FILE!)
        expect(meshes).toEqual(['BackdropCone', 'MainCube'])
        expect(byName.has('OtherPoint')).toBe(false)
    })

    it('imports the scene named in `scene`', async() => {
        const {meshes, byName} = await load(FILE!, {scene: 'Other'})
        expect(meshes).toEqual(['OtherSphere'])
        expect(byName.has('OtherPoint')).toBe(true)
        expect(byName.has('AreaNorm')).toBe(false)
    })

    it('warns about a scene the file doesn\'t have, and imports the open one', async() => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const {meshes} = await load(FILE!, {scene: 'Nope'})
        expect(warn.mock.calls.some(c => String(c[0]).includes('no scene "Nope"') && String(c[0]).includes('"Other"'))).toBe(true)
        warn.mockRestore()
        expect(meshes).toEqual(['BackdropCone', 'MainCube'])
    })

    it('reads each scene\'s color management', async() => {
        const blend = await loadBlend(FILE!)
        expect(blendViewSettings(blend)).toEqual({
            viewTransform: 'AgX', look: 'AgX - Punchy', exposure: 1.5, gamma: 1,
            toneMapping: 'AgXToneMapping', toneMappingExposure: 2 ** 1.5,
        })
        expect(blendViewSettings(blend, 'Other')).toMatchObject({viewTransform: 'Standard', exposure: -0.5, toneMapping: 'LinearToneMapping', toneMappingExposure: 2 ** -0.5})
    })
})

describe.skipIf(!FILE)('lights, Blender 5.3', () => {
    it('are as bright as in Blender\'s renders', async() => {
        const {byName} = await load(FILE!)
        const area = byName.get('AreaNorm')
        expect(area.isSpotLight).toBe(true)
        expect(area.intensity).toBeCloseTo(100 / Math.PI, 4)
        expect(area.angle).toBeCloseTo(Math.PI / 2)
        expect(area.penumbra).toBe(1)
        // power x area: (2 x 2) x (0.5 x 3) m, an ellipse (x π/4)
        expect(byName.get('AreaUnnorm').intensity).toBeCloseTo(100 * 6 * Math.PI / 4 / Math.PI, 3)
        // power x sphere area 4π r²
        expect(byName.get('PointUnnorm').intensity).toBeCloseTo(100 * 4 * Math.PI * 0.25 / (4 * Math.PI), 4)
        // strength x sun disk area π sin²(angle / 2)
        expect(byName.get('SunUnnorm').intensity).toBeCloseTo(3 * Math.PI * Math.sin(5 * Math.PI / 180) ** 2, 5)
    })

    it('are x 683 with lightUnits: photometric', async() => {
        const {byName} = await load(FILE!, {lightUnits: 'photometric', scene: 'Other'})
        expect(byName.get('OtherPoint').intensity).toBeCloseTo(50 / (4 * Math.PI) * 683, 2)
    })
})

// Blender's Mr Elephant demo (2.93): lights saved before Blender 4.0, area lights on the older scale.
const ELEPHANT = fixturePath('mr_elephant.blend')

describe.skipIf(!ELEPHANT)('lights, Blender 2.93 (Mr Elephant)', () => {
    it('are as bright as in Blender\'s renders', async() => {
        const {byName} = await load(ELEPHANT!)
        expect(byName.get('Point').intensity).toBeCloseTo(400 / (4 * Math.PI), 3)
        expect(byName.get('Lamp.001').intensity).toBeCloseTo(4000 / (4 * Math.PI), 2) // a spot
        // an area light of 3000 W, 3.3 m: Blender 4.0+ opens it as 3000 x π/4 W; not scaled by its area
        const area = byName.get('Spot.001')
        expect(area.isSpotLight).toBe(true)
        expect(area.intensity).toBeCloseTo(3000 * Math.PI / 4 / Math.PI, 2)
    })

    it('finds the CMYK JPEGs, which WebKit can\'t upload as they are', async() => {
        const blend: any = await loadBlend(ELEPHANT!)
        const cmyk: string[] = []
        let jpegs = 0
        for (const img of blend.objects.Image ?? []) {
            const pf = img.packedfile
            if (!pf?.data || !(pf.size > 0)) continue
            const bytes = new Uint8Array(pf.data.__blender_file__.byte.buffer, pf.data.__data_address__, pf.size)
            if (bytes[0] !== 0xff || bytes[1] !== 0xd8) continue
            jpegs++
            const n = jpegComponents(bytes)
            expect([1, 3, 4]).toContain(n)
            if (n === 4) cmyk.push(img.aname)
        }
        expect(jpegs).toBeGreaterThan(10)
        expect(cmyk.sort()).toMatchInlineSnapshot(`
          [
            "a9ccea0fd3c8c40c89dca349b7b87fe7.jpg.001",
            "frost.jpg",
          ]
        `)
    })
})
