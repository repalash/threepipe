import {AGeometryGenerator} from '../AGeometryGenerator'
import {Vector2, Vector3} from 'threepipe'


export interface CylinderGeometryGeneratorParams {
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radialSegments: number,
    heightSegments: number,
    openEnded: boolean,
    thetaStart: number,
    thetaLength: number
}

export class CylinderGeometryGenerator extends AGeometryGenerator<CylinderGeometryGeneratorParams> {

    constructor(type = 'cylinder', defaultParams?: Partial<CylinderGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: CylinderGeometryGeneratorParams = {
        radiusTop: 1,
        radiusBottom: 1,
        height: 1,
        radialSegments: 32,
        heightSegments: 1,
        openEnded: false,
        thetaStart: 0,
        thetaLength: Math.PI * 2,
    }

    protected _generateTorso(state: any) {
        const {radiusTop, radiusBottom, height,
            radialSegments, heightSegments,
            thetaStart, thetaLength, indexArray, indices, groups,
            vertices, normals, uvs, groupStart, halfHeight} = state

        const normal = new Vector3()
        const vertex = new Vector3()

        let groupCount = 0

        // this will be used to calculate the normal
        const slope = (radiusBottom - radiusTop) / height

        // generate vertices, normals and uvs

        for (let y = 0; y <= heightSegments; y++) {
            const indexRow = []
            const v = y / heightSegments
            // calculate the radius of the current row
            const radius = v * (radiusBottom - radiusTop) + radiusTop
            for (let x = 0; x <= radialSegments; x++) {
                const u = x / radialSegments
                const theta = u * thetaLength + thetaStart
                const sinTheta = Math.sin(theta)
                const cosTheta = Math.cos(theta)
                // vertex
                vertex.x = radius * sinTheta
                vertex.y = -v * height + halfHeight
                vertex.z = radius * cosTheta
                vertices.push(vertex.x, vertex.y, vertex.z)
                // normal
                normal.set(sinTheta, slope, cosTheta).normalize()
                normals.push(normal.x, normal.y, normal.z)
                // uv
                uvs.push(u, 1 - v)
                // save index of vertex in respective row
                indexRow.push(state.index++)
            }
            // now save vertices of the row in our index array
            indexArray.push(indexRow)
        }
        // generate indices
        for (let x = 0; x < radialSegments; x++) {
            for (let y = 0; y < heightSegments; y++) {
                // we use the index array to access the correct indices
                const a = indexArray[ y ][ x ]
                const b = indexArray[ y + 1 ][ x ]
                const c = indexArray[ y + 1 ][ x + 1 ]
                const d = indexArray[ y ][ x + 1 ]
                // faces
                indices.push(a, b, d)
                indices.push(b, c, d)
                // update group counter
                groupCount += 6
            }
        }
        // add a group to the geometry. this will ensure multi material support
        groups.push({start: groupStart, count: groupCount, materialIndex: 0})
        // calculate new start value for groups
        state.groupStart += groupCount
    }
    protected _generateCap(state: any, top: boolean) {
        const {radiusTop, radiusBottom,
            radialSegments,
            thetaStart, thetaLength, indices, groups,
            vertices, normals, uvs, groupStart, halfHeight} = state
        // save the index of the first center vertex
        const centerIndexStart = state.index
        const uv = new Vector2()
        const vertex = new Vector3()
        let groupCount = 0
        const radius = top === true ? radiusTop : radiusBottom
        const sign = top === true ? 1 : -1
        // first we generate the center vertex data of the cap.
        // because the geometry needs one set of uvs per face,
        // we must generate a center vertex per face/segment
        for (let x = 1; x <= radialSegments; x++) {
            // vertex
            vertices.push(0, halfHeight * sign, 0)
            // normal
            normals.push(0, sign, 0)
            // uv
            uvs.push(0.5, 0.5)
            // increase index
            state.index++
        }
        // save the index of the last center vertex
        const centerIndexEnd = state.index
        // now we generate the surrounding vertices, normals and uvs
        for (let x = 0; x <= radialSegments; x++) {
            const u = x / radialSegments
            const theta = u * thetaLength + thetaStart
            const cosTheta = Math.cos(theta)
            const sinTheta = Math.sin(theta)
            // vertex
            vertex.x = radius * sinTheta
            vertex.y = halfHeight * sign
            vertex.z = radius * cosTheta
            vertices.push(vertex.x, vertex.y, vertex.z)
            // normal
            normals.push(0, sign, 0)
            // uv
            uv.x = cosTheta * 0.5 + 0.5
            uv.y = sinTheta * 0.5 * sign + 0.5
            uvs.push(uv.x, uv.y)
            // increase index
            state.index++
        }
        // generate indices
        for (let x = 0; x < radialSegments; x++) {
            const c = centerIndexStart + x
            const i = centerIndexEnd + x
            if (top === true) {
                // face top
                indices.push(i, i + 1, c)
            } else {
                // face bottom
                indices.push(i + 1, i, c)
            }
            groupCount += 3
        }
        // add a group to the geometry. this will ensure multi material support
        groups.push({start: groupStart, count: groupCount, materialIndex: top === true ? 1 : 2})
        // calculate new start value for groups
        state.groupStart += groupCount
    }

    protected _generateData(params: CylinderGeometryGeneratorParams) {
        let {radialSegments, heightSegments} = params

        radialSegments = Math.floor(radialSegments)
        heightSegments = Math.floor(heightSegments)

        const state = {
            indices: [],
            vertices: [],
            normals: [],
            uvs: [],
            numberOfVertices: 0,
            groupStart: 0,
            groups: [],
            index: 0,
            indexArray: [],
            halfHeight: params.height / 2,
            ...params,
            radialSegments,
            heightSegments,
        }

        // generate geometry

        this._generateTorso(state)

        if (params.openEnded === false) {

            if (params.radiusTop > 0) this._generateCap(state, true)
            if (params.radiusBottom > 0) this._generateCap(state, false)

        }

        return state
    }

}
