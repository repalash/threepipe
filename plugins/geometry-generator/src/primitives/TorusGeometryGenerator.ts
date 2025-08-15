import {AGeometryGenerator} from '../AGeometryGenerator'
import {Vector3} from 'threepipe'


export interface TorusGeometryGeneratorParams {
    radius: number,
    tube: number,
    radialSegments: number,
    tubularSegments: number,
    arc: number
}

export class TorusGeometryGenerator extends AGeometryGenerator<TorusGeometryGeneratorParams> {

    constructor(type = 'torus', defaultParams?: Partial<TorusGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: TorusGeometryGeneratorParams = {
        radius: 1,
        tube: 0.4,
        radialSegments: 12,
        tubularSegments: 48,
        arc: Math.PI * 2,
    }

    protected _generateData(params: TorusGeometryGeneratorParams) {
        const {radius, tube, arc} = params
        let {radialSegments, tubularSegments} = params

        radialSegments = Math.floor(radialSegments)
        tubularSegments = Math.floor(tubularSegments)

        // buffers

        const indices = []
        const vertices = []
        const normals = []
        const uvs = []

        // helper variables

        const center = new Vector3()
        const vertex = new Vector3()
        const normal = new Vector3()

        // generate vertices, normals and uvs

        for (let j = 0; j <= radialSegments; j++) {

            for (let i = 0; i <= tubularSegments; i++) {

                const u = i / tubularSegments * arc
                const v = j / radialSegments * Math.PI * 2

                // vertex

                vertex.x = (radius + tube * Math.cos(v)) * Math.cos(u)
                vertex.y = (radius + tube * Math.cos(v)) * Math.sin(u)
                vertex.z = tube * Math.sin(v)

                vertices.push(vertex.x, vertex.y, vertex.z)

                // normal

                center.x = radius * Math.cos(u)
                center.y = radius * Math.sin(u)
                normal.subVectors(vertex, center).normalize()

                normals.push(normal.x, normal.y, normal.z)

                // uv

                uvs.push(i / tubularSegments)
                uvs.push(j / radialSegments)

            }

        }

        // generate indices

        for (let j = 1; j <= radialSegments; j++) {

            for (let i = 1; i <= tubularSegments; i++) {

                // indices

                const a = (tubularSegments + 1) * j + i - 1
                const b = (tubularSegments + 1) * (j - 1) + i - 1
                const c = (tubularSegments + 1) * (j - 1) + i
                const d = (tubularSegments + 1) * j + i

                // faces

                indices.push(a, b, d)
                indices.push(b, c, d)

            }

        }

        return {indices, vertices, normals, uvs}
    }

}
