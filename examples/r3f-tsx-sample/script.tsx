import {_testFinish, _testStart, LoadingScreenPlugin} from 'threepipe'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {Asset, Model, ViewerCanvas} from '@threepipe/plugin-r3f'

function App() {
    return <div style={{
        position: 'relative',
        width: '80vw',
        height: '80vh',
        margin: '10vh 10vw',
        borderRadius: '0.5rem',
        boxShadow: 'rgba(0, 0, 0, 0.25) 0px 25px 50px -12px',
    }}>
        <ViewerCanvas
            id="three-canvas"
            style={{width: '100%', height: '100%', borderRadius: 'inherit'}}
            plugins={[LoadingScreenPlugin]}
            onMount={async(viewer) => {
                console.log('Loaded Viewer', viewer)
                _testFinish()
            }}
        >
            <React.Suspense>
                <Asset url={'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'}
                    autoSetBackground={true}/>
                <Model url={'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'}
                    autoScale={true}
                    autoCenter={true}
                />
            </React.Suspense>
        </ViewerCanvas>
    </div>
}

async function init() {
    createRoot(document.getElementById('root')!).render(<App/>)
}

_testStart()
init().finally(_testFinish)
