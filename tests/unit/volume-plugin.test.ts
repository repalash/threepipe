import {describe, expect, test} from 'vitest'
import {DataUtils, FloatType, HalfFloatType, UnsignedByteType} from 'three'
import {NRRDLoader} from 'three/examples/jsm/loaders/NRRDLoader.js'
import {TransferFunction} from '../../plugins/volume/src/TransferFunction'
import {VolumeData} from '../../plugins/volume/src/VolumeData'
import {VolumeMaterial} from '../../plugins/volume/src/VolumeMaterial'
import {VolumeObject} from '../../plugins/volume/src/VolumeObject'
import {colorMaps, volumePresets, volViewPresets} from '../../plugins/volume/src/library'

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

describe('VolumeMaterial', () => {
    test('an explicit absolute preset in the constructor sets its range, and a field set later keeps it', () => {
        const m = new VolumeMaterial({preset: 'CT-Bone'})
        expect(m.range.toArray()).toEqual([-3024, 3071])
        m.field = new VolumeData({data: new Int16Array([0, 100]), size: [2, 1, 1]})
        expect(m.range.toArray()).toEqual([-3024, 3071])
        // the default preset stretches over the field
        const d = new VolumeMaterial({field: new VolumeData({data: new Int16Array([0, 100]), size: [2, 1, 1]})})
        expect(d.range.toArray()).toEqual([0, 100])
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
