// Live viewer of package/webgi-plugins, ported from the webgi.dev home page.
// Loaded by the WebgiShowcase theme component after the UMD builds of threepipe and @threepipe/webgi-plugins.
// Effects are turned on and off with the buttons on the viewer, the EffectToggle switches of the page sections,
// and by scrolling to a section. All three show the same state.
import {icons, createButtonRow, toggleDarkMode} from './viewer-controls.js'

const {
    ThreeViewer,
    LoadingScreenPlugin,
    GBufferPlugin,
    ContactShadowGroundPlugin,
    SSAAPlugin,
    PickingPlugin,
    SSAOPlugin,
    InteractionPromptPlugin,
    CameraViewPlugin,
    getUrlQueryParam,
    NoiseBumpMaterialPlugin,
    TonemapPlugin,
} = window.threepipe;
const {
    BloomPlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    DepthOfFieldPlugin,
    SSGIPlugin,
    WatchHandsPlugin,
} = window['@threepipe/webgi-plugins'];

// bg: the model has its own background (no dark mode colors); ground: show the ground button
const models = [
    {label: 'Watch', path: 'https://samples.threepipe.org/demos/classic-watch.glb', icon: icons.watch, ground: true},
    {label: 'Robot', path: 'https://samples.threepipe.org/demos/webgi/robot.glb', icon: icons.bot, bg: true},
    {label: 'City', path: 'https://samples.threepipe.org/demos/webgi/gi-city-2.glb', icon: icons.building},
    {label: 'Car', path: 'https://samples.threepipe.org/demos/webgi/car-scene.glb', icon: icons.car},
    {label: 'Engine', path: 'https://samples.threepipe.org/demos/webgi/engine-ssr-compressed.glb', icon: icons.cog, bg: true},
]

// effects of the switch in each page section
const sectionEffects = {
    'basic-rendering-section': ['aa', 'ssao', 'ssr', 'ssgi', 'bloom'],
    'ssaa-taa-plugin': ['aa'],
    'ssrefl-plugin': ['ssr', 'ssao'],
    'bloom-plugin': ['bloom'],
    'dof-plugin': ['dof'],
}

function isVisible(id) {
    const rect1 = document.getElementById(id)?.getBoundingClientRect();
    const viewHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
    return !rect1 ? false : (rect1.bottom >= 0 && rect1.top < viewHeight);
}

// Returns a function that disposes the viewer and removes every listener.
export function setupWebgiShowcase(canvas) {
    const state = {disposed: false, cleanups: []}
    state.onCleanup = (f) => state.disposed ? f() : state.cleanups.push(f)
    init(canvas, state).catch((e) => {
        if (!state.disposed) console.error(e)
    })
    return () => {
        state.disposed = true
        for (const f of state.cleanups.splice(0).reverse()) {
            try {
                f()
            } catch (e) {
                console.warn(e)
            }
        }
    }
}

async function init(canvas, state) {
    const viewer = new ThreeViewer({
        canvas,
        msaa: false,
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
            ContactShadowGroundPlugin, PickingPlugin, LoadingScreenPlugin,
        ],
    });
    state.onCleanup(() => viewer.dispose())

    viewer.serializePluginsIgnored = [LoadingScreenPlugin.PluginType]
    const loading = viewer.getPlugin(LoadingScreenPlugin)
    loading.logoImage = ''
    loading.minimizeOnSceneObjectLoad = false
    loading.showFileNames = false
    loading.backgroundOpacity = 1
    loading.loadingTextHeader = 'Loading'

    const wh = viewer.addPluginSync(WatchHandsPlugin)
    wh.invertAxis = true
    wh.hourOffset = 10
    wh.minuteOffset = 7
    wh.secondOffset = 38
    wh.analog = false

    const ssao = viewer.getPlugin(SSAOPlugin)
    const ssaa = viewer.getPlugin(SSAAPlugin)
    const ground = viewer.getPlugin(ContactShadowGroundPlugin)
    const prompt = viewer.getPlugin(InteractionPromptPlugin)

    const ssrefl = viewer.getPlugin(SSReflectionPlugin)
    const ssgi = viewer.getPlugin(SSGIPlugin)
    const bloom = viewer.getPlugin(BloomPlugin)
    const temporalAA = viewer.getPlugin(TemporalAAPlugin)
    const dof = viewer.getPlugin(DepthOfFieldPlugin)

    // SSR, SSGI and SSAO are switched with pass.split (1 = off) instead of enabled, to prevent a shader recompile
    const splitOn = {ssr: true, ssgi: true, ssao: true}
    const splitPasses = {ssr: ssrefl, ssgi, ssao}
    function setSplit(key, v) {
        splitOn[key] = v
        splitPasses[key].pass.split = v ? 0.01 : 1
        if (v) splitPasses[key].enabled = true // a model file can disable the plugin
    }

    const effects = {
        aa: {text: 'AA', label: 'Anti-aliasing (SSAAPlugin + TemporalAAPlugin)',
            get: () => ssaa.enabled && temporalAA.enabled,
            set: (v) => { ssaa.enabled = v; temporalAA.enabled = v }},
        ssao: {text: 'SSAO', label: 'Ambient occlusion (SSAOPlugin)',
            get: () => ssao.enabled && splitOn.ssao, set: (v) => setSplit('ssao', v)},
        ssr: {text: 'SSR', label: 'Screen space reflections (SSReflectionPlugin)',
            get: () => ssrefl.enabled && splitOn.ssr, set: (v) => setSplit('ssr', v)},
        ssgi: {text: 'SSGI', label: 'Screen space global illumination (SSGIPlugin)',
            get: () => ssgi.enabled && splitOn.ssgi, set: (v) => setSplit('ssgi', v)},
        bloom: {text: 'Bloom', label: 'HDR bloom (BloomPlugin)',
            get: () => bloom.enabled, set: (v) => { bloom.enabled = v }},
        dof: {text: 'DoF', label: 'Depth of field (DepthOfFieldPlugin). Click the model to focus.',
            get: () => dof.enabled, set: (v) => { dof.enabled = v; dof.enableEdit = v }},
    }

    // the switches of the page sections, found by the id given to EffectToggle
    const switches = Object.fromEntries(Object.keys(sectionEffects).map(section => {
        const elem = document.getElementById(section + '-toggle')?.querySelector('input')
        return elem ? [section, elem] : null
    }).filter(v => v))

    let currentModel = models[0]
    let effectBar = null
    let modelTabs = null
    let buttonBar = null
    function refresh() {
        effectBar?.update()
        modelTabs?.update()
        buttonBar?.update()
        for (const [section, elem] of Object.entries(switches))
            elem.checked = sectionEffects[section].every(key => effects[key].get())
    }
    function setEffects(keys, v) {
        keys.forEach(key => effects[key].set(v))
        refresh()
    }

    for (const [section, elem] of Object.entries(switches)) {
        const onChange = () => setEffects(sectionEffects[section], elem.checked)
        elem.addEventListener('change', onChange)
        state.onCleanup(() => elem.removeEventListener('change', onChange))
    }

    const handleDarkModeChange = handleDarkMode(viewer, state, () => buttonBar?.update())

    // effect buttons, at the top
    effectBar = createButtonRow(viewer.container, 'effect-bar', Object.entries(effects).map(([key, effect]) => ({
        label: effect.label,
        text: effect.text,
        className: 'effect-btn',
        action: () => setEffects([key], !effect.get()),
        active: effect.get,
    })))

    // ground and dark mode, bottom right
    buttonBar = createButtonRow(viewer.container, 'btn-bar', [{
        label: 'Toggle Ground',
        icon: icons.ground,
        action: () => { ground.mapMode = ground.mapMode === 'alphaMap' ? 'aoMap' : 'alphaMap' },
        active: () => ground.mapMode === 'aoMap',
        visible: () => !!currentModel?.ground,
    }, {
        label: 'Toggle Dark Mode',
        className: 'dark-mode-btn',
        icon: icons.moon,
        action: () => toggleDarkMode(),
        active: () => document.documentElement.classList.contains('dark'),
    }])

    // models, bottom center
    async function loadModel(model) {
        currentModel = model
        modelTabs.setDisabled(true)
        buttonBar.setDisabled(true)
        refresh()
        try {
            viewer.scene.disposeSceneModels()
            await viewer.load(model.path, {
                autoCenter: true,
                autoScale: true,
            });
            if (state.disposed) return
            if (!model.path.includes('car'))
                viewer.fitToView(undefined, 1.5)
            if (!model.bg)
                handleDarkModeChange()
        } finally {
            if (!state.disposed) {
                modelTabs.setDisabled(false)
                buttonBar.setDisabled(false)
                refresh() // a model file can carry plugin settings
            }
        }
    }
    modelTabs = createButtonRow(viewer.container, 'model-tabs', models.map(model => ({
        label: model.label,
        icon: model.icon,
        action: () => currentModel === model ? undefined : loadModel(model),
        active: () => currentModel === model,
    })))

    effects.ssr.set(true)
    effects.ssgi.set(true)
    effects.ssao.set(true)

    viewer.deleteImportedViewerConfigOnLoad = false
    viewer.renderManager.stableNoise = true;
    await loadModel(models[0])
    if (state.disposed) return
    ground.size = 20

    // split line of the "Play around" section: post-processing on the right side of the pointer
    const splitLine = document.createElement('div')
    splitLine.className = 'split-line'
    viewer.container.appendChild(splitLine)

    const onMouseMove = (e) => {
        if (!isVisible('play-around-section')) {
            if (splitLine.style.display === 'none') return
            for (const key of Object.keys(splitPasses)) splitPasses[key].pass.split = splitOn[key] ? 0.01 : 1
            splitLine.style.display = 'none'
            return
        }

        const rect = viewer.canvas.getBoundingClientRect()
        let x = (e.clientX - rect.left) / rect.width

        splitLine.style.display = x > 0 ? 'block' : 'none'
        splitLine.style.left = `${e.clientX - rect.left}px`

        x = Math.max(0.01, x) // clamp to prevent shader recompile
        for (const key of Object.keys(splitPasses)) if (splitOn[key]) splitPasses[key].pass.split = x
    }
    window.addEventListener('mousemove', onMouseMove)
    state.onCleanup(() => window.removeEventListener('mousemove', onMouseMove))

    // scrolling to a section turns its effects on (wide screens only; on narrow screens the buttons still work)
    const sections = {
        'quickstart-top': () => setEffects(sectionEffects['basic-rendering-section'], true),
        'basic-rendering-section': () => setEffects(['dof', ...sectionEffects['basic-rendering-section']], false),
        'ssaa-taa-plugin': () => setEffects(sectionEffects['ssaa-taa-plugin'], true),
        'ssrefl-plugin': () => setEffects(sectionEffects['ssrefl-plugin'], true),
        'bloom-plugin': () => {
            setEffects(sectionEffects['bloom-plugin'], true)
            if (!prompt.animationRunning) prompt.startAnimation();
        },
        'dof-plugin': () => {
            setEffects(sectionEffects['dof-plugin'], true)
            if (!prompt.animationRunning) prompt.startAnimation();
        },
    }

    setEffects(['dof'], false)
    setEffects(sectionEffects['basic-rendering-section'], true)

    const observer = new IntersectionObserver((entries) => {
        if (window.innerWidth <= 640) return
        entries.filter(entry => !!entry.isIntersecting)
            .map(f => f?.target.id && sections[f.target.id]?.());
    }, {
        root: null, // Default to the viewport
        threshold: 0.5, // At least 50% of the element must be visible
    });
    Object.keys(sections).forEach(section => {
        const elem = document.getElementById(section)
        if (elem) observer.observe(elem)
    });
    state.onCleanup(() => observer.disconnect())
}

function handleDarkMode(viewer, state, onChange) {
    const loading = viewer.getPlugin(LoadingScreenPlugin)
    const ground = viewer.getPlugin(ContactShadowGroundPlugin)

    function setMode(dark) {
        viewer.getPlugin(TonemapPlugin).tonemapBackground = false
        if (dark) {
            viewer.scene.setBackgroundColor('#1B1B1F')
            loading.background = '#1B1B1F'
            loading.textColor = '#eeeeee'
            ground.material.color.set('#1B1B1F')
            ground.material.roughness = 0.45;
            ground.material.metalness = 1;
            ground.material.userData.separateEnvMapIntensity = true
            ground.material.envMapIntensity = 0
        } else {
            viewer.scene.setBackgroundColor('#FFFFFF')
            loading.background = '#FFFFFF'
            loading.textColor = '#222222'
            ground.material.color.set('#FFFFFF')
            ground.material.roughness = 0.25;
            ground.material.metalness = 0.7820321917322556;
            ground.material.userData.separateEnvMapIntensity = false
            ground.material.envMapIntensity = 1
        }
    }

    function handleDarkModeChange() {
        setMode(document.documentElement.classList.contains('dark'))
    }

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                handleDarkModeChange();
                onChange()
            }
        })
    })
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
    });
    state.onCleanup(() => observer.disconnect())
    handleDarkModeChange(); // initial
    return handleDarkModeChange
}

window.setupWebgiShowcase = setupWebgiShowcase;
