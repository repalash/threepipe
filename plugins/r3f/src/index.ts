
export {ViewerCanvas, type ViewerCanvasProps} from './ViewerCanvas.tsx'
export {Asset, Model} from './Components.tsx'
export {useViewerImporter} from './useViewerImporter.tsx'
export {ViewerContextInternal, useCreateViewerContext, useViewerInternal, useViewer} from './ViewerContextInternal.ts'
export type {ThreeViewerContext, ViewerCtxProps, ViewerRef} from './ViewerContextInternal.ts'
export {TextPlane, type TextPlaneProps} from './TextPlane.tsx'

import {ThreeElement} from '@react-three/fiber'
import {Mesh2} from 'threepipe'

declare module '@react-three/fiber' {
    // todo
    interface ThreeElements {
        mesh2: ThreeElement<typeof Mesh2>
    }
}
