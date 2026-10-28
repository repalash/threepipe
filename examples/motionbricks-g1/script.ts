import {
    _testFinish,
    _testStart,
    Color,
    GBufferPlugin,
    HDRiGroundPlugin,
    Mesh,
    PCFSoftShadowMap,
    Plane,
    Raycaster,
    RingGeometry,
    SSAAPlugin,
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
import {MotionBricksG1, OrtApi} from './MotionBricksG1'
import {G1Controller, G1Gait, GAIT_SPEEDS} from './G1Controller'
import {G1Robot} from './G1Robot'
import {G1_BRICKS} from './G1Bricks'
import {G1Stage, STAGE_STYLES, StageStyleName} from './G1Stage'

// Real-time motion generation in the browser with NVIDIA MotionBricks (https://github.com/NVlabs/motionbricks).
// ONNX Runtime Web runs the Unitree G1 model with WebGPU, or WebAssembly where WebGPU is unavailable.
// Click the floor to send the robot there; the model generates every step on the way.
// Pages can override the sources with window.MOTIONBRICKS_CONFIG, and URL parameters override both:
// ?model=<folder with pack.json/ or .onnx url>&robot=<mjcf url>&backend=wasm&style=studio&fx=0

const NV = 'https://media.githubusercontent.com/media/NVlabs/motionbricks/main/motionbricks/assets'
const config = {
    /**
     * onnxruntime-web module. The default build has WebGPU (JSEP) and every WebAssembly kernel the original
     * model needs. ort.webgpu.min.mjs also works, with models from tools/pack_model.py only.
     */
    ort: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.min.mjs',
    /** Optional parts of the ORT .wasm file, joined in order, for hosts that limit file size. */
    wasm: undefined as string[] | undefined,
    /** A folder with pack.json from tools/pack_model.py, or an original MotionBricks G1 .onnx file. */
    model: NV + '/onnx/unitree_g1/mmm_v6_g1_fp32.onnx',
    robot: NV + '/robots/unitree_g1/g1_29dof_rev_1_0.xml',
    /** Scene style from G1Stage.ts: research, grid, studio, stage or hangar. */
    style: 'research',
    /** Where the styles' HDR files are, with a suffix for hosts that rename them. Poly Haven by default. */
    environmentBase: '',
    environmentSuffix: '',
    /** Screen-space reflections, GI, contact shadows, TAA and bloom. 0 turns them off. */
    fx: '1',
    /** webgpu, or wasm to skip WebGPU. */
    backend: 'webgpu',
    ...(window as any).MOTIONBRICKS_CONFIG,
}
const params = new URLSearchParams(location.search)
for (const key of ['model', 'robot', 'backend', 'style', 'fx'] as const) if (params.get(key)) config[key] = params.get(key)!

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

async function loadOrt(): Promise<OrtApi & {env: any}> {
    const ort = await import(/* @vite-ignore */ new URL(config.ort, location.href).href)
    ort.env.logLevel = 'error'
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
    if (config.wasm?.length) {
        const parts = await Promise.all(config.wasm.map(async(u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer())))
        const binary = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
        parts.reduce((o, p) => (binary.set(p, o), o + p.length), 0)
        ort.env.wasm.wasmBinary = binary.buffer
    }
    return ort
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
    const temporal = [viewer.getPlugin(TemporalAAPlugin)!, viewer.getPlugin(VelocityBufferPlugin)!]
    const setEffects = (on: boolean) => {
        stage.setEffects(on)
        for (const p of temporal) p.enabled = on
        $('mb-fx')?.setAttribute('aria-pressed', String(on))
    }
    stage.effectsEnabled = config.fx !== '0'
    $('mb-fx')?.addEventListener('click', () => setEffects(!stage.effectsEnabled))
    const styleName = (config.style in STAGE_STYLES ? config.style : 'research') as StageStyleName
    const styleSelect = $('mb-style') as HTMLSelectElement | null
    if (styleSelect) {
        styleSelect.replaceChildren(...Object.entries(STAGE_STYLES).map(([k, st]) => new Option(st.label, k, false, k === styleName)))
        styleSelect.addEventListener('change', () => {
            stage.apply(STAGE_STYLES[styleSelect.value as StageStyleName]).then(() => setEffects(stage.effectsEnabled))
        })
    }
    await stage.apply(STAGE_STYLES[styleName])
    setEffects(stage.effectsEnabled)

    const goalMaterial = new UnlitMaterial({color: themeColor('--accent', '#e8590c'), transparent: true, opacity: 0.9, depthWrite: false})
    const goalMarker = new Mesh(new RingGeometry(0.16, 0.22, 48).rotateX(-Math.PI / 2), goalMaterial)
    goalMarker.position.y = 0.003
    goalMarker.visible = false
    goalMarker.name = 'Goal'
    viewer.scene.addObject(goalMarker)

    const camera = viewer.scene.mainCamera
    camera.position.set(3.2, 1.9, 4.2)
    camera.target.set(0, 0.75, 0)
    camera.setDirty()

    setStatus('Loading the robot…', 'loading', 0)
    const robot = await G1Robot.Load(config.robot, (n, total) => setStatus('Loading the robot…', 'loading', n / total))
    viewer.scene.addObject(robot.object)
    robot.setPose(G1_BRICKS.rest[0])
    viewer.setDirty()
    ;(window as any).motionbricks = {viewer, robot, stage}

    let controller: G1Controller | null = null
    let gait: G1Gait = 'walk'
    let wander = true
    let idleTime = 0

    const gaitButtons = {walk: $('mb-walk'), run: $('mb-run')}
    const wanderButton = $('mb-wander')
    const syncButtons = () => {
        for (const g of ['walk', 'run'] as G1Gait[]) gaitButtons[g]?.setAttribute('aria-pressed', String(gait === g))
        wanderButton?.setAttribute('aria-pressed', String(wander))
    }
    syncButtons()
    const setGait = (g: G1Gait) => {
        gait = g
        if (controller) {
            controller.gait = g
            if (controller.goal) controller.moveTo(controller.goal[0], controller.goal[1], g)
        }
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
        controller?.stop()
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
        if (!controller || down.distanceTo(new Vector2(e.clientX, e.clientY)) > 6 || performance.now() - downTime > 500) return
        const rect = canvas.getBoundingClientRect()
        const ndc = new Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1)
        const raycaster = new Raycaster()
        raycaster.setFromCamera(ndc, camera as any)
        const hit = raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())
        if (!hit) return
        wander = false
        syncButtons()
        controller.moveTo(...G1Robot.ToG1(hit), gait)
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
    const drive = {active: false, angle: 0, gait: 'walk' as G1Gait}
    const viewDir = new Vector3()
    const steer = (c: G1Controller) => {
        let ix = 0, iy = 0
        for (const k of keys) {
            ix += driveKeys[k][0]
            iy += driveKeys[k][1]
        }
        if (!ix && !iy) {
            if (drive.active) c.stop()
            drive.active = false
            return
        }
        // The camera's forward and right on the ground, in G1 space (x, -z of threepipe space).
        viewDir.copy(camera.target).sub(camera.position)
        const [fx, fy] = G1Robot.ToG1(viewDir)
        const f = Math.hypot(fx, fy) || 1
        const angle = Math.atan2(iy * fy / f - ix * fx / f, iy * fx / f + ix * fy / f)
        const g: G1Gait = shift ? 'run' : gait
        const ahead = GAIT_SPEEDS[g] * c.lead + 4
        const goalX = c.pose[0] + Math.cos(angle) * ahead, goalY = c.pose[1] + Math.sin(angle) * ahead
        const turn = Math.abs(Math.atan2(Math.sin(angle - drive.angle), Math.cos(angle - drive.angle)))
        if (!drive.active || g !== drive.gait || turn > 0.35) {
            // A new direction or gait generates now; small changes steer the goal at the next transition.
            Object.assign(drive, {active: true, angle, gait: g})
            if (wander) {
                wander = false
                syncButtons()
            }
            c.moveTo(goalX, goalY, g)
        } else c.goal = [goalX, goalY]
    }

    // Follow the robot with the camera, keeping the user's orbit.
    const follow = new Vector3()
    let last = performance.now()
    viewer.addEventListener('preFrame', () => {
        const now = performance.now()
        const dt = Math.min((now - last) / 1000, 0.1)
        last = now
        if (!controller) return
        steer(controller)
        controller.update(dt)
        robot.setPose(controller.pose)
        const goal = controller.goal
        goalMarker.visible = !!goal
        if (goal) {
            G1Robot.FromG1(goal[0], goal[1], 0.003, goalMarker.position)
            goalMarker.scale.setScalar(1 + 0.12 * Math.sin(now / 220))
        }
        G1Robot.FromG1(controller.pose[0], controller.pose[1], 0.75, follow)
        const delta = follow.sub(camera.target).multiplyScalar(1 - Math.exp(-dt * 2.5))
        camera.target.add(delta)
        camera.position.add(delta)
        camera.setDirty()
        stage.update(camera.target)
        // threepipe redraws shadow maps only when the scene changes, and the robot moves every frame.
        viewer.renderManager.resetShadows()
        viewer.setDirty()

        // Optional strip of the segment being played: the playhead and where the next one takes over.
        const strip = $('mb-timeline')
        const p = controller.playback
        if (strip) {
            strip.dataset.active = String(!!p)
            if (p) {
                strip.style.setProperty('--played', (p.frame / (p.frames - 1)).toFixed(3))
                strip.style.setProperty('--transition', (p.transition / (p.frames - 1)).toFixed(3))
                // A segment of n tokens has 4n - 6 frames once the boundary frames are removed.
                strip.style.setProperty('--tokens', String((p.frames + 6) / 4))
            }
        }

        if (!controller.moving && !controller.generating && !controller.goal) {
            idleTime += dt
            if (wander && idleTime > 1.2) {
                idleTime = 0
                const angle = Math.random() * Math.PI * 2
                const [x, y] = [controller.pose[0], controller.pose[1]]
                // Pick a point 2.5 to 6 m away that stays within 7 m of the origin.
                let d = 2.5 + Math.random() * 3.5
                let tx = x + Math.cos(angle) * d, ty = y + Math.sin(angle) * d
                if (Math.hypot(tx, ty) > 7) {
                    d = Math.hypot(x, y)
                    tx = x - x / d * 4
                    ty = y - y / d * 4
                }
                controller.moveTo(tx, ty, gait)
            }
        } else idleTime = 0
    })

    // The model: about 190 MB packed, or 730 MB as the original fp32 ONNX file.
    setStatus('Loading ONNX Runtime…', 'loading', 0)
    const ort = await loadOrt()
    const useGpu = config.backend !== 'wasm' && 'gpu' in navigator
    const sessionOptions = {executionProviders: useGpu ? ['webgpu', 'wasm'] : ['wasm'], graphOptimizationLevel: 'all'}
    const progress = (loaded: number, total: number) => setStatus(
        `Downloading the model… ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6) || '?'} MB`, 'loading', total ? loaded / total : 0)
    const engine = config.model.endsWith('/')
        ? await MotionBricksG1.LoadPacked(ort, config.model, sessionOptions, progress)
        : await MotionBricksG1.LoadOnnx(ort, config.model, sessionOptions, progress)
    const backendLabel = engine.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'
    if ($('mb-backend')) $('mb-backend')!.textContent = backendLabel

    // One warm-up generation compiles the kernels before the robot moves.
    setStatus(`Warming up ${backendLabel}…`, 'loading')
    const rest = Float32Array.from(G1_BRICKS.rest[0])
    await engine.generate([rest, rest, rest, rest], [rest])

    controller = new G1Controller(engine, G1_BRICKS)
    controller.gait = gait
    controller.onError = e => setStatus(`Generation failed: ${e instanceof Error ? e.message : e}`, 'error')
    setStatus('Ready. Click the floor to send the robot there.', 'ready')
    setInterval(() => {
        const s = controller!.stats
        if ($('mb-latency')) $('mb-latency')!.textContent = s.generations ? `${Math.round(s.averageInferenceMs)} ms` : '–'
        if ($('mb-tokens')) $('mb-tokens')!.textContent = s.generations ? `${(s.lastTokenCount * 4 / 30).toFixed(1)} s · ${s.lastTokenCount} tok` : '–'
        if ($('mb-count')) $('mb-count')!.textContent = String(s.generations)
    }, 250)
    ;(window as any).motionbricks = {viewer, robot, stage, controller, engine}
}

_testStart()
init().catch(e => {
    console.error(e)
    setStatus(`Could not start: ${e instanceof Error ? e.message : e}`, 'error')
}).finally(_testFinish)
