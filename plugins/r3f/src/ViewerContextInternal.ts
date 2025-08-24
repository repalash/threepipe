import type {ThreeViewer} from 'threepipe'
import {createContext, RefObject, useContext, useRef} from 'react'

export type ViewerRef = RefObject<ThreeViewer|undefined>

export interface ThreeViewerContext {
    viewerRef: ViewerRef
    timeRef: RefObject<number>
    setViewerDirty?: ()=>void
    useR3FLoop: boolean
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ViewerContextInternal = createContext<ThreeViewerContext>({
    viewerRef: {current: undefined},
    timeRef: {current: 0},
    useR3FLoop: false,
})

export interface ViewerCtxProps {
    useR3FLoop?: boolean
}

export function useCreateViewerContext({useR3FLoop = false}: ViewerCtxProps): ThreeViewerContext {
    const viewerRef = useRef<ThreeViewer|undefined>(undefined)
    const timeRef = useRef<number>(0)
    return {viewerRef, timeRef, useR3FLoop}
}

export function useViewerInternal(): ThreeViewerContext {
    return useContext(ViewerContextInternal)
}

export function useViewer() {
    const {viewerRef} = useViewerInternal()
    return viewerRef.current
}
