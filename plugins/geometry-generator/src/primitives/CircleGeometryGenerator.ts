import {AGeometryGenerator} from '../AGeometryGenerator'
import {Vector2, Vector3} from 'threepipe'


export interface CircleGeometryGeneratorParams {
    radius: number,
    segments: number,
    thetaStart: number,
    thetaLength: number
}

export class CircleGeometryGenerator extends AGeometryGenerator<CircleGeometryGeneratorParams> {

    constructor(type = 'circle', defaultParams?: Partial<CircleGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: CircleGeometryGeneratorParams = {
        radius: 1,
        segments: 32,
        thetaStart: 0,
        thetaLength: Math.PI * 2,
    }

    protected _generateData(params: CircleGeometryGeneratorParams) {
        const {radius, thetaStart, thetaLength} = params

        const segments = Math.max(3, params.segments)

        // buffers

        const indices = []
        const vertices = []
        const normals = []
        const uvs = []

        // helper variables

        const vertex = new Vector3()
        const uv = new Vector2()

        // center point

        vertices.push(0, 0, 0)
        normals.push(0, 0, 1)
        uvs.push(0.5, 0.5)

        for (let s = 0, i = 3; s <= segments; s++, i += 3) {

            const segment = thetaStart + s / segments * thetaLength

            // vertex

            vertex.x = radius * Math.cos(segment)
            vertex.y = radius * Math.sin(segment)

            vertices.push(vertex.x, vertex.y, vertex.z)

            // normal

            normals.push(0, 0, 1)

            // uvs

            uv.x = (vertices[ i ] / radius + 1) / 2
            uv.y = (vertices[ i + 1 ] / radius + 1) / 2

            uvs.push(uv.x, uv.y)

        }

        // indices

        for (let i = 1; i <= segments; i++) {

            indices.push(i, i + 1, 0)

        }

        return {indices, vertices, normals, uvs}
    }

}
