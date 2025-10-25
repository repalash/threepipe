import {
    ThreeViewer,
    timeout,
    LoadingScreenPlugin,
    GBufferPlugin,
    ContactShadowGroundPlugin,
    SSAAPlugin,
    PickingPlugin,
    SSAOPlugin,
    InteractionPromptPlugin,
    CameraViewPlugin, getUrlQueryParam, NoiseBumpMaterialPlugin, createStyles, TonemapPlugin
} from 'https://esm.sh/threepipe/dist';
import {TweakpaneUiPlugin} from 'https://esm.sh/@threepipe/plugin-tweakpane?external=threepipe';
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin, DepthOfFieldPlugin, SSGIPlugin, WatchHandsPlugin} from 'https://esm.sh/@threepipe/webgi-plugins?external=threepipe';
// import './home.css'

export async function setupViewer() {
    let parent
    // return
    while(!parent) {
        parent = document.querySelector('.VPHomeHero > .container .image-container')
        if(!parent) await new Promise((e) => setTimeout(e, Math.max(0, 2000)));
        break
    }
    if(!parent) return

    // parent.innerHTML = ''

    // const mobile = /Mobi|Android/i.test(navigator.userAgent);
    const screenWidth = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
    const mobile = screenWidth < 960;
    // if(mobile) return


    const container = document.createElement('div')
    container.classList.add('canvas-container')

    parent.appendChild(container)

    LoadingScreenPlugin.LS_DEFAULT_LOGO = '/logo-filled.png'

    const viewer = new ThreeViewer({
        container: container,
        msaa: !mobile,
        rgbm: true,
        renderScale: 'auto',
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        debug: getUrlQueryParam('debug') !== null,
        maxHDRIntensity: 8,
        plugins: [GBufferPlugin,
            InteractionPromptPlugin,
            CameraViewPlugin,
            SSAAPlugin, SSAOPlugin,
            BloomPlugin,
            SSReflectionPlugin,
            TemporalAAPlugin,
            DepthOfFieldPlugin,
            new SSGIPlugin(undefined, 1, false),
            NoiseBumpMaterialPlugin,
            ContactShadowGroundPlugin,
            LoadingScreenPlugin,
        ],
    });
    viewer.serializePluginsIgnored = [LoadingScreenPlugin.PluginType]
    const loading = viewer.getPlugin(LoadingScreenPlugin)

    loading.logoImage = '/logo-filled.png'
    loading.minimizeOnSceneObjectLoad = false
    loading.showFileNames = false
    loading.backgroundOpacity = 1
    loading.loadingTextHeader = 'Loading'
    // loading.showOnSceneEmpty =false // todo remove this in threepipe update to 37

    const wh = viewer.addPluginSync(WatchHandsPlugin)
    wh.invertAxis =true
    wh.hourOffset =10
    wh.minuteOffset =7
    wh.secondOffset =38
    wh.analog =false

    handleDarkMode(viewer)

    addModelTabs(viewer)

    const ssao = viewer.getPlugin(SSAOPlugin)
    const ssaa = viewer.getPlugin(SSAAPlugin)
    const baseGround = viewer.getPlugin(ContactShadowGroundPlugin)
    // const picking = viewer.getPlugin(PickingPlugin)
    const prompt = viewer.getPlugin(InteractionPromptPlugin)

    const ssrefl = viewer.getPlugin(SSReflectionPlugin)
    const ssgi = viewer.getPlugin(SSGIPlugin)
    const bloom = viewer.getPlugin(BloomPlugin)
    const temporalAA = viewer.getPlugin(TemporalAAPlugin)
    const dof = viewer.getPlugin(DepthOfFieldPlugin)

    ssrefl.pass.split = 0.01
    ssgi.pass.split = 0.01
    ssao.pass.split = 0.01

    viewer.deleteImportedViewerConfigOnLoad = false
    viewer.renderManager.stableNoise = true;
    // await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr');
    const res = await viewer.load('https://webgi.dev/watch-2.glb', {
        autoCenter: true,
        autoScale: true,
    });
    if(baseGround) {
        baseGround.mapMode = 'alphaMap'
        baseGround.size = 20
        // if(mobile){
        //     baseGround.material.transparent = true
        //     baseGround.material.opacity = 0.01
        // }
    }


    viewer.fitToView(undefined, 1.5)
    handleDarkMode(viewer)

    let ssreflEnabled = true
    let ssgiEnabled = true
    let ssaoEnabled = true

    // let debugEnabled = false

    const splitLine = document.createElement('div')
    splitLine.classList.add('split-line')
    viewer.container.appendChild(splitLine)

    window.addEventListener('mousemove', (e)=>{
        // if(!debugEnabled) return

        const rect = viewer.canvas.getBoundingClientRect()
        let x = (e.clientX - rect.left) / rect.width
        // const y = 1-(e.clientY - rect.top) / rect.height

        splitLine.style.left = `${e.clientX - rect.left}px`

        if(x <= 0 || x >= 1) {
            ssrefl.pass.split = ssreflEnabled ? 0.01 : 1
            ssgi.pass.split = ssgiEnabled ? 0.01 : 1
            ssao.pass.split = ssaoEnabled ? 0.01 : 1
            splitLine.style.display = 'none'
            return
        }
        // splitLine.style.display = x > 0 ? 'block' : 'none'
        //
        // x = Math.max(0.01, x) // clamp to prevent shader recompile
        // ssrefl.pass.split = x
        // ssgi.pass.split = x
        // ssao.pass.split = x
    })

    dof.enabled = false

    if(viewer.debug) {
        // await viewer.fitToView(undefined, 0.5)
        // prompt.startAnimation()
        // prompt.autoStartDelay = 1000
        const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
        ui.setupPluginUi(LoadingScreenPlugin);
        ui.setupPluginUi(ContactShadowGroundPlugin);
        // ui.setupPluginUi(PickingPlugin);

        ui.setupPluginUi(SSAOPlugin);
        ui.setupPluginUi(SSReflectionPlugin);
        ui.setupPluginUi(SSGIPlugin);
        ui.setupPluginUi(TemporalAAPlugin);
        ui.setupPluginUi(BloomPlugin);
    }

}

function handleDarkMode(viewer) {
    const loading = viewer.getPlugin(LoadingScreenPlugin)
    const ground = viewer.getPlugin(ContactShadowGroundPlugin)
    window.ground = ground
    function setMode(dark) {
        viewer.getPlugin(TonemapPlugin).tonemapBackground = false
        // ground.tonemapGround = false
        if (dark) {
            viewer.scene.setBackgroundColor('#1B1B1F')
            loading.background = '#1B1B1F'
            loading.textColor = '#eeeeee'
            if(ground) {
                ground.material.color.set('#1B1B1F')
                ground.material.roughness = 0.45;
                ground.material.metalness = 1;
                ground.material.userData.separateEnvMapIntensity = true
                ground.material.envMapIntensity = 0
                ground.material.transparent = true
            }
        } else {
            viewer.scene.setBackgroundColor('#E7EFF8')
            loading.background = '#E7EFF8'
            loading.textColor = '#222222'
            if(ground) {
                ground.material.color.set('#E7EFF8')
                ground.material.roughness = 0.25;
                ground.material.metalness = 0.7820321917322556;
                // console.log(ground.material.metalness)
                ground.material.userData.separateEnvMapIntensity = false
                ground.material.envMapIntensity = 1
                ground.material.transparent = true
            }
        }
    }

    function handleDarkModeChange() {
        if (document.documentElement.classList.contains('dark')) {
            setMode(true)
            console.log('Dark mode is enabled');
        } else {
            setMode(false)
            console.log('Light mode is enabled');
        }
    }

    // const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    // mediaQuery.addEventListener('change', handleDarkModeChange);
    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                handleDarkModeChange();
            }
        })
    }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
    });
    handleDarkModeChange(); // initial
    window.handleDarkModeChange = handleDarkModeChange;
}

const models = [
    {
        label: 'Watch',
        path: 'https://webgi.dev/watch-2.glb',
        icon: '1',
    },
    {
        label: 'City',
        path: 'https://webgi.dev/gi-city-2.glb',
        bg: false,
        icon: '2',
    },
    {
        label: 'Car',
        // path: 'https://webgi.dev/gi-city-8.glb',
        path: 'https://webgi.dev/car-scene.glb',
        bg: false,
        icon: '3',
    },
    {
        label: 'Robot',
        path: 'https://webgi.dev/robot.glb',
        bg: true,
        icon: '4',
    },
]
function addModelTabs(viewer) {
    const container = viewer.container
    const tabs = document.createElement('div')
    tabs.className = 'model-tabs'
    container.appendChild(tabs)
    models.forEach((model, i) => {
        const tab = document.createElement('div')
        tab.className = 'model-tab' + (i===0 ? ' model-tab-selected' : '')
        tab.innerHTML = model.icon
        tab.title = model.label
        tab.addEventListener('click', async () => {
            if(tab.classList.contains('model-tab-selected')) return
            const tabs = document.querySelectorAll('.model-tab')
            tabs.forEach(t => {
                // t.classList.remove('model-tab-selected')
                if(t.classList.contains('model-tab-selected')) {
                    t.classList.remove('model-tab-selected')
                    // t.classList.add('hidden')
                }
            })
            tab.classList.add('model-tab-selected')

            // viewer.scene.clearSceneModels()
            viewer.scene.disposeSceneModels()

            await viewer.load(model.path, {
                autoCenter: true,
                autoScale: true,
            });
            // (window as any).handleDarkModeChange()
            if(!model.path.includes('car'))
                viewer.fitToView(undefined, 1.5)

            if(!model.bg)
                window.handleDarkModeChange()
        })
        tabs.appendChild(tab)
    })
}

setupViewer()
