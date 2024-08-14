import {_testFinish, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
// @ts-expect-error no need react here
import React from 'react'
// @ts-expect-error no need react-dom here
import ReactDOM from 'react-dom'

function ThreeViewerComponent({src, env}: {src: string, env: string}) {
    const canvasRef = React.useRef(null)
    React.useEffect(() => {
        const viewer = new ThreeViewer({canvas: canvasRef.current,
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
            viewer.dispose()
        }
    }, [])
    return (
        <canvas id="three-canvas" style={{width: 800, height: 600}} ref={canvasRef} />
    )
}

async function init() {
    ReactDOM.render(
        <ThreeViewerComponent
            src={'https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf'}
            env={'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr'}
        />,
        document.getElementById('root')
    )
}

init().finally(_testFinish)
