import {Canvas, CanvasProps, extend, ThreeElement, useFrame, useThree} from '@react-three/fiber'
import type {DefaultGLProps} from '@react-three/fiber/dist/declarations/src/core/renderer'
import {
    AmbientLight2,
    BufferGeometry2,
    defaultObjectProcessor,
    DirectionalLight2,
    HemisphereLight2,
    ICamera,
    LineMaterial2,
    Mesh2,
    MeshLine,
    MeshLineMaterial,
    Object3D2,
    OrthographicCamera2,
    PerspectiveCamera2,
    PhysicalMaterial,
    PointLight2,
    RectAreaLight2,
    RootScene,
    SpotLight2,
    ThreeViewer,
    ThreeViewerOptions,
    UnlitMaterial,
} from 'threepipe'
import {
    useCreateViewerContext,
    useViewerInternal,
    ViewerContextInternal,
    ViewerCtxProps,
    ViewerRef,
} from './ViewerContextInternal.ts'
import {ReactNode, useEffect, useMemo, useRef, useState} from 'react'

type CanvasWrapperProps = Omit<CanvasProps, 'gl'|'camera'|'scene'> & {
    camera?: ThreeViewerOptions['camera']
    scene?: ThreeViewerOptions['rootScene']
    plugins?: ThreeViewerOptions['plugins']
    viewer?: Omit<ThreeViewerOptions, 'camera'|'rootScene'|'canvas'|'powerPreference'|'container'>
    onMount?: (viewer: ThreeViewer)=>void
    rootChildren?: ReactNode;
}

function initCamera(cam: CanvasWrapperProps['camera'], ortho = false): ICamera {
    if (cam && typeof cam === 'object' && 'isCamera' in cam && cam.isCamera) {
        return cam
    }

    const camera = cam?.type === 'orthographic' || ortho && !cam?.type ?
        new OrthographicCamera2(cam?.controlsMode ?? 'orbit') :
        new PerspectiveCamera2(cam?.controlsMode ?? 'orbit')

    const pos = cam?.position || [0, 0, 5]
    if (Array.isArray(pos)) camera.position.fromArray(pos)
    else camera.position.copy(pos)
    const tar = cam?.target || [0, 0, 0]
    if (Array.isArray(tar)) camera.target.fromArray(tar)
    else camera.target.copy(tar)

    camera.name = 'Default Camera' + (camera.type === 'OrthographicCamera' ? ' (Ortho)' : '')
    camera.userData.autoLookAtTarget = true // only for when controls are disabled / not available

    return camera
}

function initScene(scene: CanvasWrapperProps['scene'], camera: ICamera, viewerRef: ViewerRef) {
    if (scene && typeof scene === 'object' && 'isScene' in scene && scene.isScene) {
        return scene as RootScene
    }
    // todo options
    return new RootScene(camera, defaultObjectProcessor(()=>viewerRef.current))
    // return new RootScene(camera, defaultObjectProcessor(()=>viewer))
}

function AnimLoop() {
    const {viewerRef, timeRef, useR3FLoop} = useViewerInternal()
    const {invalidate} = useThree()

    useEffect(()=>{
        const viewer = viewerRef.current
        if (!viewer) return
        const onUpdate = ()=>{
            // console.log('update')
            if (useR3FLoop) invalidate()
        }
        viewer.addEventListener('update', onUpdate)
        return ()=>{
            viewer.removeEventListener('update', onUpdate)
        }
    }, [invalidate, useR3FLoop, viewerRef])

    const set = useThree((state) => state.set)
    const get = useThree((state) => state.get)

    const makeDefaultControls = true
    useEffect(() => {
        if (!viewerRef.current) return
        const controls = viewerRef.current.scene.mainCamera?.controls
        if (!makeDefaultControls) return
        const old = get().controls
        set({controls})

        const s = ()=>{
            set({controls: viewerRef.current?.scene.mainCamera?.controls ?? null})
        }
        const l = (e: {change?: string})=>{
            if (e.change === 'controls') s()
        }
        viewerRef.current.scene.mainCamera?.addEventListener('cameraUpdate', l)
        viewerRef.current.scene.addEventListener('mainCameraChange', s)

        return () => {
            viewerRef.current?.scene.mainCamera?.removeEventListener('cameraUpdate', l)
            viewerRef.current?.scene.removeEventListener('mainCameraChange', s)
            set({controls: old})
        }
    }, [viewerRef.current])


    useFrame((_s, delta, frame)=>{
        if (!viewerRef.current) return
        timeRef.current += delta
        if (useR3FLoop)
            viewerRef.current.renderManager.animationLoop(timeRef.current, frame)
        else
            viewerRef.current.setDirty()
    }, 1)

    return null
}

function CanvasWrapper({
    onMount, children,
    rootChildren,
    viewer, plugins,
    scene: sceneProps, camera: cameraProps,
    orthographic,
    ...props
}: CanvasWrapperProps) {
    useMemo(() => extend(ExtendedThree), [])

    const {viewerRef, useR3FLoop} = useViewerInternal()
    const cameraRef = useRef<ICamera|null>(null)
    const sceneRef = useRef<RootScene|null>(null)

    // counter(state) done because of strict mode/ssr?. this ensures init only happens once (consistent with r3f)
    const [counter, setCounter] = useState(0)
    useEffect(()=>{
        if (cameraRef.current) return
        setCounter(1)
        if (!counter) return
        cameraRef.current = initCamera(cameraProps, orthographic)
        sceneRef.current = initScene(sceneProps, cameraRef.current, viewerRef)
        setCounter(2)
    }, [counter])

    useEffect(()=>{
        return ()=>{
            if (!viewerRef.current) return
            viewerRef.current.dispose()
            viewerRef.current = undefined
        }
    }, [viewerRef])

    const camera = cameraRef.current
    const scene = sceneRef.current

    return !scene || !camera ? null :
        <Canvas
            gl={(p: DefaultGLProps)=>{
                camera.setCanvas(p.canvas as HTMLCanvasElement)
                camera.autoAspect = true // this has to be set after setting the canvas
                camera.setDirty()

                viewerRef.current = new ThreeViewer({
                    canvas: p.canvas as HTMLCanvasElement,
                    powerPreference: p.powerPreference as any,
                    rootScene: scene,
                    camera: camera,
                    // todo alpha, antialias from p
                    cacheImportedAssets: false,
                    ...viewer,
                    plugins: [...viewer?.plugins ?? [], ...plugins ?? []],
                })

                if (onMount) onMount(viewerRef.current)
                const gl = viewerRef.current.renderManager.webglRenderer
                if (useR3FLoop) gl.setAnimationLoop(null)
                return gl
            }}
            frameloop={'demand'}
            shadows={'percentage'}
            {...props}
            // ref={canvasRef}
            scene={scene}
            camera={camera as any}
        >
            <AnimLoop/>
            <primitive object={scene.modelRoot} >
                {children}
            </primitive>
            {rootChildren}
        </Canvas>

}

export type ViewerCanvasProps = CanvasWrapperProps & ViewerCtxProps

/**
 * R3F Canvas with ThreeViewer context
 * @param useR3FLoop - if true, the r3f render loop will be used (via invalidate), otherwise threepipe's internal loop will be used (default: false)
 * @param props - Canvas props and ThreeViewer options
 * @constructor
 */
export function ViewerCanvas({useR3FLoop = false, ...props}: ViewerCanvasProps) {
    const value = useCreateViewerContext({useR3FLoop})
    return (
        <ViewerContextInternal.Provider value={value}>
            <CanvasWrapper {...props} />
        </ViewerContextInternal.Provider>
    )
}


// Add types to ThreeElements elements so primitives pick up on it
declare module '@react-three/fiber' {
    interface ThreeElements {
        mesh2: ThreeElement<typeof Mesh2>
        meshLine: ThreeElement<typeof MeshLine>
        lineMaterial2: ThreeElement<typeof LineMaterial2>
        meshLineMaterial: ThreeElement<typeof MeshLineMaterial>
        bufferGeometry2: ThreeElement<typeof BufferGeometry2>
        object3D2: ThreeElement<typeof Object3D2>
        physicalMaterial: ThreeElement<typeof PhysicalMaterial>
        unlitMaterial: ThreeElement<typeof UnlitMaterial>
        directionalLight2: ThreeElement<typeof DirectionalLight2>
        pointLight2: ThreeElement<typeof PointLight2>
        spotLight2: ThreeElement<typeof SpotLight2>
        ambientLight2: ThreeElement<typeof AmbientLight2>
        hemisphereLight2: ThreeElement<typeof HemisphereLight2>
        rectAreaLight2: ThreeElement<typeof RectAreaLight2>
        perspectiveCamera2: ThreeElement<typeof PerspectiveCamera2>
        orthographicCamera2: ThreeElement<typeof OrthographicCamera2>
    }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const ExtendedThree = {
    Mesh2, MeshLine, LineMaterial2, MeshLineMaterial, BufferGeometry2, Object3D2,
    PhysicalMaterial, UnlitMaterial,
    DirectionalLight2, PointLight2, SpotLight2, AmbientLight2, HemisphereLight2, RectAreaLight2,
    PerspectiveCamera2, OrthographicCamera2,
}
