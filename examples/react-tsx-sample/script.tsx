import {_testFinish, _testStart, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import React from 'react'
import {createRoot} from 'react-dom/client'

function ThreeViewerComponent({src, env}: {src: string, env: string}) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null)
    React.useEffect(() => {
        if (!canvasRef.current) return

        const viewer = new ThreeViewer({
            canvas: canvasRef.current,
            plugins: [LoadingScreenPlugin],
        })

        // Load an environment map
        const envPromise = viewer.setEnvironmentMap(env)
        const modelPromise = viewer.load(src, {
            autoCenter: true,
            autoScale: true,
        })

        Promise.all([envPromise, modelPromise]).then(([env, model])=>{
            console.log('Loaded', model, env, viewer)
        })
        return () => {
            // dispose the viewer and all its resources when component unmounts. You can also save the viewer instance somewhere and reuse it later if required instead of disposing.
            viewer.dispose()
        }
    }, [])
    return (
        <canvas id="three-canvas" style={{width: 800, height: 600}} ref={canvasRef} />
    )
}

async function init() {
    createRoot(document.getElementById('root')!).render(
        <ThreeViewerComponent
            src={'https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf'}
            env={'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr'}
        />,
    )
}

_testStart()
init().finally(_testFinish)
