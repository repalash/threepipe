/**
 * Commands that make new geometry: `primitive`, `lathe`, `sweep`.
 *
 * These three carry most of a build. In the SU-152 session that motivated this API, `lathe` produced
 * every wheel, sprocket, barrel, muzzle-brake baffle, fuel drum and bolt head, and `sweep` produced
 * every grab rail and handle - so their parameters are the ones most worth getting right.
 *
 * ## Axis convention
 *
 * The kernel is a Blender port and Blender's revolve primitives are built around **Z**. threepipe is
 * **Y-up**. The conversion happens here, at the command layer, rather than in the kernel: a
 * `cylinder` stands along Y by default because that is what a Y-up scene expects, and `axis` moves
 * it. The kernel stays Blender-exact so its parity fixtures keep meaning something.
 */

import {Matrix4} from 'threepipe'
import {
    Mat4,
    MeshData,
    primitiveCircle,
    primitiveCone,
    primitiveCube,
    primitiveGrid,
    primitiveIcoSphere,
    primitiveLathe,
    primitiveSweep,
    primitiveTorus,
    primitiveUVSphere,
    Vec3,
} from '@threepipe/mesh-kernel'
import {CommandDefinition, S, schema} from './types'
import {meshBounds, readPoints, readVec3, setShading, Vec3Tuple} from './params'
import {ModellingEntry} from '../document'

const PRIMITIVE_TYPES = [
    'cube', 'box', 'plane', 'grid', 'circle', 'cylinder', 'cone', 'sphere', 'icosphere', 'torus',
] as const

const AXES = ['x', 'y', 'z'] as const

/** The rotation that takes a Blender Z-axis primitive onto the requested world axis. */
function axisMatrix(axis: 'x' | 'y' | 'z'): Mat4 {
    const m = new Matrix4()
    // Blender builds along +Z. Y-up is the threepipe default, so that is the default rotation.
    if (axis === 'y') m.makeRotationX(-Math.PI / 2)
    else if (axis === 'x') m.makeRotationY(Math.PI / 2)
    return m.toArray() as Mat4
}

function scaleMatrix(s: Vec3Tuple, base?: Mat4): Mat4 {
    const m = new Matrix4().makeScale(s[0], s[1], s[2])
    if (base) m.multiply(new Matrix4().fromArray(base))
    return m.toArray() as Mat4
}

/** Placement, colour and shading are the same for every creating command. */
const PLACEMENT_PROPS = {
    name: S.string('Name for the new object. A duplicate gets a `.001` suffix, as in Blender.'),
    position: S.vec3('World position of the new object.'),
    rotation: S.vec3('Euler XYZ rotation in radians.'),
    scale: S.vec3('Object scale. Applied to the object transform, not baked into the topology.'),
    color: S.string('Base colour, any CSS colour string.'),
    shading: S.enum('Face shading. `auto` leaves it to the bake, which splits on sharp angles.',
        ['auto', 'flat', 'smooth']),
}

function place(
    ctx: {doc: import('../document').ModellingDocument}, mesh: MeshData, p: Record<string, unknown>,
    defaultName: string,
): ModellingEntry {
    if (p.shading) setShading(mesh, p.shading as 'flat' | 'smooth' | 'auto')
    const entry = ctx.doc.add(mesh, {
        name: (p.name as string) ?? defaultName,
        color: p.color as string | undefined,
    })
    const o = entry.object
    const pos = readVec3(p.position, [0, 0, 0], 'position')
    const rot = readVec3(p.rotation, [0, 0, 0], 'rotation')
    const scl = readVec3(p.scale, [1, 1, 1], 'scale')
    o.position.set(...pos)
    o.rotation.set(...rot)
    o.scale.set(...scl)
    o.setDirty?.()
    return entry
}

export const primitiveCommand: CommandDefinition = {
    op: 'primitive',
    summary: 'Add a primitive mesh - cube, plane, grid, circle, cylinder, cone, sphere, icosphere or torus.',
    description:
        'Topology is Blender\'s, so a cylinder body is quads and its caps are single n-gons rather '
        + 'than triangle fans. Every primitive stays fully editable afterwards: `vertices`, '
        + '`transform` with a vertex list, `array` and `duplicate` all address it by index.',
    mutates: true,
    schema: schema({
        type: S.enum('Which primitive.', PRIMITIVE_TYPES),
        size: S.number('Uniform size. For a cube, its edge length; for a plane or grid, its side.'),
        width: S.number('X size. Overrides `size` on that axis.'),
        height: S.number('Y size. For a cylinder or cone, its length along `axis`.'),
        depth: S.number('Z size.'),
        radius: S.number('Radius, for circle, cylinder, cone, sphere, icosphere and torus.'),
        radiusTop: S.number('Cylinder top radius. 0 makes a cone. Blender\'s `radius1`.'),
        radiusBottom: S.number('Cylinder bottom radius. Blender\'s `radius2`.'),
        tubeRadius: S.number('Torus tube radius.'),
        segments: S.integer('Segments around the axis. Default 32.', {minimum: 3}),
        tubeSegments: S.integer('Torus segments around the tube. Default 12.', {minimum: 3}),
        rings: S.integer('Sphere rings from pole to pole. Default 16.', {minimum: 2}),
        subdivisions: S.integer('Icosphere subdivision level. Default 2.', {minimum: 1}),
        xSegments: S.integer('Grid segments along X. Default 1.', {minimum: 1}),
        ySegments: S.integer('Grid segments along Y. Default 1.', {minimum: 1}),
        capEnds: S.boolean('Close the ends of a cylinder, cone or circle. Default true.'),
        axis: S.enum('Which axis the primitive stands along. Default `y`.', AXES),
        ...PLACEMENT_PROPS,
    }, ['type']),

    run(p: Record<string, unknown>, ctx) {
        const type = p.type as typeof PRIMITIVE_TYPES[number]
        const axis = (p.axis as 'x' | 'y' | 'z') ?? 'y'
        const num = (k: string, d: number) => (p[k] === undefined ? d : p[k] as number)
        const size = num('size', 1)
        const radius = num('radius', 0.5)
        const segments = num('segments', 32)
        const capEnds = p.capEnds === undefined ? true : p.capEnds as boolean

        let mesh: MeshData
        switch (type) {
        case 'cube':
        case 'box': {
            // Build a unit cube and scale it, so `width`/`height`/`depth` are exact sizes.
            const s: Vec3Tuple = [num('width', size), num('height', size), num('depth', size)]
            mesh = primitiveCube({size: 1, matrix: scaleMatrix(s)})
            break
        }
        case 'plane':
            mesh = primitiveGrid({
                xSegments: 1, ySegments: 1, size: 1,
                matrix: scaleMatrix([num('width', size), 1, num('depth', size)],
                    axisMatrix(axis === 'y' ? 'y' : axis)),
            })
            break
        case 'grid':
            mesh = primitiveGrid({
                xSegments: num('xSegments', 1), ySegments: num('ySegments', 1), size: 1,
                matrix: scaleMatrix([num('width', size), 1, num('depth', size)], axisMatrix('y')),
            })
            break
        case 'circle':
            mesh = primitiveCircle({
                segments, radius, capEnds, matrix: axisMatrix(axis),
            })
            break
        case 'cylinder':
            mesh = primitiveCone({
                segments,
                radiusTop: num('radiusTop', radius),
                radiusBottom: num('radiusBottom', radius),
                depth: num('height', num('depth', 1)),
                capEnds,
                matrix: axisMatrix(axis),
            })
            break
        case 'cone':
            mesh = primitiveCone({
                segments,
                radiusTop: num('radiusTop', 0),
                radiusBottom: num('radiusBottom', radius),
                depth: num('height', num('depth', 1)),
                capEnds,
                matrix: axisMatrix(axis),
            })
            break
        case 'sphere':
            mesh = primitiveUVSphere({
                uSegments: segments, vSegments: num('rings', 16), radius, matrix: axisMatrix(axis),
            })
            break
        case 'icosphere':
            mesh = primitiveIcoSphere({subdivisions: num('subdivisions', 2), radius})
            break
        case 'torus':
            mesh = primitiveTorus({
                majorRadius: radius,
                minorRadius: num('tubeRadius', radius * 0.25),
                majorSegments: segments,
                minorSegments: num('tubeSegments', 12),
                axis: axis === 'x' ? [1, 0, 0] : axis === 'z' ? [0, 0, 1] : [0, 1, 0],
            })
            break
        default:
            throw new Error(`unknown primitive type "${type}"`)
        }

        const entry = place(ctx, mesh, p, type === 'box' ? 'cube' : type)
        return {
            objects: [entry.name],
            data: {
                name: entry.name,
                verts: mesh.vertsNum,
                edges: mesh.edgesNum,
                faces: mesh.facesNum,
                bounds: meshBounds(mesh),
            },
        }
    },
}

export const latheCommand: CommandDefinition = {
    op: 'lathe',
    summary: 'Revolve a 2D profile around an axis to make a solid of revolution.',
    description:
        'The profile is a list of `[radial, axial]` pairs - distance from the axis, then distance '
        + 'along it - read in order, so a stepped profile gives a stepped rim. A point at radius 0 '
        + 'lands on the axis and is welded into a single apex rather than a ring of coincident '
        + 'vertices. Output is quads, one ring per profile segment.',
    mutates: true,
    schema: schema({
        profile: S.array(
            'Profile points, `[radial, axial]` pairs (or full `[x, y, z]` points).',
            {type: 'array', items: {type: 'number'}}, {minItems: 2}),
        axis: S.enum('Axis of revolution. Default `y`.', AXES),
        center: S.vec3('Point on the axis the profile revolves about. Default the origin.'),
        segments: S.integer('Segments around the full turn. Default 32.', {minimum: 3}),
        angle: S.number('Sweep angle in radians. Default a full turn. Less leaves open ends.'),
        closed: S.boolean('Close the profile into a loop first - a circle profile then gives a torus.'),
        capEnds: S.boolean('Cap the two ends when the profile is open and off the axis.'),
        ...PLACEMENT_PROPS,
    }, ['profile']),

    run(p: Record<string, unknown>, ctx) {
        const profile = readPoints(p.profile, 'profile', true)
        const axis = (p.axis as 'x' | 'y' | 'z') ?? 'y'
        const axisVec: Vec3 = axis === 'x' ? [1, 0, 0] : axis === 'z' ? [0, 0, 1] : [0, 1, 0]
        const mesh = primitiveLathe({
            profile: profile as ([number, number] | Vec3)[],
            axis: axisVec,
            center: readVec3(p.center, [0, 0, 0], 'center') as Vec3,
            segments: (p.segments as number) ?? 32,
            angle: (p.angle as number) ?? Math.PI * 2,
            closed: p.closed as boolean | undefined,
            capEnds: p.capEnds as boolean | undefined,
        })
        const entry = place(ctx, mesh, p, 'lathe')
        return {
            objects: [entry.name],
            data: {
                name: entry.name,
                verts: mesh.vertsNum, edges: mesh.edgesNum, faces: mesh.facesNum,
                bounds: meshBounds(mesh),
            },
        }
    },
}

export const sweepCommand: CommandDefinition = {
    op: 'sweep',
    summary: 'Sweep a circular (or custom) section along a path to make a tube, rail or handle.',
    description:
        'Frames along the path are rotation-minimising, so the section does not corkscrew around a '
        + 'bend, and a closed path has its residual twist distributed so the seam matches. Output is '
        + 'quads; caps, when asked for, are single n-gons.',
    mutates: true,
    schema: schema({
        path: S.array('Path points in object space.', S.vec3('A point.'), {minItems: 2}),
        radius: S.number('Section radius. Default 0.05.'),
        steps: S.integer('Segments around the section. Default 8.', {minimum: 3}),
        profile: S.array('A custom section replacing the circle, as `[x, y]` pairs.',
            {type: 'array', items: {type: 'number'}}),
        closed: S.boolean('Join the path end back to its start.'),
        capEnds: S.boolean('Cap open ends. Default true.'),
        normalMode: S.enum('Frame transport. `minimumTwist` unless you want a fixed up vector.',
            ['minimumTwist', 'zUp']),
        ...PLACEMENT_PROPS,
    }, ['path']),

    run(p: Record<string, unknown>, ctx) {
        const path = readPoints(p.path, 'path') as Vec3[]
        const mesh = primitiveSweep({
            path,
            radius: (p.radius as number) ?? 0.05,
            steps: (p.steps as number) ?? 8,
            profile: p.profile ? readPoints(p.profile, 'profile', true) as ([number, number] | Vec3)[] : undefined,
            closed: p.closed as boolean | undefined,
            capEnds: p.capEnds === undefined ? true : p.capEnds as boolean,
            normalMode: p.normalMode as 'minimumTwist' | 'zUp' | undefined,
        })
        const entry = place(ctx, mesh, p, 'sweep')
        return {
            objects: [entry.name],
            data: {
                name: entry.name,
                verts: mesh.vertsNum, edges: mesh.edgesNum, faces: mesh.facesNum,
                bounds: meshBounds(mesh),
            },
        }
    },
}

export const createCommands = [primitiveCommand, latheCommand, sweepCommand]
