// import {TweakpaneUiPlugin} from 'https://unpkg.com/@threepipe/plugin-tweakpane/dist/index.mjs';
import {setupAbstract, teardownAbstract} from "./home-3d-abstract.js";
import {icons, createButtonRow, toggleDarkMode} from "./viewer-controls.js";
const {
    ThreeViewer,
    LoadingScreenPlugin,
    GBufferPlugin,
    ContactShadowGroundPlugin,
    SSAAPlugin,
    SSAOPlugin,
    InteractionPromptPlugin,
    CameraViewPlugin, getUrlQueryParam, NoiseBumpMaterialPlugin,
    TonemapPlugin,
} = window.threepipe;
const {
    BloomPlugin,
    DepthOfFieldPlugin,
    SSGIPlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    WatchHandsPlugin
} = window['@threepipe/webgi-plugins'];

let currentModel = null
const ppSplit = {splitLine: document.createElement('div'), enabled: false, x: 1}
const models = [
    {
        label: 'Abstract',
        path: 'https://samples.threepipe.org/demos/webgi/lights-only-env.glb',
        bg: false,
        icon: icons.shapes,
        ground: true,
    },
    {
        label: 'Watch',
        path: 'https://samples.threepipe.org/demos/webgi/classic-watch.glb',
        bg: false,
        icon: icons.watch,
        ground: true,
    },
    {
        label: 'City',
        path: 'https://samples.threepipe.org/demos/webgi/gi-city-2.glb',
        bg: false,
        icon: icons.building,
        ground: false,
    },
    {
        label: 'Car',
        // path: 'https://webgi.dev/gi-city-8.glb',
        path: 'https://samples.threepipe.org/demos/webgi/car-scene.glb',
        bg: false,
        icon: icons.car,
        ground: false,
    },
    {
        label: 'Robot',
        path: 'https://samples.threepipe.org/demos/webgi/robot-2.glb',
        bg: false,
        icon: icons.bot,
        ground: true,
    },
]
const barButtons = [{
    label: 'Toggle Ground',
    icon: icons.ground,
    action: (viewer) => {
        const ground = viewer.getPlugin(ContactShadowGroundPlugin)
        if(ground) {
            ground.mapMode = ground.mapMode === 'alphaMap' ? 'aoMap' : 'alphaMap'
        }
    },
    active: (viewer) => {
        const ground = viewer.getPlugin(ContactShadowGroundPlugin)
        return ground && ground.mapMode === 'aoMap'
    },
    visible: (viewer) => {
        return !!viewer.getPlugin(ContactShadowGroundPlugin) && !!currentModel?.ground
    },
}, {
    label: 'Toggle webgi',
    icon: icons.sparkles,
    action: (viewer) => {
        ppSplit.enabled = !ppSplit.enabled
        ppSplit.x = 0.9
        updateSplit(viewer);
    },
    active: (viewer) => {
        return !ppSplit.enabled
    }
}, {
    label: 'Toggle Dark Mode',
    className: 'dark-mode-btn',
    icon: icons.moon,
    action: (viewer) => {
        toggleDarkMode()
    },
    active: (viewer) => {
        return document.documentElement.classList.contains('dark')
    }
}]

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
        assetManager: {storage: false},
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

    const existingImg = document.querySelector('.VPHomeHero > .container .image-container img')
    if(existingImg) {
        existingImg.style.display = 'none'
    }

    handleDarkMode(viewer)

    addModelTabs(viewer)

    addButtonBar(viewer)

    const baseGround = viewer.getPlugin(ContactShadowGroundPlugin)
    // const picking = viewer.getPlugin(PickingPlugin)
    const prompt = viewer.getPlugin(InteractionPromptPlugin)

    viewer.deleteImportedViewerConfigOnLoad = false
    viewer.renderManager.stableNoise = true;
    // await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr');
    // const res = await viewer.load('https://webgi.dev/watch-2.glb', {
    //     autoCenter: true,
    //     autoScale: true,
    // });
    await loadModel(viewer, models[0])
    if(baseGround) {
        baseGround.mapMode = 'alphaMap'
        baseGround.size = 20
        // if(mobile){
        //     baseGround.material.transparent = true
        //     baseGround.material.opacity = 0.01
        // }
    }
    updateButtonsActiveState(viewer)

    viewer.fitToView(undefined, 1.5)
    handleDarkMode(viewer)

    // let debugEnabled = false
    setupSplit(viewer);

    const dof = viewer.getPlugin(DepthOfFieldPlugin)
    dof.enabled = false

    // if(viewer.debug) {
    //     // await viewer.fitToView(undefined, 0.5)
    //     // prompt.startAnimation()
    //     // prompt.autoStartDelay = 1000
    //     const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));
    //     ui.setupPluginUi(LoadingScreenPlugin);
    //     ui.setupPluginUi(ContactShadowGroundPlugin);
    //     // ui.setupPluginUi(PickingPlugin);
    //
    //     ui.setupPluginUi(SSAOPlugin);
    //     ui.setupPluginUi(SSReflectionPlugin);
    //     ui.setupPluginUi(SSGIPlugin);
    //     ui.setupPluginUi(TemporalAAPlugin);
    //     ui.setupPluginUi(BloomPlugin);
    // }

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
            // console.log('Dark mode is enabled');
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

async function loadModel(viewer, model) {
    modelTabs?.setDisabled(true)
    buttonBar?.setDisabled(true)
    // viewer.scene.clearSceneModels()
    viewer.scene.disposeSceneModels()

    if(model.path)
    await viewer.load(model.path, {
        autoCenter: true,
        autoScale: true,
    });
    currentModel = model

    if (model.label === 'Abstract') {
        const dof = viewer.getPlugin(DepthOfFieldPlugin)
        dof.enabled = false
        setupAbstract(viewer)
    } else {
        teardownAbstract(viewer)
    }
    // (window as any).handleDarkModeChange()
    if (!model.path.includes('car'))
        viewer.fitToView(undefined, 1.5)

    if (!model.bg)
        window.handleDarkModeChange()

    updateButtonsActiveState(viewer)
    modelTabs?.setDisabled(false)
    buttonBar?.setDisabled(false)
}

let modelTabs = null
let buttonBar = null
let selectedModel = null

function addModelTabs(viewer) {
    selectedModel = models[0]
    modelTabs = createButtonRow(viewer.container, 'model-tabs', models.map(model => ({
        label: model.label,
        icon: model.icon,
        action: async () => {
            if (selectedModel === model) return
            selectedModel = model
            modelTabs.update()
            await loadModel(viewer, model)
        },
        active: () => selectedModel === model,
    })))
}

function updateSplit(viewer) {
    let x = ppSplit.x
    const ssao = viewer.getPlugin(SSAOPlugin)
    const ssrefl = viewer.getPlugin(SSReflectionPlugin)
    const ssgi = viewer.getPlugin(SSGIPlugin)
    // todo add split to these
    const bloom = viewer.getPlugin(BloomPlugin)
    const temporalAA = viewer.getPlugin(TemporalAAPlugin)
    const dof = viewer.getPlugin(DepthOfFieldPlugin)
    const ssaa = viewer.getPlugin(SSAAPlugin)

    let ssreflEnabled = true
    let ssgiEnabled = true
    let ssaoEnabled = true

    if (x <= 0 || x >= 1 || !ppSplit.enabled) {
        ssrefl.pass.split = ssreflEnabled ? 0.01 : 1
        ssgi.pass.split = ssgiEnabled ? 0.01 : 1
        ssao.pass.split = ssaoEnabled ? 0.01 : 1
        ppSplit.splitLine.style.display = 'none'
        return
    }

    x = Math.max(0.01, x) // clamp to prevent shader recompile
    ssrefl.pass.split = x
    ssgi.pass.split = x
    ssao.pass.split = x
}

function setupSplit(viewer) {
    const splitLine = ppSplit.splitLine
    splitLine.classList.add('split-line')
    viewer.container.appendChild(splitLine)

    window.addEventListener('mousemove', (e) => {
        // if(!debugEnabled) return
        if (!ppSplit.enabled && splitLine.style.display === 'none') return

        const rect = viewer.canvas.getBoundingClientRect()
        let x = (e.clientX - rect.left) / rect.width
        // const y = 1-(e.clientY - rect.top) / rect.height
        ppSplit.x = x
        ppSplit.splitLine.style.display = x > 0 ? 'block' : 'none'
        updateSplit(viewer);
        splitLine.style.left = `${e.clientX - rect.left}px`
    })
    updateSplit(viewer);
}

function updateButtonsActiveState(viewer) {
    buttonBar?.update()
}

function addButtonBar(viewer) {
    buttonBar = createButtonRow(viewer.container, 'btn-bar', barButtons.map(button => ({
        ...button,
        action: () => button.action(viewer),
        active: () => button.active(viewer),
        visible: button.visible && (() => button.visible(viewer)),
    })))
}

window.setupViewer = setupViewer;

