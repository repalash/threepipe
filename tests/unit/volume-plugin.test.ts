import {describe, expect, test} from 'vitest'
import {Data3DTexture, DataTexture, DataUtils, DirectionalLight, FloatType, HalfFloatType, LinearFilter, NearestFilter, PointLight, Scene, UnsignedByteType, Vector3} from 'three'
import {NRRDLoader} from 'three/examples/jsm/loaders/NRRDLoader.js'
import {TransferFunction} from '../../plugins/volume/src/TransferFunction'
import {VolumeData} from '../../plugins/volume/src/VolumeData'
import {VolumeMaterial} from '../../plugins/volume/src/VolumeMaterial'
import {VolumeObject} from '../../plugins/volume/src/VolumeObject'
import {colorMaps, volumePresets, volViewPresets} from '../../plugins/volume/src/library'
import {DerivedField, DerivedFieldPass} from '../../plugins/volume/src/derived/DerivedField'
import {LightVolume} from '../../plugins/volume/src/derived/LightVolume'
import {findShadowLight} from '../../plugins/volume/src/lighting'

describe('TransferFunction', () => {
    test('interpolates between points and clamps outside them', () => {
        const tf = new TransferFunction([[0.25, 0, 0, 0], [0.75, 1, 0.5, 0]], [[0, 0], [1, 1]])
        expect(tf.evaluate(0)).toEqual([0, 0, 0, 0])
        expect(tf.evaluate(0.5)).toEqual([0.5, 0.25, 0, 0.5])
        expect(tf.evaluate(1)).toEqual([1, 0.5, 0, 1])
    })

    test('bakes into an RGBA byte array', () => {
        const tf = new TransferFunction([[0, 0, 0, 0], [1, 1, 1, 1]], [[0, 0], [1, 1]])
        const data = new Uint8Array(3 * 4)
        tf.bake(data)
        expect(Array.from(data)).toEqual([0, 0, 0, 0, 128, 128, 128, 128, 255, 255, 255, 255])
    })

    test('sorts unsorted points', () => {
        const tf = new TransferFunction([[1, 1, 1, 1], [0, 0, 0, 0]], [[1, 1], [0, 0]])
        expect(tf.evaluate(0.5)).toEqual([0.5, 0.5, 0.5, 0.5])
    })

    test('an absolute preset is normalized to 0..1 and returns its range in data units', () => {
        const tf = new TransferFunction()
        const range = tf.setPreset(volumePresets['CT-Bone'])
        expect(range).toEqual([-3024, 3071])
        expect(tf.colorPoints[0][0]).toBe(0)
        expect(tf.colorPoints.at(-1)![0]).toBe(1)
        // -16.4458 HU in the preset is where opacity starts to rise
        expect(tf.opacityPoints[1][0]).toBeCloseTo((-16.4458 + 3024) / 6095, 6)
        expect(tf.name).toBe('CT-Bone')
    })

    test('a relative preset returns no range', () => {
        const tf = new TransferFunction()
        expect(tf.setPreset(volumePresets['colormap:viridis'])).toBeUndefined()
    })

    test('texture is re-baked when points change', () => {
        const tf = new TransferFunction([[0, 0, 0, 0], [1, 0, 0, 0]], [[0, 1], [1, 1]])
        const tex = tf.texture
        const data = tex.image.data as Uint8Array
        expect(data[0]).toBe(0)
        tf.colorPoints = [[0, 1, 1, 1], [1, 1, 1, 1]]
        tf.setDirty()
        expect(data[0]).toBe(255)
        expect(tf.texture).toBe(tex)
        tf.dispose()
    })
})

describe('library', () => {
    test('has the VolView presets and one preset per colour map', () => {
        expect(volViewPresets.length).toBe(30)
        for (const name of Object.keys(colorMaps)) expect(volumePresets['colormap:' + name]).toBeDefined()
    })

    test('every preset has sorted points with values in 0..1', () => {
        for (const p of Object.values(volumePresets)) {
            for (const list of [p.colors, p.opacities]) {
                expect(list.length).toBeGreaterThan(0)
                for (let i = 0; i < list.length; i++) {
                    if (i > 0) expect(list[i][0]).toBeGreaterThanOrEqual(list[i - 1][0])
                    for (const v of list[i].slice(1)) {
                        expect(v).toBeGreaterThanOrEqual(0)
                        expect(v).toBeLessThanOrEqual(1)
                    }
                }
            }
        }
    })
})

describe('VolumeData', () => {
    test('8-bit data is uploaded as it is, R8', () => {
        const d = new VolumeData({data: new Uint8Array([0, 64, 128, 255, 1, 2, 3, 4]), size: [2, 2, 2]})
        expect(d.resolvedGpuFormat).toBe('r8')
        expect(d.texture.type).toBe(UnsignedByteType)
        expect(d.texture.image.data).toBe(d.data)
        expect(d.textureRange).toEqual([0, 255])
        expect(d.valueRange).toEqual([0, 255])
        expect(d.gpuBytes).toBe(8)
    })

    test('16-bit data is normalized over its value range into half floats', () => {
        const d = new VolumeData({data: new Int16Array([-1000, 0, 1000, 3000]), size: [4, 1, 1], spacing: [0.5, 0.5, 2]})
        expect(d.resolvedGpuFormat).toBe('r16f')
        expect(d.texture.type).toBe(HalfFloatType)
        expect(d.textureRange).toEqual([-1000, 3000])
        const out = Array.from(d.texture.image.data as Uint16Array).map(h => DataUtils.fromHalfFloat(h))
        expect(out[0]).toBe(0)
        expect(out[1]).toBeCloseTo(0.25, 3)
        expect(out[2]).toBeCloseTo(0.5, 3)
        expect(out[3]).toBe(1)
        expect(d.physicalSize).toEqual([2, 0.5, 2])
        expect(d.fieldDataType).toBe('short')
    })

    test('r32f keeps float precision', () => {
        const d = new VolumeData({data: new Float32Array([0, 0.1234567, 1, 2]), size: [4, 1, 1], gpuFormat: 'r32f'})
        expect(d.texture.type).toBe(FloatType)
        expect((d.texture.image.data as Float32Array)[1]).toBeCloseTo(0.1234567 / 2, 7)
    })

    test('a given value range is kept and clamps the stored values', () => {
        const d = new VolumeData({data: new Float32Array([-5, 0, 5, 10]), size: [4, 1, 1], valueRange: [0, 5]})
        const out = Array.from(d.texture.image.data as Uint16Array).map(h => DataUtils.fromHalfFloat(h))
        expect(out).toEqual([0, 0, 1, 1])
    })

    test('setDirty rebuilds the texture on next use', () => {
        const d = new VolumeData({data: new Uint8Array(8), size: [2, 2, 2]})
        const t = d.texture
        d.setDirty()
        expect(d.texture).not.toBe(t)
    })

    test('rejects data that is smaller than its size', () => {
        expect(() => new VolumeData({data: new Uint8Array(7), size: [2, 2, 2]})).toThrow()
    })

    test('wraps the result of the three.js NRRDLoader', () => {
        // a 2 x 2 x 2 NRRD with raw 16-bit data and 0.5 mm voxels
        const header = [
            'NRRD0004',
            'type: short',
            'dimension: 3',
            'space: left-posterior-superior',
            'sizes: 2 2 2',
            'space directions: (0.5,0,0) (0,0.5,0) (0,0,0.5)',
            'kinds: domain domain domain',
            'endian: little',
            'encoding: raw',
            'space origin: (0,0,0)',
            'space units: "mm" "mm" "mm"',
            '',
            '',
        ].join('\n')
        const values = new Int16Array([-100, 0, 100, 200, 300, 400, 500, 1000])
        const bytes = new Uint8Array(header.length + values.byteLength)
        bytes.set(new TextEncoder().encode(header), 0)
        bytes.set(new Uint8Array(values.buffer), header.length)
        const volume = new NRRDLoader().parse(bytes.buffer as any)
        const d = VolumeData.fromVolume(volume)
        expect(d.size).toEqual([2, 2, 2])
        expect(d.spacing).toEqual([0.5, 0.5, 0.5])
        expect(d.units).toBe('mm')
        expect(d.valueRange).toEqual([-100, 1000])
        expect(Array.from(d.data as Int16Array)).toEqual(Array.from(values))
        expect(d.physicalSize).toEqual([1, 1, 1])
    })
})

describe('VolumeData texture budget', () => {
    test('a field over maxGpuBytes is downsampled, halving the finest axis first', () => {
        const d = new VolumeData({data: new Float32Array(64 ** 3), size: [64, 64, 64], maxGpuBytes: 64 ** 3 * 2 / 8})
        expect(d.textureSize).toEqual([32, 32, 32])
        expect(d.downsampled).toBe(true)
        expect(d.gpuBytes).toBe(32 ** 3 * 2)
        // thick slices along z: x and y are halved before z
        const a = new VolumeData({data: new Float32Array(64 ** 3), size: [64, 64, 64], spacing: [1, 1, 4], maxGpuBytes: 64 ** 3 * 2 / 4})
        expect(a.textureSize).toEqual([32, 32, 64])
    })

    test('a field over the texture size limit is downsampled along that axis', () => {
        const prev = VolumeData.maxTextureSize
        VolumeData.maxTextureSize = 32
        try {
            const d = new VolumeData({data: new Uint8Array(100 * 10 * 10), size: [100, 10, 10]})
            expect(d.textureSize).toEqual([25, 10, 10])
            expect(d.texture.image.width).toBe(25)
        } finally {
            VolumeData.maxTextureSize = prev
        }
    })

    test('each texel averages the voxels it covers in the box', () => {
        // 5 voxels into 3 texels: voxels 0 | 1 2 | 3 4
        const d = new VolumeData({data: new Uint8Array([10, 20, 40, 60, 100]), size: [5, 1, 1], maxGpuBytes: 3})
        expect(d.textureSize).toEqual([3, 1, 1])
        expect(Array.from(d.texture.image.data as Uint8Array)).toEqual([10, 30, 80])
        const f = new VolumeData({data: new Float32Array([0, 1, 2, 3]), size: [4, 1, 1], maxGpuBytes: 4, gpuFormat: 'r16f'})
        expect(f.textureSize).toEqual([2, 1, 1])
        const out = Array.from(f.texture.image.data as Uint16Array).map(h => DataUtils.fromHalfFloat(h))
        expect(out[0]).toBeCloseTo(0.5 / 3, 3)
        expect(out[1]).toBeCloseTo(2.5 / 3, 3)
    })
})

describe('DerivedField', () => {
    class TestField extends DerivedField {
        runs: [number, number][] = []
        target = {width: 4, height: 4, depth: 10} as any
        get size(): [number, number, number] {return [4, 4, 10]}
        get texture() {return undefined}
        get gpuBytes() {return 0}
        protected _createPasses(): DerivedFieldPass[] {
            const kernel = {run: (_r: any, _t: any, from: number, to: number) => this.runs.push([from, to])} as any
            return [{kernel, target: this.target, cost: 1}]
        }
    }

    test('is built a few layers per call within the budget', () => {
        const f = new TestField()
        // one layer is 16 reads
        expect(f.update(null as any, 40)).toBe(32)
        expect(f.ready).toBe(false)
        while (!f.ready) f.update(null as any, 40)
        expect(f.runs).toEqual([[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]])
        expect(f.version).toBe(1)
        expect(f.update(null as any, 40)).toBe(0)
        f.invalidate()
        expect(f.ready).toBe(false)
        f.update(null as any)
        expect(f.ready).toBe(true)
        expect(f.runs.at(-1)).toEqual([0, 10])
        expect(f.version).toBe(2)
    })

    test('does at least one layer even when the budget is smaller', () => {
        const f = new TestField()
        f.update(null as any, 1)
        expect(f.runs).toEqual([[0, 1]])
    })
})

describe('VolumeMaterial', () => {
    test('an explicit absolute preset in the constructor sets its range, and a field set later keeps it', () => {
        const m = new VolumeMaterial({preset: 'CT-Bone'})
        expect(m.range.toArray()).toEqual([-3024, 3071])
        m.field = new VolumeData({data: new Int16Array([0, 100]), size: [2, 1, 1]})
        expect(m.range.toArray()).toEqual([-3024, 3071])
        expect(m.effectiveRange(m.field)).toEqual([-3024, 3071])
        // the default preset stretches over the field
        const field = new VolumeData({data: new Int16Array([0, 100]), size: [2, 1, 1]})
        const d = new VolumeMaterial({field})
        expect(d.effectiveRange(field)).toEqual([0, 100])
        // a range changed in place is used
        d.range.set(10, 20)
        expect(d.effectiveRange(field)).toEqual([10, 20])
    })

    test('clone keeps the volume settings and the field', () => {
        const field = new VolumeData({data: new Uint8Array(8), size: [2, 2, 2]})
        const m = new VolumeMaterial({field, mode: 'iso'})
        m.setPreset('colormap:viridis')
        m.range.set(10, 200)
        m.density = 3
        m.cropMax.set(0.5, 1, 1)
        m.transferFunction.opacityPoints = [[0, 0], [0.3, 0.7], [1, 1]]
        m.transferFunction.setDirty()
        const c = m.clone()
        expect(c).not.toBe(m)
        expect(c.mode).toBe('iso')
        expect(c.range.toArray()).toEqual([10, 200])
        expect(c.density).toBe(3)
        expect(c.cropMax.toArray()).toEqual([0.5, 1, 1])
        expect(c.preset).toBe('colormap:viridis')
        expect(c.transferFunction.opacityPoints).toEqual([[0, 0], [0.3, 0.7], [1, 1]])
        expect(c.transferFunction).not.toBe(m.transferFunction)
        expect(c.field).toBe(field)
    })

    test('copy keeps edited transfer function points instead of applying the preset again', () => {
        const a = new VolumeMaterial({preset: 'CT-Bone'})
        a.transferFunction.colorPoints = [[0, 1, 0, 0], [1, 0, 0, 1]]
        a.range.set(-500, 500)
        const b = new VolumeMaterial()
        b.copy(a)
        expect(b.preset).toBe('CT-Bone')
        expect(b.transferFunction.colorPoints).toEqual([[0, 1, 0, 0], [1, 0, 0, 1]])
        expect(b.range.toArray()).toEqual([-500, 500])
    })
})

describe('lighting', () => {
    test('the shadow light and its index follow the three.js light order', () => {
        const scene = new Scene()
        const dirA = new DirectionalLight()
        const point = new PointLight()
        const dirB = new DirectionalLight()
        scene.add(dirA, point, dirB)
        // no light casts shadows: the first directional light
        expect(findShadowLight(scene)).toEqual({light: dirA, type: 1, index: 0})
        // three.js lists the shadow casters first, so dirB is directional light 0
        dirB.castShadow = true
        expect(findShadowLight(scene)).toEqual({light: dirB, type: 1, index: 0})
        // the first shadow caster in scene order
        point.castShadow = true
        expect(findShadowLight(scene)).toEqual({light: point, type: 2, index: 0})
        point.visible = false
        expect(findShadowLight(scene)).toEqual({light: dirB, type: 1, index: 0})
    })

    test('the light volume sweeps along the axis closest to the light, from the side of the light', () => {
        const renderer = {extensions: {has: () => true}} as any
        const make = (dir: Vector3) => {
            const lv = new LightVolume()
            lv.setParams({
                source: new Data3DTexture(), transferTexture: new DataTexture(), valueMap: [1, 0], mode: 'transfer', iso: 0.5, density: 1, unitScale: [1, 1, 1],
                lightDirection: dir, sourceSize: [64, 32, 16], scale: 0.5,
            })
            ;(lv as any)._createPasses(renderer)
            return lv
        }
        // grid 32 x 16 x 8; in grid voxels the direction is (3.2, 16, 1.6): along y
        const up = make(new Vector3(0.1, 1, 0.2))
        expect(up.size).toEqual([32, 8, 16])
        expect(new Vector3(1, 2, 3).applyMatrix3(up.permutation).toArray()).toEqual([1, 3, 2])
        expect((up as any)._propagation.flip).toBe(true)
        // the shadow bias points toward the light
        expect((up as any)._offset.y).toBeGreaterThan(0)
        const down = make(new Vector3(0.1, -1, 0.2))
        expect((down as any)._propagation.flip).toBe(false)
        // along z when that is the largest in grid voxels: (1.6, 1.6, 8)
        const z = make(new Vector3(0.05, 0.1, 1))
        expect(z.size).toEqual([32, 16, 8])
        up.dispose()
        down.dispose()
        z.dispose()
    })
})

describe('VolumeObject', () => {
    test('clone keeps the fields, the active field and the unit scale', () => {
        const a = new VolumeData({data: new Uint8Array(8), size: [2, 2, 2], name: 'density'})
        const b = new VolumeData({data: new Uint8Array(8), size: [2, 2, 2], name: 'temperature'})
        const o = new VolumeObject([a, b], {unitScale: 0.5})
        o.activeField = 'temperature'
        const c = o.clone()
        expect(c).not.toBe(o)
        expect(Object.keys(c.fields)).toEqual(['density', 'temperature'])
        expect(c.fields.density).toBe(a)
        expect(c.activeField).toBe('temperature')
        expect(c.data).toBe(b)
        expect(c.unitScale).toBe(0.5)
        expect(c.material).toBe(o.material)
    })

    test('a saved volume gives the loaded field its saved name and keeps the other links to load', () => {
        const loaded = new VolumeData({data: new Uint8Array(8), size: [2, 2, 2]}) // default name 'density'
        const o = new VolumeObject(loaded)
        const saved = new VolumeObject()
        saved.userData.__volumeSettings = {
            activeField: 'temperature',
            fields: {
                temperature: {filePath: 'https://example.com/t.nrrd', fieldIndex: 2},
                density: {filePath: 'https://example.com/d.nrrd'},
            },
        }
        o._copyFromEmbedded(saved as any)
        expect(o.activeField).toBe('temperature')
        expect(o.fields.temperature).toBe(loaded)
        expect(loaded.fieldIndex).toBe(2)
        expect(o.fields.density).toBeUndefined()
        expect(o.pendingFieldLinks).toEqual([{name: 'density', filePath: 'https://example.com/d.nrrd', fieldName: undefined, fieldIndex: undefined}])
    })
})

describe('fields on the object', () => {
    test('a shared material shows the field of each volume', () => {
        const a = new VolumeData({data: new Uint8Array(8), size: [2, 2, 2], name: 'density'})
        const b = new VolumeData({data: new Uint8Array(27), size: [3, 3, 3], name: 'density'})
        const t = new VolumeData({data: new Uint8Array(8), size: [2, 2, 2], name: 'temperature'})
        const va = new VolumeObject([a, t])
        const vb = new VolumeObject(b, {material: va.material})
        expect(va.material.resolveField(va)).toBe(a)
        expect(va.material.resolveField(vb)).toBe(b)
        // sourceField picks a field by name, falling back to the active one
        va.material.sourceField = 'temperature'
        expect(va.material.resolveField(va)).toBe(t)
        expect(va.material.resolveField(vb)).toBe(b)
    })

    test('the interpolation of a field is kept when its texture is built again', () => {
        const d = new VolumeData({data: new Uint8Array(8), size: [2, 2, 2]})
        d.interpolate = false
        d.setDirty()
        expect(d.texture.magFilter).toBe(NearestFilter)
        d.interpolate = true
        expect(d.texture.magFilter).toBe(LinearFilter)
    })

    test('a float texture is filtered nearest where the GPU cannot filter floats', () => {
        const prev = VolumeData.floatLinearFiltering
        try {
            VolumeData.floatLinearFiltering = false
            const d = new VolumeData({data: new Float32Array(8), size: [2, 2, 2], gpuFormat: 'r32f'})
            expect(d.texture.magFilter).toBe(NearestFilter)
            const h = new VolumeData({data: new Float32Array(8), size: [2, 2, 2]}) // r16f filters everywhere
            expect(h.texture.magFilter).toBe(LinearFilter)
        } finally {
            VolumeData.floatLinearFiltering = prev
        }
    })
})

describe('field lifetime', () => {
    test('the caches of a field in the material are freed when the field is disposed', () => {
        const d = new VolumeData({data: new Uint8Array(16 ** 3), size: [16, 16, 16]})
        const m = new VolumeMaterial({field: d})
        const caches = m as unknown as {_blocks(f: VolumeData): unknown, _emptySpace: Map<VolumeData, unknown>, _fieldDisposeListeners: Map<VolumeData, unknown>}
        caches._blocks(d)
        expect(caches._emptySpace.size).toBe(1)
        d.dispose()
        expect(caches._emptySpace.size).toBe(0)
        expect(caches._fieldDisposeListeners.size).toBe(0)
        m.dispose()
    })
})
