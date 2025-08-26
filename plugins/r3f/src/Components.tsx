import {
    AddModelOptions,
    addModelProcess,
    ImportAddOptions,
    ImportAssetOptions,
    ImportResult,
    IObject3D,
} from 'threepipe'
import {useViewerInternal} from './ViewerContextInternal.ts'
import {useViewerImporter} from './useViewerImporter.tsx'
import {Ref, useLayoutEffect} from 'react'
import {ThreeElements} from '@react-three/fiber'

// for viewer.load
export function Asset({url, onImport, onLoad, ...options}: ImportAddOptions & {
    url: string
    onImport?: (obj: (ImportResult | undefined)[] | undefined) => void
    onLoad?: (obj: ImportResult[]|null) => void
}) {
    const {viewerRef} = useViewerInternal()
    const object = useViewerImporter(viewerRef, url, options, onImport) ?? []

    // add the object to the scene when its being rendered
    useLayoutEffect(()=>{
        const arr = (Array.isArray(object) ? object : [object]).filter(Boolean) as ImportResult[]
        Promise.allSettled(arr.map(async o=>{
            if (o) return viewerRef.current?.assetManager.loadImported(o as IObject3D, options)
        })).then(()=>{
            if (onLoad) onLoad(arr.length ? arr : null)
        })
    }, [object])

    // todo check - this should happen automatically when the object is removed from the scene?
    // useEffect(() => {
    //     return () => {
    //         object.dispose()
    //     }
    // }, [object])

    return Array.isArray(object) ? object.map((p, i)=> p ? <primitive key={(p as IObject3D).uuid ?? i} object={p as IObject3D} /> : null) : object ? <primitive object={object as IObject3D} /> : null
    // return null
}

// for viewer.import
export function Model({url, onImport, onLoad, props, ref, children, ...options}: {
    url: string,
    onImport?: (obj: (ImportResult | undefined)[] | undefined) => void
    onLoad?: (obj: IObject3D[]|null) => void
    props?: ThreeElements['object3D2'],
    ref?: Ref<IObject3D>
    children?: React.ReactNode,
} & ImportAssetOptions & AddModelOptions) {
    const {viewerRef} = useViewerInternal()
    const object = useViewerImporter(viewerRef, url, options, onImport) ?? []

    // process the object to the scene before its being rendered
    useLayoutEffect(()=>{
        const arr = (Array.isArray(object) ? object : [object]).filter(o=>o && (o as IObject3D).isObject3D) as IObject3D[]
        arr.forEach(o=>{
            addModelProcess((o as IObject3D), options)
        })
        if (onLoad) onLoad(arr.length ? arr : null)
    }, [object])

    return Array.isArray(object) ?
        object.map((p, i)=> p ? <primitive key={(p as IObject3D).uuid ?? i} object={p as IObject3D} {...props} ref={i === 0 ? ref : undefined} >{i === 0 ? children : undefined}</primitive> : null) :
        object ? <primitive object={object as IObject3D} {...props} ref={ref} >{children}</primitive> : null
}

