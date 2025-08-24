import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {Asset, Model, ViewerCanvas} from '@threepipe/plugin-r3f'

async function init() {
    createRoot(document.getElementById('root')!).render(
        <ViewerCanvas
            id="three-canvas"
            style={{width: 800, height: 600}}
            plugins={[LoadingScreenPlugin]}
            onMount={async(viewer) => {
                console.log('Loaded Viewer', viewer)
                _testFinish()
            }}
        >
            <React.Suspense>
                <Asset url={'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr'}
                    autoSetBackground={true}/>
                <Model url={'https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf'}/>
            </React.Suspense>
        </ViewerCanvas>,
    )
}

_testStart()
init().finally(_testFinish)
