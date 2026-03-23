import {Float32BufferAttribute, ShapeGeometry} from 'three'
import {AGeometryGenerator} from '../AGeometryGenerator'
import {IGeometry} from '../../../core/IGeometry'
import {UiObjectConfig} from 'uiconfig.js'
import {createShapeFromPreset} from '../helpers/ShapePresets'

export interface ShapeGeometryGeneratorParams {
    shapeType: 'rectangle' | 'circle' | 'polygon'
    width: number
    height: number
    circleRadius: number
    circleSegments: number
    sides: number
    polygonRadius: number
    curveSegments: number
}

/**
 * Generates a flat 2D shape geometry from preset shape types.
 * Uses three.js ShapeGeometry internally.
 */
export class ShapeGeometryGenerator extends AGeometryGenerator<ShapeGeometryGeneratorParams> {

    constructor(type = 'shape', defaultParams?: Partial<ShapeGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: ShapeGeometryGeneratorParams = {
        shapeType: 'rectangle',
        width: 1,
        height: 1,
        circleRadius: 1,
        circleSegments: 32,
        sides: 6,
        polygonRadius: 1,
        curveSegments: 12,
    }

    protected _generateData(params: ShapeGeometryGeneratorParams) {
        const shape = createShapeFromPreset(params.shapeType, params)
        const shapeGeom = new ShapeGeometry(shape, params.curveSegments)

        shapeGeom.computeVertexNormals()

        const positionAttr = shapeGeom.getAttribute('position') as Float32BufferAttribute
        const normalAttr = shapeGeom.getAttribute('normal') as Float32BufferAttribute
        const uvAttr = shapeGeom.getAttribute('uv') as Float32BufferAttribute
        const indexArr = shapeGeom.index ? Array.from(shapeGeom.index.array) : []

        const result = {
            indices: indexArr,
            vertices: positionAttr,
            normals: normalAttr,
            uvs: uvAttr,
        }

        shapeGeom.dispose()
        return result
    }

    createUiConfig(geometry: IGeometry): UiObjectConfig[] {
        const params = geometry.userData.generationParams as unknown as ShapeGeometryGeneratorParams
        if (!params) return []

        const allUi = super.createUiConfig(geometry)

        // Add visibility callbacks based on shapeType
        for (const ui of allUi) {
            const label = ui.label as string
            if (label === 'width' || label === 'height') {
                ui.hidden = () => params.shapeType !== 'rectangle'
            } else if (label === 'circleRadius' || label === 'circleSegments') {
                ui.hidden = () => params.shapeType !== 'circle'
            } else if (label === 'sides' || label === 'polygonRadius') {
                ui.hidden = () => params.shapeType !== 'polygon'
            }
        }

        return allUi
    }
}
