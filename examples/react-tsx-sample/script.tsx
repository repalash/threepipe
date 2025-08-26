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

        Promise.all([envPromise, modelPromise]).then(([environment, model])=>{
            console.log('Loaded', model, environment, viewer)
        })
        return () => {
            // dispose the viewer and all its resources when component unmounts. You can also save the viewer instance somewhere and reuse it later if required instead of disposing.
            viewer.dispose()
        }
    }, [])
    return <div style={{
        position: 'relative',
        width: '80vw',
        height: '80vh',
        margin: '10vh 10vw',
        borderRadius: '0.5rem',
        boxShadow: 'rgba(0, 0, 0, 0.25) 0px 25px 50px -12px',
    }}>
        <canvas
            id="three-canvas"
            style={{
                width: '100%',
                height: '100%',
                borderRadius: '0.5rem',
            }}
            ref={canvasRef} />
    </div>
}

async function init() {
    createRoot(document.getElementById('root')!).render(
        <ThreeViewerComponent
            src={'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'}
            env={'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'}
        />,
    )
}

_testStart()
init().finally(_testFinish)
