/**
 * Parity cases for the texture nodes, written with the DSL. Each case evaluates one texture node on two
 * point sets - a signed 2D grid (Grid 9x9, size 7.3) and 64 points spread in [0, 1]^3 (White Noise 1D
 * colour of the index, which white-noise-1d checks itself) - and stores every available output.
 * W inputs (1D/4D) read the index so they cover negative values too.
 */

import {geometryNodes, n, NodeHandle, Socket} from '../../../src/dsl/builder'
import type {NodeGroupLibrary} from '../../../src/runtime/types'
import {ParityCase} from './types'

const ATTR_TYPE: Record<string, 'FLOAT' | 'FLOAT_COLOR' | 'FLOAT_VECTOR' | 'INT'> = {FLOAT: 'FLOAT', RGBA: 'FLOAT_COLOR', VECTOR: 'FLOAT_VECTOR', INT: 'INT'}

function textureCase(id: string, description: string, idname: string, args: Record<string, unknown>, usesW: boolean): ParityCase {
    const group = geometryNodes(id, g => {
        const grid = n.MeshGrid({sizeX: 7.3, sizeY: 7.3, verticesX: 9, verticesY: 9})
        const cloudPos = g.node('ShaderNodeTexWhiteNoise', {noiseDimensions: '1D', w: n.Index().index.mul(0.731)}).outputs.color
        const cloud = n.Points({count: 64, position: cloudPos, radius: 0.05})
        let geometry: Socket<'GEOMETRY'> = n.JoinGeometry({geometry: [grid.mesh, cloud.geometry]}).geometry
        const w = usesW ? {w: n.Index().index.mul(0.173).sub(9.6)} : {}
        const tex: NodeHandle = g.node(idname, {...args, ...w})
        const seen = new Set<Socket>()
        for (const [key, socket] of Object.entries(tex.outputs)) {
            if (seen.has(socket)) continue
            seen.add(socket)
            geometry = n.StoreNamedAttribute({dataType: ATTR_TYPE[socket.type], domain: 'POINT', geometry, name: key, value: socket}).geometry
        }
        g.output.geometry('Geometry', geometry)
    })
    return {id, description, library: group.toJSON() as NodeGroupLibrary, group: id, input: 'empty'}
}

const DIMS = ['1D', '2D', '3D', '4D'] as const
const usesW = (d: string) => d === '1D' || d === '4D'

export function textureCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const d of DIMS) {
        cases.push(textureCase(`white-noise-${d.toLowerCase()}`, `White Noise ${d}`, 'ShaderNodeTexWhiteNoise', {noiseDimensions: d}, usesW(d)))
    }
    const noiseTypes = ['FBM', 'MULTIFRACTAL', 'RIDGED_MULTIFRACTAL', 'HYBRID_MULTIFRACTAL', 'HETERO_TERRAIN']
    for (const d of DIMS) {
        for (const t of noiseTypes) {
            for (const normalize of t === 'FBM' ? [true, false] : [true]) {
                cases.push(textureCase(`noise-${d.toLowerCase()}-${t.toLowerCase()}${normalize ? '' : '-raw'}`, `Noise ${d} ${t}`,
                    'ShaderNodeTexNoise', {
                        noiseDimensions: d, noiseType: t, normalize, scale: 2.3, detail: 3.5, roughness: 0.62, lacunarity: 2.4,
                        // Offset: not FBM/Multifractal; Gain: Ridged/Hybrid (node_shader_tex_noise.cc:82, :91).
                        ...(t === 'FBM' || t === 'MULTIFRACTAL' ? {} : {offset: 0.3}), ...(t === 'RIDGED_MULTIFRACTAL' || t === 'HYBRID_MULTIFRACTAL' ? {gain: 1.7} : {}),
                        distortion: 0.4,
                    }, usesW(d)))
            }
        }
        cases.push(textureCase(`noise-${d.toLowerCase()}-detail0`, `Noise ${d} detail 0, no distortion`, 'ShaderNodeTexNoise',
            {noiseDimensions: d, scale: 5, detail: 0, distortion: 0}, usesW(d)))
        cases.push(textureCase(`noise-${d.toLowerCase()}-detail15`, `Noise ${d} detail 15`, 'ShaderNodeTexNoise',
            {noiseDimensions: d, scale: 1.1, detail: 15, roughness: 0.8}, usesW(d)))
    }
    const features = ['F1', 'F2', 'SMOOTH_F1', 'DISTANCE_TO_EDGE', 'N_SPHERE_RADIUS']
    const metrics = ['EUCLIDEAN', 'MANHATTAN', 'CHEBYCHEV', 'MINKOWSKI']
    for (const d of DIMS) {
        for (const f of features) {
            // 1D Voronoi has no distance metric (node_shader_tex_voronoi.cc, `distance` is drawn only above 1D).
            for (const m of d === '1D' || f === 'DISTANCE_TO_EDGE' || f === 'N_SPHERE_RADIUS' ? ['EUCLIDEAN'] : metrics) {
                cases.push(textureCase(`voronoi-${d.toLowerCase()}-${f.toLowerCase()}-${m.toLowerCase()}`, `Voronoi ${d} ${f} ${m}`,
                    'ShaderNodeTexVoronoi', {
                        voronoiDimensions: d, feature: f, distance: m, scale: 3.1, randomness: 0.83,
                        ...(m === 'MINKOWSKI' ? {exponent: 0.7} : {}), ...(f === 'SMOOTH_F1' ? {smoothness: 0.6} : {}),
                    }, usesW(d)))
            }
        }
        for (const normalize of [false, true]) {
            cases.push(textureCase(`voronoi-${d.toLowerCase()}-fractal${normalize ? '-normalized' : ''}`, `Voronoi ${d} fractal F1`,
                'ShaderNodeTexVoronoi', {voronoiDimensions: d, normalize, scale: 2.2, detail: 2.5, roughness: 0.7, lacunarity: 2.7, randomness: 0.9}, usesW(d)))
        }
        cases.push(textureCase(`voronoi-${d.toLowerCase()}-fractal-edge`, `Voronoi ${d} fractal distance to edge`,
            'ShaderNodeTexVoronoi', {voronoiDimensions: d, feature: 'DISTANCE_TO_EDGE', normalize: true, scale: 2.2, detail: 1.5, randomness: 0.9}, usesW(d)))
    }
    for (const t of ['LINEAR', 'QUADRATIC', 'EASING', 'DIAGONAL', 'SPHERICAL', 'QUADRATIC_SPHERE', 'RADIAL']) {
        cases.push(textureCase(`gradient-${t.toLowerCase()}`, `Gradient ${t}`, 'ShaderNodeTexGradient', {gradientType: t}, false))
    }
    for (const waveType of ['BANDS', 'RINGS']) {
        for (const dir of waveType === 'BANDS' ? ['X', 'Y', 'Z', 'DIAGONAL'] : ['X', 'Y', 'Z', 'SPHERICAL']) {
            for (const profile of ['SIN', 'SAW', 'TRI']) {
                cases.push(textureCase(`wave-${waveType.toLowerCase()}-${dir.toLowerCase()}-${profile.toLowerCase()}`, `Wave ${waveType} ${dir} ${profile}`,
                    'ShaderNodeTexWave', {
                        waveType, [waveType === 'BANDS' ? 'bandsDirection' : 'ringsDirection']: dir, waveProfile: profile,
                        scale: 1.7, distortion: 3.2, detail: 2.5, detailScale: 1.3, detailRoughness: 0.55, phaseOffset: 0.8,
                    }, false))
            }
        }
    }
    return cases
}
