import {_testFinish, _testStart, InteractionPromptPlugin, LoadingScreenPlugin, SSAOPlugin} from 'threepipe'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {Model, TextPlane, ViewerCanvas} from '@threepipe/plugin-r3f'
import {Environment, Float, Lightformer, MeshTransmissionMaterial} from '@react-three/drei'
import {Link, Route, Router} from 'https://esm.sh/wouter'
import {useHashLocation} from 'https://esm.sh/wouter/use-hash-location'

const inter = 'https://rsms.me/inter/font-files/Inter-Regular.woff2?v=4.1'

function Scene () {
    return <>
        <spotLight position={[20, 20, 10]} penumbra={1} castShadow angle={0.2} />
        <Status position={[0, 0, -10]} />
        <Float floatIntensity={2}>
            <Route path="/">
                <Knot />
            </Route>
            <Route path="/torus">
                <Torus />
            </Route>
            <Route path="/gltf">
                <Helmet scale={0.7} />
            </Route>
        </Float>
        <Environment preset="city">
            <Lightformer intensity={8} position={[10, 5, 0]} scale={[10, 50, 1]} onUpdate={(self) => self.lookAt(0, 0, 0)} />
        </Environment>

        {/* <React.Suspense>*/}
        {/*    <Asset url={'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'}*/}
        {/*        autoSetBackground={false}/>*/}

        {/* </React.Suspense>*/}
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
        <Router hook={useHashLocation}>
            <ViewerCanvas
                id="three-canvas"
                style={{width: '100%', height: '100%', borderRadius: 'inherit'}}
                plugins={[LoadingScreenPlugin, InteractionPromptPlugin, SSAOPlugin]}
                viewer={{
                    renderScale: 'auto',
                    msaa: true,
                }}
                camera={{position: [0, 0, 20]}}
                onMount={async (viewer) => {
                    console.log('Loaded Viewer', viewer)
                    _testFinish()
                }}
                rootChildren={<>
                    <color attach="backgroundColor" args={['#e0e0e0']}/>
                </>}
            >
                <Scene/>
            </ViewerCanvas>
            <div className="nav">
                <Link to="/">knot</Link>
                <Link to="/gltf">gltf</Link>
                <Link to="/torus">torus</Link>
            </div>
        </Router>
    </div>
}

async function init () {
    createRoot(document.getElementById('root')).render(<App/>)
}

_testStart()
init().finally(_testFinish)

const Torus = (props) => (
    <mesh receiveShadow castShadow {...props}>
        <torusGeometry args={[4, 1.2, 128, 64]} />
        <MeshTransmissionMaterial backside backsideThickness={5} thickness={2} />
    </mesh>
)

const Knot = (props) => (
    <mesh receiveShadow castShadow {...props}>
        <torusKnotGeometry args={[3, 1, 256, 32]} />
        {/* <physicalMaterial thickness={2} transmission={1} roughness={0} metalness={0.1} />*/}
        <MeshTransmissionMaterial backside backsideThickness={5} thickness={2} />
    </mesh>
)

function Helmet (props) {
    const material = React.useRef()

    return (
        <Model
            url={'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'}
            autoScale={true}
            autoScaleRadius={10}
            autoCenter={false}
            {...props}
            onLoad={(obj)=>{
                obj[0]?.traverse((child) => {
                    if (child.material) child.material = material.current
                })
            }}
        >
            <MeshTransmissionMaterial ref={material} backsideThickness={10} thickness={4} />
        </Model>
    )
}

function Status (props) {
    const [loc] = useHashLocation()
    const text = loc === '/' ? '#knot' : loc.replace(/\//, '#')
    return (
        <>
            <TextPlane fontSize={14} font={inter} color="black" {...props}>
                {text}
            </TextPlane>
        </>

    )
}
