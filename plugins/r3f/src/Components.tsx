import {ImportAddOptions, ImportAssetOptions, IObject3D} from 'threepipe'
import {useViewerInternal} from './ViewerContextInternal.ts'
import {useViewerImporter} from './useViewerImporter.tsx'

// for viewer.load
export function Asset({url, ...options}: {url: string|string[]} & ImportAddOptions) {
    const {viewerRef} = useViewerInternal()
    const object = useViewerImporter(viewerRef, url, options, true) ?? []
    return Array.isArray(object) ? object.map((p, i)=> p ? <primitive key={(p as IObject3D).uuid ?? i} object={p as IObject3D} /> : null) : object ? <primitive object={object as IObject3D} /> : null
}

// for viewer.import
export function Model({url, ...options}: {url: string|string[]} & ImportAssetOptions) {
    const {viewerRef} = useViewerInternal()
    const object = useViewerImporter(viewerRef, url, options, false) ?? []
    return Array.isArray(object) ? object.map((p, i)=> p ? <primitive key={(p as IObject3D).uuid ?? i} object={p as IObject3D} /> : null) : object ? <primitive object={object as IObject3D} /> : null
}

