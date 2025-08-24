import {Canvas, CanvasProps, useFrame, useThree} from '@react-three/fiber'
import type {DefaultGLProps} from '@react-three/fiber/dist/declarations/src/core/renderer'
import {
    defaultObjectProcessor,
    ICamera,
    OrthographicCamera2,
    PerspectiveCamera2,
    RootScene,
    ThreeViewer,
    ThreeViewerOptions,
} from 'threepipe'
import {
    useCreateViewerContext,
    useViewerInternal,
    ViewerContextInternal,
    ViewerCtxProps,
    ViewerRef,
} from './ViewerContextInternal.ts'
import {ReactNode, useEffect, useRef, useState} from 'react'

type CanvasWrapperProps = Omit<CanvasProps, 'gl'|'camera'|'scene'> & {
    camera?: ThreeViewerOptions['camera']
    scene?: ThreeViewerOptions['rootScene']
    plugins: ThreeViewerOptions['plugins']
    viewer?: Omit<ThreeViewerOptions, 'camera'|'rootScene'|'canvas'|'powerPreference'|'container'|'plugins'>
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

    if (cam?.position)
        camera.position.copy(cam.position)
    else
        camera.position.set(0, 0, 5)
    if (cam?.target)
        camera.target.copy(cam.target)
    else
        camera.target.set(0, 0, 0)
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

function CanvasWrapper({onMount, children, rootChildren, ...props}: CanvasWrapperProps) {
    const {viewerRef, useR3FLoop} = useViewerInternal()
    const cameraRef = useRef<ICamera|null>(null)
    const sceneRef = useRef<RootScene|null>(null)

    // counter(state) done because of strict mode/ssr?. this ensures init only happens once (consistent with r3f)
    const [counter, setCounter] = useState(0)
    useEffect(()=>{
        if (cameraRef.current) return
        setCounter(1)
        if (!counter) return
        cameraRef.current = initCamera(props.camera, props.orthographic)
        sceneRef.current = initScene(props.scene, cameraRef.current, viewerRef)
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
                    ...props.viewer,
                })

                if (onMount) onMount(viewerRef.current)
                const gl = viewerRef.current.renderManager.webglRenderer
                if (useR3FLoop) gl.setAnimationLoop(null)
                return gl
            }}
            frameloop={'demand'}
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

