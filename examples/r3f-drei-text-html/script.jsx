import {_testFinish, _testStart, InteractionPromptPlugin, LoadingScreenPlugin, SSAOPlugin} from 'threepipe'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {ViewerCanvas} from '@threepipe/plugin-r3f'
import {Environment, Float, Html, Lightformer, Text} from '@react-three/drei'
import {easing} from 'https://esm.sh/maath?external=three'
import {useFrame} from '@react-three/fiber';
import {suspend} from 'https://esm.sh/suspend-react'

// const inter = 'https://raw.githubusercontent.com/pmndrs/assets/refs/heads/main/src/fonts/inter_light.woff'
const inter = import('https://unpkg.com/@pmndrs/assets@1.7.0/fonts/inter_regular.woff.js')

function Scene () {
    const text = 'knot'
    return <>
        <spotLight position={[20, 20, 10]} penumbra={1} castShadow angle={0.2} />
        <Text fontSize={14} letterSpacing={-0.025} font={suspend(inter).default} color="black" position={[0, 0, -10]} >
            {text}
            <Html style={{ color: 'transparent', fontSize: '33.5em' }} transform>
                {text}
            </Html>
        </Text>
        <Float floatIntensity={2}>
            <Knot />
        </Float>
        <Environment preset="city">
            <Lightformer intensity={8} position={[10, 5, 0]} scale={[10, 50, 1]} onUpdate={(self) => self.lookAt(0, 0, 0)} />
        </Environment>
    </>
}

function App () {
    return <div style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        margin: '0',
        borderRadius: '0',
        boxShadow: 'rgba(0, 0, 0, 0.25) 0px 25px 50px -12px',
    }}>
        <ViewerCanvas
            id="three-canvas"
            style={{width: '100%', height: '100%', borderRadius: 'inherit'}}
            plugins={[LoadingScreenPlugin, InteractionPromptPlugin, SSAOPlugin]}
            useR3FLoop={true}
            viewer={{
                renderScale: 'auto',
                msaa: true,
            }}
            camera={{position: [0, 0, 20], controlsMode: ''}}
            onMount={async (viewer) => {
                console.log('Loaded Viewer', viewer)
                _testFinish()
            }}
            rootChildren={<>
                <color attach="backgroundColor" args={['#e0e0e0']}/>
            </>}
        >
            <Scene/>
            <Rig />
        </ViewerCanvas>
    </div>
}

async function init () {
    createRoot(document.getElementById('root')).render(<App/>)
}

_testStart()
init().finally(_testFinish)

const Knot = (props) => (
    <mesh receiveShadow castShadow {...props}>
        <torusKnotGeometry args={[3, 1, 256, 32]} />
        <physicalMaterial thickness={2} transmission={1} roughness={0} metalness={0.1} />
        {/* <MeshTransmissionMaterial backside backsideThickness={5} thickness={2} />*/}
    </mesh>
)

function Rig () {
    useFrame((state, delta) => {
        easing.damp3(
            state.camera.position,
            [Math.sin(-state.pointer.x) * 5, state.pointer.y * 3.5, 15 + Math.cos(state.pointer.x) * 10],
            0.2,
            delta,
        )
        state.camera.lookAt(0, 0, 0)
    })
}
