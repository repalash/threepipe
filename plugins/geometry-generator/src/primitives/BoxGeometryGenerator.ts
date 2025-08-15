import {AGeometryGenerator} from '../AGeometryGenerator'
import {Vector3} from 'threepipe'


export interface BoxGeometryGeneratorParams {
    width: number,
    height: number,
    depth: number,
    widthSegments: number,
    heightSegments: number,
    depthSegments: number
}

export class BoxGeometryGenerator extends AGeometryGenerator<BoxGeometryGeneratorParams> {

    constructor(type = 'box', defaultParams?: Partial<BoxGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: BoxGeometryGeneratorParams = {
        width: 1,
        height: 1,
        depth: 1,
        widthSegments: 1,
        heightSegments: 1,
        depthSegments: 1,
    }

    // helper variables

    protected _buildPlane(state: any, u: 'x'|'y'|'z', v: 'x'|'y'|'z', w: 'x'|'y'|'z', udir: number, vdir: number, width: number, height: number, depth: number, gridX: number, gridY: number, materialIndex: number) {
        const {indices, vertices, normals, uvs, numberOfVertices, groupStart, groups} = state

        const segmentWidth = width / gridX
        const segmentHeight = height / gridY

        const widthHalf = width / 2
        const heightHalf = height / 2
        const depthHalf = depth / 2

        const gridX1 = gridX + 1
        const gridY1 = gridY + 1

        let vertexCounter = 0
        let groupCount = 0

        const vector = new Vector3()

        // generate vertices, normals and uvs
        for (let iy = 0; iy < gridY1; iy++) {
            const y = iy * segmentHeight - heightHalf
            for (let ix = 0; ix < gridX1; ix++) {
                const x = ix * segmentWidth - widthHalf
                // set values to correct vector component
                vector[ u ] = x * udir
                vector[ v ] = y * vdir
                vector[ w ] = depthHalf
                // now apply vector to vertex buffer
                vertices.push(vector.x, vector.y, vector.z)
                // set values to correct vector component
                vector[ u ] = 0
                vector[ v ] = 0
                vector[ w ] = depth > 0 ? 1 : -1
                // now apply vector to normal buffer
                normals.push(vector.x, vector.y, vector.z)
                // uvs
                uvs.push(ix / gridX)
                uvs.push(1 - iy / gridY)
                // counters
                vertexCounter += 1
            }
        }
        // indices
        // 1. you need three indices to draw a single face
        // 2. a single segment consists of two faces
        // 3. so we need to generate six (2*3) indices per segment
        for (let iy = 0; iy < gridY; iy++) {
            for (let ix = 0; ix < gridX; ix++) {
                const a = numberOfVertices + ix + gridX1 * iy
                const b = numberOfVertices + ix + gridX1 * (iy + 1)
                const c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1)
                const d = numberOfVertices + (ix + 1) + gridX1 * iy
                // faces
                indices.push(a, b, d)
                indices.push(b, c, d)
                // increase counter
                groupCount += 6
            }
        }
        // add a group to the geometry. this will ensure multi material support
        groups.push({start: groupStart, count: groupCount, materialIndex})
        // calculate new start value for groups
        state.groupStart += groupCount
        // update total number of vertices
        state.numberOfVertices += vertexCounter
    }

    protected _generateData(params: BoxGeometryGeneratorParams) {
        const {width, height, depth} = params
        let {widthSegments, heightSegments, depthSegments} = params

        // segments
        widthSegments = Math.floor(widthSegments)
        heightSegments = Math.floor(heightSegments)
        depthSegments = Math.floor(depthSegments)

        // buffers

        const state = {
            indices: [],
            vertices: [],
            normals: [],
            uvs: [],
            numberOfVertices: 0,
            groupStart: 0,
            groups: [],
        }

        // build each side of the box geometry

        this._buildPlane(state, 'z', 'y', 'x', -1, -1, depth, height, width, depthSegments, heightSegments, 0) // px
        this._buildPlane(state, 'z', 'y', 'x', 1, -1, depth, height, -width, depthSegments, heightSegments, 1) // nx
        this._buildPlane(state, 'x', 'z', 'y', 1, 1, width, depth, height, widthSegments, depthSegments, 2) // py
        this._buildPlane(state, 'x', 'z', 'y', 1, -1, width, depth, -height, widthSegments, depthSegments, 3) // ny
        this._buildPlane(state, 'x', 'y', 'z', 1, -1, width, height, depth, widthSegments, heightSegments, 4) // pz
        this._buildPlane(state, 'x', 'y', 'z', -1, -1, width, height, -depth, widthSegments, heightSegments, 5) // nz

        return state
    }

}
