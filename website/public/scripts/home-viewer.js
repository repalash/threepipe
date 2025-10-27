import * as THREE from 'https://unpkg.com/threepipe@0.4.2/dist/index.mjs';
// import {TweakpaneUiPlugin} from 'https://unpkg.com/@threepipe/plugin-tweakpane/dist/index.mjs';
import {
    BloomPlugin,
    DepthOfFieldPlugin,
    SSGIPlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    WatchHandsPlugin
} from 'https://unpkg.com/@threepipe/webgi-plugins/dist/index.mjs';
import {setupAbstract, teardownAbstract} from "./home-3d-abstract.js";
// import './home.css'
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
} = THREE;

let currentModel = null
const ppSplit = {splitLine: document.createElement('div'), enabled: false, x: 1}
const models = [
    {
        label: 'Watch',
        path: 'https://webgi.dev/watch-2.glb',
        bg: false,
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-watch-icon lucide-watch"><path d="M12 10v2.2l1.6 1"/><path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05"/><path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05"/><circle cx="12" cy="12" r="6"/></svg>',
        ground: true,
    },
    {
        label: 'City',
        path: 'https://webgi.dev/gi-city-2.glb',
        bg: false,
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-building2-icon lucide-building-2"><path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/></svg>',
        ground: false,
    },
    {
        label: 'Car',
        // path: 'https://webgi.dev/gi-city-8.glb',
        path: 'https://webgi.dev/car-scene.glb',
        bg: false,
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" style="transform: scaleX(-1);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-car-icon lucide-car"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>',
        ground: false,
    },
    {
        label: 'Robot',
        path: 'https://webgi.dev/robot-2.glb',
        bg: false,
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot-icon lucide-bot"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>',
        ground: true,
    },
    {
        label: 'Abstract',
        path: 'https://webgi.dev/lights-only-env.glb',
        bg: false,
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shapes-icon lucide-shapes"><path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/></svg>',
        ground: true,
    },
]
const barButtons = [{
    label: 'Toggle Ground',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrows-up-from-line-icon lucide-arrows-up-from-line"><path d="m4 6 3-3 3 3"/><path d="M7 17V3"/><path d="m14 6 3-3 3 3"/><path d="M17 17V3"/><path d="M4 21h16"/></svg>',
    action: (viewer) => {
        const ground = viewer.getPlugin(ContactShadowGroundPlugin)
        if(ground) {
            ground.mapMode = ground.mapMode === 'alphaMap' ? 'aoMap' : 'alphaMap'
        }
    },
    active: (viewer) => {
        const ground = viewer.getPlugin(ContactShadowGroundPlugin)
        return ground && ground.mapMode === 'aoMap'
    }
}, {
    label: 'Toggle webgi',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles-icon lucide-sparkles"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>',
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
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-moon-icon lucide-moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
// https://github.com/vuejs/vitepress/blob/c4909e4298ec706cf1762cb36af03e5fd3637ccc/src/client/theme-default/components/VPSwitchAppearance.vue#L45-L67
    action: (viewer) => {

        const css = document.createElement('style')
        css.type = 'text/css'
        css.appendChild(
            document.createTextNode(
                `:not(.dark-mode-btn):not(.dark-mode-btn *) {
  -webkit-transition: none !important;
  -moz-transition: none !important;
  -o-transition: none !important;
  -ms-transition: none !important;
  transition: none !important;
}`
            )
        )
        document.head.appendChild(css)

        document.documentElement.classList.toggle('dark')

        // @ts-expect-error keep unused declaration, used to force the browser to redraw
        const _ = window.getComputedStyle(css).opacity
        document.head.removeChild(css)

        // handleDarkMode(viewer)
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
    const btns = document.querySelectorAll('.model-tab')
    btns.forEach(b => b.classList.add('disabled'))
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
    btns.forEach(b => b.classList.remove('disabled'))
}

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

            await loadModel(viewer, model);
        })
        tabs.appendChild(tab)
    })
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
    const container = viewer.container
    const tabs = container.querySelector('.btn-bar')
    if(!tabs) return
    const tabDivs = tabs.querySelectorAll('.model-tab')
    barButtons.forEach((model, i) => {
        const tab = tabDivs[i]
        const active = model.active(viewer)
        if(active) {
            tab.classList.add('model-tab-selected')
        } else {
            tab.classList.remove('model-tab-selected')
        }

        if(model.label === 'Toggle Ground'){
            const ground = viewer.getPlugin(ContactShadowGroundPlugin)
            if(ground && currentModel && currentModel.ground){
                tab.style.display = 'flex'
            } else {
                tab.style.display = 'none'
            }
        }
    })
}

function addButtonBar(viewer) {
    const container = viewer.container
    const tabs = document.createElement('div')
    tabs.className = 'btn-bar'
    barButtons.forEach((model, i) => {
        const tab = document.createElement('div')
        tab.className = 'model-tab'
        tab.innerHTML = model.icon
        tab.title = model.label
        tab.className += model.className ? ` ${model.className}` : ''
        tab.addEventListener('click', async () => {
            model.action(viewer)
            updateButtonsActiveState(viewer)
        })
        tabs.appendChild(tab)
    })
    container.appendChild(tabs)
    updateButtonsActiveState(viewer)
}

setupViewer()
