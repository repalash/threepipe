import {_testFinish, _testStart, LoadingScreenPlugin, Matrix4} from 'threepipe'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {Asset, Model, ViewerCanvas} from '@threepipe/plugin-r3f'
import {PivotControls} from '@react-three/drei'

const matrix = new Matrix4()
function Scene () {
    return <>
        <PivotControls matrix={matrix} depthTest={false}/>
        <React.Suspense>
            <Asset url={'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'}
                autoSetBackground={false}/>
            <Model
                url={'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'}
                autoScale={true}
                autoCenter={false}
                // matrix={matrix}
                props={{
                    matrixAutoUpdate: false,
                    // Why onUpdate and not just matrix={matrix} ?
                    // This is an implementation detail, overwriting (most) transform objects isn't possible in Threejs
                    // because they are defined read-only. Therefore Fiber will always call .copy() if you pass
                    // an object, for instance matrix={new THREE.Matrix4()} or position={new THREE.Vector3()}
                    // In this rare case we do not want it to copy the matrix, but refer to it.
                    onUpdate:(self) => self.matrix = matrix,
                }}
            />
        </React.Suspense>
    </>
}

function App () {
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
            onMount={async (viewer) => {
                console.log('Loaded Viewer', viewer)
                _testFinish()
            }}
            rootChildren={<>
                <color attach="backgroundColor" args={['#FFDAB9']} />
            </>}
        >
            <Scene/>
        </ViewerCanvas>
    </div>
}

async function init () {
    createRoot(document.getElementById('root')).render(<App/>)
}

_testStart()
init().finally(_testFinish)
