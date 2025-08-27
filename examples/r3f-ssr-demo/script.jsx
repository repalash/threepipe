import {
    _testFinish,
    _testStart,
    GBufferPlugin, InteractionPromptPlugin,
    LoadingScreenPlugin,
    PickingPlugin,
    ProgressivePlugin,
    SRGBColorSpace,
    SSAAPlugin,
    SSAOPlugin,
} from 'threepipe'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {Asset, useViewer, ViewerCanvas} from '@threepipe/plugin-r3f'
import {useFrame, useThree} from '@react-three/fiber'
import {RoundedBox, useCursor} from '@react-three/drei'
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

function Scene () {
    return <>
        {/* <hemisphereLight2 intensity={1} />*/}
        <Asset url={'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'}
            autoSetBackground={false}/>
        <directionalLight2 position={[0, 2, 5]} castShadow intensity={2} />
        <group position={[2, -2, 0]}>
            <group position={[0, -0.9, -3]}>
                <Plane color="black" rotation-x={-Math.PI / 2} position-z={3} scale={[4, 20, 0.2]} />
                <Plane color="#f4ae00" rotation-x={-Math.PI / 2} position-y={1} scale={[4.2, 1, 4]} />
                <Plane color="#436fbd" rotation-x={-Math.PI / 2} position={[-1.7, 1, 6]} scale={[1.5, 4, 3]} />
                <Plane color="#d7dfff" rotation-x={-Math.PI / 2} position={[0, 4, 3]} scale={[2, 0.03, 4]} />
            </group>
            <Sphere />
            <Video />
        </group>
    </>
}

function App () {
    return <div style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        margin: '0',
        borderRadius: '0',
    }}>
        <ViewerCanvas
            id="three-canvas"
            style={{width: '100%', height: '100%', borderRadius: 'inherit'}}
            viewer={{
                tonemap: false,
                msaa: true,
                renderScale: 'auto',
                rgbm: true,
            }}
            camera={{
                position: [20, 7, 8],
                target: [-0.8, 0.1, 2],
            }}
            plugins={[
                // Show a loading screen while the model is downloading
                LoadingScreenPlugin,
                ProgressivePlugin,
                // Enable progressive rendering and SSAA
                GBufferPlugin,
                TemporalAAPlugin,
                SSAAPlugin,
                SSAOPlugin,
                SSReflectionPlugin,
                BloomPlugin,
                PickingPlugin,
                InteractionPromptPlugin,
                // Add a ground below the model
                // BaseGroundPlugin,
            ]}
            onMount={async (viewer) => {
                console.log('Loaded Viewer', viewer)
                _testFinish()

                const ui = viewer.addPluginSync(TweakpaneUiPlugin)
                ui.setupPluginUi(PickingPlugin)
                ui.setupPluginUi(SSReflectionPlugin)

                const ssr = viewer.getPlugin(SSReflectionPlugin)
                ssr.pass.rayCount = 4
                ssr.pass.rayBlendMax = true
                ssr.pass.intensity = 1
                ssr.pass.boost.set(3,3,3)
            }}
            rootChildren={<>
                <color attach="backgroundColor" args={['#151520']} />
            </>}
        >
            <React.Suspense>
                <Scene/>
            </React.Suspense>
        </ViewerCanvas>
    </div>
}

async function init () {
    createRoot(document.getElementById('root')).render(<App/>)
}

_testStart()
init().finally(_testFinish)


function Sphere () {
    const ref = React.useRef()
    const [active, setActive] = React.useState(false)
    const [zoom, set] = React.useState(true)
    useCursor(active)
    useFrame((state) => {
        ref.current.position.y = Math.sin(state.clock.getElapsedTime() / 2)
        // state.camera.position.lerp({ x: 50, y: 25, z: zoom ? 50 : -50 }, 0.03)
        // state.camera.lookAt(0, 0, 0)
    })
    return (
        <mesh ref={ref} receiveShadow castShadow onClick={() => set(!zoom)} onPointerOver={() => setActive(true)} onPointerOut={() => setActive(false)}>
            <sphereGeometry args={[0.8, 64, 64]} />
            <physicalMaterial color={active ? 'hotpink' : 'lightblue'} clearcoat={1} clearcoatRoughness={0} roughness={0} metalness={0.25} />
        </mesh>
    )
}

const Plane = ({ color, ...props }) => (
    <RoundedBox receiveShadow castShadow smoothness={10} radius={0.015} {...props}>
        <physicalMaterial color={color} envMapIntensity={1} roughness={0.4} metalness={0} />
    </RoundedBox>
)

function Video () {
    const [video] = React.useState(() => Object.assign(document.createElement('video'), { src: 'https://samples.threepipe.org/demos/r3f/drei_r.mp4', crossOrigin: 'Anonymous', loop: true, muted: true }))
    const { invalidate } = useThree()
    const viewer = useViewer()
    React.useEffect(() => void video.play(), [video])
    useFrame(() => video.readyState >= video.HAVE_CURRENT_DATA && video.requestVideoFrameCallback(() => {
        viewer.renderManager.resetShadows() // or use setDirty in object/scene
        invalidate()
    }))

    return (
        <mesh position={[-2, 4, 0]} rotation={[0, Math.PI / 2, 0]} scale={[17, 10, 1]}>
            <planeGeometry />
            <unlitMaterial>
                <videoTexture attach="map" args={[video]} colorSpace={SRGBColorSpace} />
            </unlitMaterial>
        </mesh>
    )
}
