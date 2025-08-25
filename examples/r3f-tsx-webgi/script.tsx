import React from 'react'
import {createRoot} from 'react-dom/client'
import {Asset, useViewer, ViewerCanvas} from '@threepipe/plugin-r3f'
import {
    _testFinish,
    _testStart,
    BaseGroundPlugin,
    GBufferPlugin,
    LoadingScreenPlugin,
    ProgressivePlugin,
    SSAAPlugin,
    SSAOPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

_testStart()

function Watch() {
    const viewer = useViewer()!
    return <Asset url={'https://asset-samples.threepipe.org/demos/classic-watch.glb'}
        importConfig={true}
        onLoad={(asset)=>{
            console.log('Asset Loaded', asset)
            // Configure plugin properties after loading the file
            const ground = viewer.getPlugin(BaseGroundPlugin)
            if (ground) {
                          ground.material!.roughness = 0
                          ground.material!.metalness = 0.8
            }
            const bloom = viewer.getPlugin(BloomPlugin)
            if (bloom) {
                bloom.pass.threshold = 2
            }
            viewer.scene.envMapIntensity = 0.5 // Set the environment map intensity

        }}
    />
}

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
            style={{
                width: '100%',
                height: '100%',
                borderRadius: '0.5rem',
            }}
            useR3FLoop={false}
            viewer={{
                msaa: true,
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
                // Add a ground below the model
                BaseGroundPlugin,
            ]}
            onMount={async(viewer) => {
                console.log('Loaded Viewer', viewer)
                // Add a plugin with a debug UI for tweaking parameters
                const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
                // Add some debug UI elements for tweaking parameters
                ui.setupPlugins(SSAAPlugin)
                ui.setupPlugins(SSReflectionPlugin)
                ui.setupPlugins(BaseGroundPlugin)
                ui.appendChild(viewer.scene.uiConfig, {expanded: true})

                _testFinish()
            }}
        >
            <React.Suspense>
                <Watch/>
            </React.Suspense>
        </ViewerCanvas>
    </div>
}

createRoot(document.getElementById('root')!).render(<App/>)
