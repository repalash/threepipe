import {AGeometryGenerator} from '../AGeometryGenerator'


export interface PlaneGeometryGeneratorParams {
    width: number,
    height: number,
    widthSegments: number,
    heightSegments: number
}

export class PlaneGeometryGenerator extends AGeometryGenerator<PlaneGeometryGeneratorParams> {

    constructor(type = 'plane', defaultParams?: Partial<PlaneGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: PlaneGeometryGeneratorParams = {
        width: 1,
        height: 1,
        widthSegments: 2,
        heightSegments: 2,
    }

    protected _generateData(params: PlaneGeometryGeneratorParams) {
        const widthHalf = params.width / 2
        const heightHalf = params.height / 2

        const gridX = Math.floor(params.widthSegments)
        const gridY = Math.floor(params.heightSegments)

        const gridX1 = gridX + 1
        const gridY1 = gridY + 1

        const segmentWidth = params.width / gridX
        const segmentHeight = params.height / gridY

        const indices = []
        const vertices = []
        const normals = []
        const uvs = []

        for (let iy = 0; iy < gridY1; iy++) {
            const y = iy * segmentHeight - heightHalf
            for (let ix = 0; ix < gridX1; ix++) {
                const x = ix * segmentWidth - widthHalf
                vertices.push(x, -y, 0)
                normals.push(0, 0, 1)
                uvs.push(ix / gridX)
                uvs.push(1 - iy / gridY)
            }
        }
        for (let iy = 0; iy < gridY; iy++) {
            for (let ix = 0; ix < gridX; ix++) {
                const a = ix + gridX1 * iy
                const b = ix + gridX1 * (iy + 1)
                const c = ix + 1 + gridX1 * (iy + 1)
                const d = ix + 1 + gridX1 * iy
                indices.push(a, b, d)
                indices.push(b, c, d)
            }
        }
        return {indices, vertices, normals, uvs}
    }

}
