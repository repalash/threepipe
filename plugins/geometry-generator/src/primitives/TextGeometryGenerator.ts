import {AGeometryGenerator} from '../AGeometryGenerator'
import {TextGeometry} from 'three/examples/jsm/geometries/TextGeometry.js'
import {FontLibrary} from '../FontLibrary'
import {Float32BufferAttribute} from 'threepipe'
import {Font} from 'three/examples/jsm/loaders/FontLoader.js'

export type FontJSON = Record<string, any>
export interface TextGeometryGeneratorParams {
    text: string,
    font: string | FontJSON,
    size: number,
    height: number,
    curveSegments: number,
    bevelEnabled: boolean,
    bevelThickness: number,
    bevelSize: number,
    bevelOffset: number,
    bevelSegments: number,
    // textAlign?: 'left' | 'center' | 'right' | 'start' | 'middle' | 'end',
    // verticalAlign?: 'top' | 'middle' | 'bottom' | 'baseline' | 'center',
    alignX?: number
    alignY?: number
}

export class TextGeometryGenerator extends AGeometryGenerator<TextGeometryGeneratorParams> {

    constructor(type = 'text', defaultParams?: Partial<TextGeometryGeneratorParams>) {
        super(type)
        if (defaultParams) Object.assign(this.defaultParams, defaultParams)
    }

    defaultParams: TextGeometryGeneratorParams = {
        text: 'Hello World',
        font: '',
        size: 1,
        height: 0.25,
        curveSegments: 12,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelOffset: 0,
        bevelSegments: 5,
        // textAlign: 'center',
        // verticalAlign: 'middle',
        alignX: 0.5,
        alignY: 0.5,
    }

    protected _generateData(params: TextGeometryGeneratorParams) {
        const textGeometry = new TextGeometry(params.text, {
            font: typeof params.font === 'string' ? FontLibrary.GetFont(params.font) : new Font(params.font),
            size: params.size,
            height: params.height,
            curveSegments: params.curveSegments,
            bevelEnabled: params.bevelEnabled,
            bevelThickness: params.bevelThickness,
            bevelSize: params.bevelSize,
            bevelOffset: params.bevelOffset,
            bevelSegments: params.bevelSegments,
        })

        textGeometry.computeBoundingBox()
        textGeometry.computeVertexNormals()

        // Calculate text alignment offsets based on bounding box
        const boundingBox = textGeometry.boundingBox!
        const textWidth = boundingBox.max.x - boundingBox.min.x
        const textHeight = boundingBox.max.y - boundingBox.min.y

        let offsetX = 0
        let offsetY = -boundingBox.min.y

        if (params.alignX !== undefined) { //  0 to 1
            offsetX += -params.alignX * textWidth
        }
        if (params.alignY !== undefined) { //  0 to 1
            offsetY += -params.alignY * textHeight
        }

        // todo this doesnt work for multiple lines, so we will see later
        // // Horizontal alignment (text-align)
        // switch (params.textAlign) {
        // case 'middle':
        // case 'center':
        //     offsetX += -textWidth / 2 - boundingBox.min.x
        //     break
        // case 'right':
        // case 'end':
        //     offsetX += -textWidth - boundingBox.min.x
        //     break
        // case 'left':
        // default:
        //     offsetX += -boundingBox.min.x
        //     break
        // }
        //
        // // Vertical alignment (vertical-align)
        // switch (params.verticalAlign) {
        // case 'middle':
        // case 'center':
        //     offsetY = -textHeight / 2 - boundingBox.min.y
        //     break
        // case 'top':
        //     offsetY = -textHeight - boundingBox.min.y
        //     break
        // case 'bottom':
        //     offsetY = -boundingBox.min.y
        //     break
        // case 'baseline':
        // default:
        //     // For baseline, we want the text to sit naturally without adjustment
        //     // The baseline is typically at y=0 in font coordinates
        //     offsetY = 0
        //     break
        // }

        // Apply alignment offsets to vertices
        if (offsetX !== 0 || offsetY !== 0) {
            textGeometry.translate(offsetX, offsetY, 0)
        }

        // Extract data from the TextGeometry
        const positionAttribute = textGeometry.getAttribute('position') as Float32BufferAttribute
        const normalAttribute = textGeometry.getAttribute('normal') as Float32BufferAttribute
        const uvAttribute = textGeometry.getAttribute('uv') as Float32BufferAttribute
        const indexAttribute = textGeometry.index

        const vertices = positionAttribute
        const normals = normalAttribute
        const uvs = uvAttribute
        const indices = indexAttribute ? Array.from(indexAttribute.array) : []
        if (indices.length === 0) {
            const vertexCount = vertices.count
            for (let i = 0; i < vertexCount; i += 3) {
                indices.push(i, i + 1, i + 2)
            }
        }
        // Clean up temporary geometry
        textGeometry.dispose()
        return {
            indices,
            vertices,
            normals,
            uvs,
            groups: textGeometry.groups,
        }
    }

}
