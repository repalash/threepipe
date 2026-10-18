import {geometryNodes, n} from '@threepipe/plugin-procedural'

// Blender's Z-up graph: a grid lifted by 4D noise (W is the seed), then shaded smooth.
export const terrain = geometryNodes('Terrain', g => {
    g.input.geometry('Geometry')
    const size = g.input.float('Size', {default: 20, min: 1, max: 60, subtype: 'DISTANCE'})
    const resolution = g.input.int('Resolution', {default: 96, min: 2, max: 300})
    const height = g.input.float('Height', {default: 4, min: 0, max: 15})
    const scale = g.input.float('Noise Scale', {default: 0.12, min: 0.01, max: 1})
    const detail = g.input.float('Detail', {default: 6, min: 0, max: 15})
    const roughness = g.input.float('Roughness', {default: 0.55, min: 0, max: 1})
    const seed = g.input.float('Seed', {default: 0, min: 0, max: 100})

    const grid = n.MeshGrid({sizeX: size, sizeY: size, verticesX: resolution, verticesY: resolution})
    const noise = n.NoiseTexture({noiseDimensions: '4D', w: seed, scale, detail, roughness})
    const lift = n.CombineXYZ({z: noise.fac.sub(0.5).mul(height)})
    const lifted = n.SetPosition({geometry: grid.mesh, offset: lift.vector})
    g.output.geometry('Geometry', n.SetShadeSmooth({geometry: lifted.geometry}).geometry)
})
