import {
    _testFinish,
    _testStart,
    BoxGeometry,
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
    Object3D,
} from 'threepipe'
import {
    BloomPlugin,
    SSGIPlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    VelocityBufferPlugin,
} from '@threepipe/webgi-plugins'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {CHARACTER_RIGS, G1Gait, G1Primitive, GAIT_SPEEDS, MOTIONBRICKS_CHARACTERS, MOTIONBRICKS_DEFAULTS, MotionBricksCharacter, MotionBricksObstacle} from 'three-motionbricks'
import {CityNav, PathFollower} from './CityNav'
import {G1Stage, STAGE_STYLES, StageStyleName} from './G1Stage'

// Real-time motion generation in the browser with NVIDIA MotionBricks (https://github.com/NVlabs/motionbricks),
// through the three-motionbricks library (plugins/three-motionbricks), which works with any three.js scene.
// Click the floor to send the robot there, or drive it with WASD; the model generates every step on the way.
// Pages can override the sources with window.MOTIONBRICKS_CONFIG, and URL parameters override both:
// ?model=<folder with pack.json/ or .onnx url>&robot=<glb url>&backend=webgpu&style=city&fx=0&ui=0&worker=0

const config = {
    /** onnxruntime-web module, model and robot GLB. Empty uses the library's defaults (MOTIONBRICKS_DEFAULTS). */
    ort: '',
    /** Optional parts of the ORT .wasm file, joined in order, for hosts that limit file size. */
    wasm: undefined as string[] | undefined,
    /** A folder with pack.json from tools/pack_model.py, or an original MotionBricks G1 .onnx file. */
    model: '',
    /** A pack from tools/pack_lite.py, used on phones and low-memory devices (or always with ?lite=1). */
    liteModel: '',
    /** auto, 1 or 0: when to use liteModel. */
    lite: 'auto',
    robot: '',
    /** The model the motion plays on, from MOTIONBRICKS_CHARACTERS: g1, h1, t1, op3, robot-expressive, astronaut, polybot. */
    character: 'g1',
    /** Where the characters' files are (the library's assets/ folder), with a suffix for hosts that rename them. */
    assetBase: '',
    assetSuffix: '',
    /** Scene style from G1Stage.ts: city, research, grid, studio, stage or hangar. */
    style: 'city',
    /** Where the styles' HDR files are, with a suffix for hosts that rename them. Poly Haven by default. */
    environmentBase: '',
    environmentSuffix: '',
    /** Screen-space reflections, GI, TAA and bloom. 0 turns them off. */
    fx: '1',
    /** The Tweakpane panel for lighting and render options. 0 hides it. */
    ui: '1',
    /** Run the model in a Web Worker. 0 runs it on the page, which stalls rendering during each generation. */
    worker: '1',
    /** '' (auto: WebGPU when it is available and fast enough), wasm or webgpu. */
    backend: '',
    ...(window as any).MOTIONBRICKS_CONFIG,
}
const params = new URLSearchParams(location.search)
for (const key of ['model', 'liteModel', 'lite', 'robot', 'character', 'backend', 'style', 'fx', 'ui', 'worker'] as const) if (params.get(key)) config[key] = params.get(key)!

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
            SSReflectionPlugin, SSGIPlugin, BloomPlugin, HDRiGroundPlugin],
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
    // The cubes are solid: clicks and wandering go around them, and the keys cannot drive into them.
    let nav = new CityNav(new Set(), 40)
    const follower = new PathFollower()
    stage.onChange = () => {
        $('mb-fx')?.setAttribute('aria-pressed', String(stage.effectsEnabled))
        if (styleSelect) styleSelect.value = stage.styleName
        if (nav.blocked !== stage.blocked) {
            nav = new CityNav(stage.blocked, 40)
            follower.clear()
            placeHurdles?.()
        }
    }
    let placeHurdles: (() => void) | undefined
    stage.effectsEnabled = config.fx !== '0'
    $('mb-fx')?.addEventListener('click', () => stage.setEffects(!stage.effectsEnabled))
    if (styleSelect) {
        styleSelect.replaceChildren(...Object.entries(STAGE_STYLES).map(([k, st]) => new Option(st.label, k)))
        styleSelect.addEventListener('change', async() => stage.setStyle(styleSelect.value as StageStyleName))
    }
    await stage.setStyle((config.style in STAGE_STYLES ? config.style : 'city') as StageStyleName)

    const goalMaterial = new UnlitMaterial({color: themeColor('--accent', '#e8590c'), transparent: true, opacity: 0.9, depthWrite: false})
    const goalMarker = new Mesh(new RingGeometry(0.16, 0.22, 48).rotateX(-Math.PI / 2), goalMaterial)
    goalMarker.visible = false
    goalMarker.name = 'Goal'
    viewer.scene.addObject(goalMarker)

    // Each style places the camera (see G1Stage.ts); it then follows the robot, keeping the user's orbit.
    const camera = viewer.scene.mainCamera

    // The character from three-motionbricks. threepipe loads its robot GLB like any model, with PhysicalMaterials
    // the panel can edit. A host that renames files (to .wasm) gets the GLB as a File named .glb.
    const g1 = new MotionBricksCharacter({
        ort: config.ort || undefined,
        wasm: config.wasm,
        model: config.model || undefined,
        liteModel: config.liteModel || undefined,
        lite: config.lite === '1' ? true : config.lite === '0' ? false : 'auto',
        backend: config.backend === 'webgpu' || config.backend === 'wasm' ? config.backend : 'auto',
        worker: config.worker !== '0',
    })
    g1.onError = e => setStatus(`Generation failed: ${e instanceof Error ? e.message : e}`, 'error')
    // The model the motion plays on: the G1 itself, or another robot or character it is retargeted to.
    // threepipe loads each GLB like any model, with PhysicalMaterials the panel can edit. A host that renames files
    // (to .wasm) gets them as Files named .glb.
    const importGlb = async(url: string) => {
        const asset = /\.(glb|gltf)$/i.test(url.split(/[?#]/)[0]) ? url :
            new File([await (await fetch(url)).arrayBuffer()], 'model.glb')
        const model = await viewer.import<IObject3D>(asset)
        if (!model) throw new Error(`Could not load ${url}`)
        return model
    }
    const characterUrl = (c: typeof MOTIONBRICKS_CHARACTERS[number]) => c.id === 'g1' && config.robot ? config.robot :
        (config.assetBase || MOTIONBRICKS_DEFAULTS.assets) + c.file + config.assetSuffix
    let characterId = MOTIONBRICKS_CHARACTERS.some(c => c.id === config.character) ? config.character : 'g1'
    const robotFolder = {type: 'folder', label: 'Robot', children: [] as any[], uiRefresh: undefined as any}
    const setCharacter = async(id: string) => {
        const c = MOTIONBRICKS_CHARACTERS.find(x => x.id === id) ?? MOTIONBRICKS_CHARACTERS[0]
        const model = await importGlb(characterUrl(c))
        const robot = 'rig' in c ? g1.setCharacter(model, CHARACTER_RIGS[c.rig]) : g1.setRobot(model)
        characterId = c.id
        robotFolder.label = c.label
        robotFolder.children = robot.materials.map(m => (m as PhysicalMaterial).uiConfig)
        robotFolder.uiRefresh?.(true, 'postFrame')
        if (characterSelect) characterSelect.value = c.id
        ;(window as any).motionbricks.robot = robot
        viewer.renderManager.resetShadows()
        viewer.setDirty()
        return robot
    }
    const characterSelect = $('mb-character') as HTMLSelectElement | null
    if (characterSelect) {
        characterSelect.replaceChildren(...MOTIONBRICKS_CHARACTERS.map(c => new Option(c.label, c.id)))
        characterSelect.addEventListener('change', async() => setCharacter(characterSelect.value))
    }
    (window as any).motionbricks = {viewer, g1, stage}
    setStatus('Loading the robot…', 'loading')
    const robot = await setCharacter(characterId)
    viewer.scene.addObject(g1.object)

    // A Tweakpane panel for the lighting and render options, in the clean theme that follows light or dark mode.
    if (config.ui !== '0') {
        const dark = (document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'
        const ui = viewer.addPluginSync(new TweakpaneUiPlugin(!matchMedia('(max-width: 720px)').matches, true, undefined, dark ? 'clean-dark' : 'clean'))
        ui.appendChild(stage.uiConfig)
        ui.appendChild({
            type: 'folder', label: 'Character', expanded: true,
            children: [{
                type: 'dropdown', label: 'Model', property: [{get id() { return characterId }, set id(v: string) { void setCharacter(v) }}, 'id'],
                children: MOTIONBRICKS_CHARACTERS.map(c => ({label: c.label, value: c.id})),
            }],
        })
        ui.appendChild(robotFolder)
        ui.setupPlugins(TonemapPlugin, SSGIPlugin, SSReflectionPlugin, BloomPlugin, TemporalAAPlugin, HDRiGroundPlugin)
    }
    viewer.setDirty()
    Object.assign((window as any).motionbricks, {robot})

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
        // A path being followed picks the gait up on its next step.
        if (goal && g1.ready && !follower.active) g1.moveTo(goal, g)
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
        follower.clear()
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
        goTo(hit)
    })

    // Go to a point around the cubes: straight there when nothing is in the way, else along a path.
    const goTo = (point: Vector3) => {
        const path = nav.path(g1.getPosition(), point)
        if (!path || path.length === 1) {
            follower.clear()
            g1.moveTo(path?.[0] ?? point, gait)
        } else follower.set(path)
    }

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
    let keyDriving = false
    /** Drive with the keys; returns whether they are held. Releasing them stops the robot. */
    const steer = () => {
        let ix = 0, iy = 0
        for (const k of keys) {
            ix += driveKeys[k][0]
            iy += driveKeys[k][1]
        }
        if (!ix && !iy) {
            if (keyDriving) g1.drive(null)
            keyDriving = false
            return false
        }
        keyDriving = true
        follower.clear()
        forward.copy(camera.target).sub(camera.position).setY(0).normalize()
        right.crossVectors(forward, camera.up)
        direction.copy(forward).multiplyScalar(iy).addScaledVector(right, ix).normalize()
        if (wander) {
            wander = false
            syncButtons()
        }
        // Into a cube, slide along it; into a corner, stop.
        const at = g1.getPosition(), ahead = 0.8
        const freeAlong = (d: Vector3) => nav.free(at.x + d.x * ahead, at.z + d.z * ahead)
        if (!freeAlong(direction)) {
            const sx = new Vector3(Math.sign(direction.x), 0, 0), sz = new Vector3(0, 0, Math.sign(direction.z))
            const slide = Math.abs(direction.x) > Math.abs(direction.z) ? [sx, sz] : [sz, sx]
            const way = slide.find(d => d.lengthSq() > 0 && freeAlong(d))
            if (!way) {
                g1.drive(null)
                return true
            }
            direction.copy(way)
        }
        g1.drive(direction, shift ? 'run' : gait)
        return true
    }

    // Pause with P: shared with the site's world switcher, which draws a button for it, when that loaded first.
    const shared = window as any
    const pause: {paused: boolean, toggle: (v?: boolean) => void} = shared.motionbricksPause ??= (() => {
        const api = {
            paused: false,
            toggle(value = !api.paused) {
                api.paused = shared.motionbricksPaused = value
                window.dispatchEvent(new CustomEvent('motionbricks:pause', {detail: value}))
            },
        }
        window.addEventListener('keydown', e => {
            if (e.code === 'KeyP' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) api.toggle()
        })
        return api
    })()

    // Follow the robot with the camera, keeping the user's orbit.
    const follow = new Vector3()
    let last = performance.now()
    viewer.addEventListener('preFrame', () => {
        const now = performance.now()
        const dt = Math.min((now - last) / 1000, 0.1)
        last = now
        stage.update(camera.target)
        if (!g1.ready) return
        // Paused (P, or the site's pause button): the robot holds its pose and the camera still orbits.
        if (pause.paused) {
            viewer.setDirty()
            return
        }
        if (!steer()) {
            const run = gait === 'run'
            const step = follower.update(g1.getPosition(), GAIT_SPEEDS[gait] * 1.0 + 1.2, run ? 2.5 : 1.5)
            if (step === 'finish') g1.moveTo(follower.path[follower.path.length - 1], gait)
            else if (step) g1.drive(step, gait)
        }
        g1.update(dt)
        const goal = follower.active ? goalMarker.position.copy(follower.path[follower.path.length - 1]) : g1.getGoal(goalMarker.position)
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

        if (g1.idle && !follower.active) {
            idleTime += dt
            if (wander && idleTime > 1.2) {
                idleTime = 0
                // Pick a point 2.5 to 6 m away that stays within 7 m of the origin.
                const at = g1.getPosition()
                const angle = Math.random() * Math.PI * 2
                const d = 2.5 + Math.random() * 3.5
                const to = new Vector3(at.x + Math.cos(angle) * d, 0, at.z + Math.sin(angle) * d)
                if (to.length() > 7) to.copy(at).setLength(Math.max(0, at.length() - 4))
                goTo(to)
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
    // Low boxes and walls in the plaza, which the robot jumps and vaults: NVIDIA's Smart Primitives, whose clips
    // download from NVIDIA's repository. They stand only in the block city.
    const hurdles: {kind: 'box' | 'wall', x: number, z: number, rotation: number}[] = [
        {kind: 'box', x: 2.6, z: 1.8, rotation: 0}, {kind: 'box', x: -3.2, z: -1.6, rotation: 0.4},
        {kind: 'box', x: 0.4, z: -4.4, rotation: 0}, {kind: 'box', x: 4.6, z: -2.2, rotation: 0.8},
        {kind: 'wall', x: -2.4, z: 3.2, rotation: 0.3}, {kind: 'wall', x: 3.4, z: 4.8, rotation: Math.PI / 2},
        {kind: 'wall', x: -5.2, z: 1.2, rotation: Math.PI / 2 + 0.2},
    ]
    const hurdleMeshes: Object3D[] = []
    Promise.all([g1.loadPrimitive('jump_0_5m'), g1.loadPrimitive('jump_0_75m')]).then(([box, wall]) => {
        const primitives: Record<'box' | 'wall', G1Primitive> = {box, wall}
        const materials = {box: new PhysicalMaterial({color: '#ef3b36', roughness: 0.55}), wall: new PhysicalMaterial({color: '#16171a', roughness: 0.45})}
        placeHurdles = () => {
            for (const m of hurdleMeshes.splice(0)) m.removeFromParent()
            const obstacles: MotionBricksObstacle[] = []
            if (stage.styleName === 'city') {
                for (const h of hurdles) {
                    const [w, d, height] = primitives[h.kind].box.size
                    const mesh = new Mesh(new BoxGeometry(w, height, d), materials[h.kind])
                    mesh.position.set(h.x, height / 2, h.z)
                    mesh.rotation.y = h.rotation
                    mesh.castShadow = mesh.receiveShadow = true
                    mesh.name = h.kind === 'box' ? 'Hurdle box' : 'Hurdle wall'
                    viewer.scene.addObject(mesh)
                    hurdleMeshes.push(mesh)
                    obstacles.push({primitive: primitives[h.kind], position: new Vector3(h.x, 0, h.z), rotation: h.rotation})
                }
            }
            g1.setObstacles(obstacles)
            viewer.renderManager.resetShadows()
            viewer.setDirty()
        }
        placeHurdles()
    }).catch(e => console.warn('MotionBricks: no hurdles, the jump primitives did not load', e))

    const backendLabel = (g1.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly') + ((g1.engine as any)?.worker ? ' (worker)' : '')
    if ($('mb-backend')) $('mb-backend')!.textContent = backendLabel
    setStatus('Ready. Click the floor to send the robot there.', 'ready')
    setInterval(() => {
        const s = g1.stats!
        if ($('mb-latency')) $('mb-latency')!.textContent = s.generations ? `${Math.round(s.averageInferenceMs)} ms` : '–'
        if ($('mb-tokens')) $('mb-tokens')!.textContent = s.generations ? `${(s.lastTokenCount * 4 / 30).toFixed(1)} s · ${s.lastTokenCount} tok` : '–'
        if ($('mb-count')) $('mb-count')!.textContent = String(s.generations)
    }, 250)
    Object.assign((window as any).motionbricks, {controller: g1.controller, engine: g1.engine, goTo, follower, nav: () => nav})
}

_testStart()
init().catch(e => {
    console.error(e)
    setStatus(`Could not start: ${e instanceof Error ? e.message : e}`, 'error')
}).finally(_testFinish)
