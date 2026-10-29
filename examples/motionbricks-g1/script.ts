import {
    _testFinish,
    _testStart,
    Color,
    IObject3D,
    GBufferPlugin,
    HDRiGroundPlugin,
    Mesh,
    PCFSoftShadowMap,
    PhysicalMaterial,
    Plane,
    Raycaster,
    RingGeometry,
    SSAAPlugin,
    TonemapPlugin,
    ThreeViewer,
    UnlitMaterial,
    UnsignedByteType,
    Vector2,
    Vector3,
} from 'threepipe'
import {
    BloomPlugin,
    SSContactShadowsPlugin,
    SSGIPlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    VelocityBufferPlugin,
} from '@threepipe/webgi-plugins'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {G1Gait, MOTIONBRICKS_DEFAULTS, MotionBricksCharacter} from 'three-motionbricks'
import {G1Stage, STAGE_STYLES, StageStyleName} from './G1Stage'

// Real-time motion generation in the browser with NVIDIA MotionBricks (https://github.com/NVlabs/motionbricks),
// through the three-motionbricks library (plugins/three-motionbricks), which works with any three.js scene.
// Click the floor to send the robot there, or drive it with WASD; the model generates every step on the way.
// Pages can override the sources with window.MOTIONBRICKS_CONFIG, and URL parameters override both:
// ?model=<folder with pack.json/ or .onnx url>&robot=<mjcf url>&backend=webgpu&style=studio&fx=0&ui=0&worker=0

const config = {
    /** onnxruntime-web module, model and robot GLB. Empty uses the library's defaults (MOTIONBRICKS_DEFAULTS). */
    ort: '',
    /** Optional parts of the ORT .wasm file, joined in order, for hosts that limit file size. */
    wasm: undefined as string[] | undefined,
    /** A folder with pack.json from tools/pack_model.py, or an original MotionBricks G1 .onnx file. */
    model: '',
    robot: '',
    /** Scene style from G1Stage.ts: research, grid, studio, stage or hangar. */
    style: 'research',
    /** Where the styles' HDR files are, with a suffix for hosts that rename them. Poly Haven by default. */
    environmentBase: '',
    environmentSuffix: '',
    /** Screen-space reflections, GI, contact shadows, TAA and bloom. 0 turns them off. */
    fx: '1',
    /** The Tweakpane panel for lighting and render options. 0 hides it. */
    ui: '1',
    /** Run the model in a Web Worker. 0 runs it on the page, which stalls rendering during each generation. */
    worker: '1',
    /** wasm, or webgpu (with onnxruntime-web 1.30 WebGPU computes this model wrongly). */
    backend: 'wasm',
    ...(window as any).MOTIONBRICKS_CONFIG,
}
const params = new URLSearchParams(location.search)
for (const key of ['model', 'robot', 'backend', 'style', 'fx', 'ui', 'worker'] as const) if (params.get(key)) config[key] = params.get(key)!

const $ = (id: string) => document.getElementById(id)

function setStatus(text: string, state: 'loading' | 'ready' | 'error' = 'loading', progress?: number) {
    const status = $('mb-status')
    if (status) {
        status.textContent = text
        status.dataset.state = state
    }
    const bar = $('mb-progress') as HTMLElement | null
    if (bar) {
        bar.hidden = progress === undefined
        bar.style.setProperty('--progress', String(progress ?? 0))
    }
}

function themeColor(name: string, fallback: string) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return new Color(v || fallback)
}

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: true,
        zPrepass: false,
        renderScale: 'auto',
        maxRenderScale: 1.5,
        dropzone: false,
        plugins: [GBufferPlugin, SSAAPlugin, TemporalAAPlugin, new VelocityBufferPlugin(UnsignedByteType, true),
            SSReflectionPlugin, SSGIPlugin, SSContactShadowsPlugin, BloomPlugin, HDRiGroundPlugin],
    })
    viewer.renderManager.renderer.shadowMap.type = PCFSoftShadowMap
    viewer.renderManager.stableNoise = true

    viewer.getPlugin(SSGIPlugin)!.pass.stepCount = 8

    // The look of the scene: floor, backdrop, environment, lights and effect strengths (see G1Stage.ts).
    const stage = new G1Stage(viewer, name => config.environmentBase ?
        config.environmentBase + name + config.environmentSuffix :
        `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${name.match(/_(\d+k)\.hdr$/)?.[1] ?? '1k'}/${name}`)
    // The page's Effects button and Scene menu, and the Tweakpane panel, all drive the stage and follow it.
    const styleSelect = $('mb-style') as HTMLSelectElement | null
    stage.onChange = () => {
        $('mb-fx')?.setAttribute('aria-pressed', String(stage.effectsEnabled))
        if (styleSelect) styleSelect.value = stage.styleName
    }
    stage.effectsEnabled = config.fx !== '0'
    $('mb-fx')?.addEventListener('click', () => stage.setEffects(!stage.effectsEnabled))
    if (styleSelect) {
        styleSelect.replaceChildren(...Object.entries(STAGE_STYLES).map(([k, st]) => new Option(st.label, k)))
        styleSelect.addEventListener('change', async() => stage.setStyle(styleSelect.value as StageStyleName))
    }
    await stage.setStyle((config.style in STAGE_STYLES ? config.style : 'research') as StageStyleName)

    const goalMaterial = new UnlitMaterial({color: themeColor('--accent', '#e8590c'), transparent: true, opacity: 0.9, depthWrite: false})
    const goalMarker = new Mesh(new RingGeometry(0.16, 0.22, 48).rotateX(-Math.PI / 2), goalMaterial)
    goalMarker.visible = false
    goalMarker.name = 'Goal'
    viewer.scene.addObject(goalMarker)

    const camera = viewer.scene.mainCamera
    camera.position.set(3.2, 1.9, 4.2)
    camera.target.set(0, 0.75, 0)
    camera.setDirty()

    // The character from three-motionbricks. threepipe loads its robot GLB like any model, with PhysicalMaterials
    // the panel can edit. A host that renames files (to .wasm) gets the GLB as a File named .glb.
    const g1 = new MotionBricksCharacter({
        ort: config.ort || undefined,
        wasm: config.wasm,
        model: config.model || undefined,
        backend: config.backend === 'webgpu' ? 'webgpu' : 'wasm',
        worker: config.worker !== '0',
    })
    g1.onError = e => setStatus(`Generation failed: ${e instanceof Error ? e.message : e}`, 'error')
    setStatus('Loading the robot…', 'loading')
    const robotUrl = config.robot || MOTIONBRICKS_DEFAULTS.robot
    const robotAsset = /\.(glb|gltf)$/i.test(robotUrl.split(/[?#]/)[0]) ? robotUrl :
        new File([await (await fetch(robotUrl)).arrayBuffer()], 'unitree_g1.glb')
    const robotModel = await viewer.import<IObject3D>(robotAsset)
    if (!robotModel) throw new Error('Could not load the robot model')
    const robot = g1.setRobot(robotModel)
    viewer.scene.addObject(g1.object)

    // A Tweakpane panel for the lighting and render options, in the clean theme that follows light or dark mode.
    if (config.ui !== '0') {
        const dark = (document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'
        const ui = viewer.addPluginSync(new TweakpaneUiPlugin(!matchMedia('(max-width: 720px)').matches, true, undefined, dark ? 'clean-dark' : 'clean'))
        ui.appendChild(stage.uiConfig)
        ui.appendChild({type: 'folder', label: 'Robot', children: robot.materials.map(m => (m as PhysicalMaterial).uiConfig)})
        ui.setupPlugins(TonemapPlugin, SSGIPlugin, SSReflectionPlugin, SSContactShadowsPlugin, BloomPlugin, TemporalAAPlugin, HDRiGroundPlugin)
    }
    viewer.setDirty()
    ;(window as any).motionbricks = {viewer, g1, robot, stage}

    let wander = true
    let idleTime = 0
    let gait: G1Gait = 'walk'

    const gaitButtons = {walk: $('mb-walk'), run: $('mb-run')}
    const wanderButton = $('mb-wander')
    const syncButtons = () => {
        for (const g of ['walk', 'run'] as G1Gait[]) gaitButtons[g]?.setAttribute('aria-pressed', String(gait === g))
        wanderButton?.setAttribute('aria-pressed', String(wander))
    }
    syncButtons()
    const setGait = (g: G1Gait) => {
        gait = g
        g1.gait = g
        const goal = g1.getGoal()
        if (goal && g1.ready) g1.moveTo(goal, g)
        syncButtons()
    }
    gaitButtons.walk?.addEventListener('click', () => setGait('walk'))
    gaitButtons.run?.addEventListener('click', () => setGait('run'))
    wanderButton?.addEventListener('click', () => {
        wander = !wander
        idleTime = 0
        syncButtons()
    })
    $('mb-stop')?.addEventListener('click', () => {
        wander = false
        g1.stop()
        syncButtons()
    })

    // A click on the floor (not a drag of the camera) sets the goal.
    const canvas = viewer.canvas
    const down = new Vector2()
    let downTime = 0
    canvas.addEventListener('pointerdown', e => {
        down.set(e.clientX, e.clientY)
        downTime = performance.now()
    })
    canvas.addEventListener('pointerup', e => {
        if (!g1.ready || down.distanceTo(new Vector2(e.clientX, e.clientY)) > 6 || performance.now() - downTime > 500) return
        const rect = canvas.getBoundingClientRect()
        const ndc = new Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1)
        const raycaster = new Raycaster()
        raycaster.setFromCamera(ndc, camera as any)
        const hit = raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())
        if (!hit) return
        wander = false
        syncButtons()
        g1.moveTo(hit, gait)
    })

    // WASD or the arrow keys drive the robot relative to the camera; Shift runs while held.
    const driveKeys: Record<string, [number, number]> = {
        KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
        KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
    }
    const keys = new Set<string>()
    let shift = false
    window.addEventListener('keydown', e => {
        if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
        shift = e.shiftKey
        if (!driveKeys[e.code]) return
        keys.add(e.code)
        e.preventDefault()
    })
    window.addEventListener('keyup', e => {
        shift = e.shiftKey
        keys.delete(e.code)
    })
    window.addEventListener('blur', () => keys.clear())
    const forward = new Vector3(), right = new Vector3(), direction = new Vector3()
    const steer = () => {
        let ix = 0, iy = 0
        for (const k of keys) {
            ix += driveKeys[k][0]
            iy += driveKeys[k][1]
        }
        if (!ix && !iy) return g1.drive(null)
        forward.copy(camera.target).sub(camera.position).setY(0).normalize()
        right.crossVectors(forward, camera.up)
        direction.copy(forward).multiplyScalar(iy).addScaledVector(right, ix)
        if (wander) {
            wander = false
            syncButtons()
        }
        g1.drive(direction, shift ? 'run' : gait)
    }

    // Follow the robot with the camera, keeping the user's orbit.
    const follow = new Vector3()
    let last = performance.now()
    viewer.addEventListener('preFrame', () => {
        const now = performance.now()
        const dt = Math.min((now - last) / 1000, 0.1)
        last = now
        stage.update(camera.target)
        if (!g1.ready) return
        steer()
        g1.update(dt)
        const goal = g1.getGoal(goalMarker.position)
        goalMarker.visible = !!goal
        if (goal) {
            goalMarker.position.y = 0.003
            goalMarker.scale.setScalar(1 + 0.12 * Math.sin(now / 220))
        }
        const delta = g1.getPosition(follow).setY(0.75).sub(camera.target).multiplyScalar(1 - Math.exp(-dt * 2.5))
        camera.target.add(delta)
        camera.position.add(delta)
        camera.setDirty()
        // threepipe redraws shadow maps only when the scene changes, and the robot moves every frame.
        viewer.renderManager.resetShadows()
        viewer.setDirty()

        // Optional strip of the segment being played: the playhead and where the next one takes over.
        const strip = $('mb-timeline')
        const p = g1.playback
        if (strip) {
            strip.dataset.active = String(!!p)
            if (p) {
                strip.style.setProperty('--played', (p.frame / (p.frames - 1)).toFixed(3))
                strip.style.setProperty('--transition', (p.transition / (p.frames - 1)).toFixed(3))
                // A segment of n tokens has 4n - 6 frames once the boundary frames are removed.
                strip.style.setProperty('--tokens', String((p.frames + 6) / 4))
            }
        }

        if (g1.idle) {
            idleTime += dt
            if (wander && idleTime > 1.2) {
                idleTime = 0
                // Pick a point 2.5 to 6 m away that stays within 7 m of the origin.
                const at = g1.getPosition()
                const angle = Math.random() * Math.PI * 2
                const d = 2.5 + Math.random() * 3.5
                const to = new Vector3(at.x + Math.cos(angle) * d, 0, at.z + Math.sin(angle) * d)
                if (to.length() > 7) to.copy(at).setLength(Math.max(0, at.length() - 4))
                g1.moveTo(to, gait)
            }
        } else idleTime = 0
    })

    // The model: about 190 MB packed, or 730 MB as the original fp32 ONNX file. The library runs it in a
    // worker, so inference never stalls the frames (a stall mid-walk shows as a limp).
    await g1.load((step, loaded, total) => {
        if (step === 'model') setStatus(`Downloading the model… ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6) || '?'} MB`, 'loading', total ? loaded / total : 0)
        else if (step === 'runtime') setStatus('Loading ONNX Runtime…', 'loading', 0)
        else if (step === 'warmup') setStatus('Warming up…', 'loading')
    })
    const backendLabel = (g1.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly') + ((g1.engine as any)?.worker ? ' (worker)' : '')
    if ($('mb-backend')) $('mb-backend')!.textContent = backendLabel
    setStatus('Ready. Click the floor to send the robot there.', 'ready')
    setInterval(() => {
        const s = g1.stats!
        if ($('mb-latency')) $('mb-latency')!.textContent = s.generations ? `${Math.round(s.averageInferenceMs)} ms` : '–'
        if ($('mb-tokens')) $('mb-tokens')!.textContent = s.generations ? `${(s.lastTokenCount * 4 / 30).toFixed(1)} s · ${s.lastTokenCount} tok` : '–'
        if ($('mb-count')) $('mb-count')!.textContent = String(s.generations)
    }, 250)
    ;(window as any).motionbricks = {viewer, g1, robot, stage, controller: g1.controller, engine: g1.engine}
}

_testStart()
init().catch(e => {
    console.error(e)
    setStatus(`Could not start: ${e instanceof Error ? e.message : e}`, 'error')
}).finally(_testFinish)
