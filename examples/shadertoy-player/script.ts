import {
    _testFinish,
    _testStart,
    CanvasSnapshotPlugin, createStyles, css,
    ExtendedShaderMaterial,
    glsl,
    GLSL3,
    LoadingScreenPlugin, MaterialExtension,
    ThreeViewer,
    UiObjectConfig,
    Vector2,
    Vector3,
    Vector4,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
// import {BlueprintJsUiPlugin} from '@threepipe/plugin-blueprintjs'

// Checkout the code breakup and explanation here - https://threepipe.org/notes/shadertoy-player.html

async function init() {

    const material = new ExtendedShaderMaterial({
        uniforms: uniforms,
        defines: {
            ['IS_SCREEN']: isScreen ? '1' : '0',
            ['IS_LINEAR_OUTPUT']: isScreen ? '1' : '0',
        },
        glslVersion: GLSL3,
        vertexShader: toyVert,
        fragmentShader: toyFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        premultipliedAlpha: false,
    }, channels, false)
    material.registerMaterialExtensions([toyExtension])
    material.needsUpdate = true

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        rgbm: false,
        tonemap: false,
        plugins: [LoadingScreenPlugin, CanvasSnapshotPlugin],
        screenShader: material,
        renderScale: 2,
    })

    // setup css alignment of canvas inside container (for proper viewer size)
    viewer.container.style.position = 'relative'
    viewer.canvas.style.position = 'absolute'
    viewer.canvas.style.top = '50%'
    viewer.canvas.style.left = '50%'
    viewer.canvas.style.transform = 'translate(-50%, -50%)'

    addMouseListeners(viewer.canvas)

    viewer.addEventListener('preFrame', (ev)=>{
        if (!params.running && !params.stepFrame) return

        // uniforms.iTimeDelta.value = viewer.renderManager.clock.getDelta()
        uniforms.iTimeDelta.value = (ev.deltaTime || 0) / 1000.0

        const date = new Date()
        uniforms.iDate.value.set(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() * 60 * 60 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000)

        uniforms.iFrameRate.value = 30 // todo: get from clock
        const bufferSize = [viewer.renderManager.renderSize.width * viewer.renderManager.renderScale, viewer.renderManager.renderSize.height * viewer.renderManager.renderScale]
        uniforms.iResolution.value.set(bufferSize[0], bufferSize[1], 1)

        uniforms.iMouse.value.set( // acc to shadertoy
            mouse.position.x * bufferSize[0],
            mouse.position.y * bufferSize[1],
            mouse.clickPosition.x * (mouse.isDown ? 1 : -1) * bufferSize[0],
            mouse.clickPosition.y * (mouse.isClick ? 1 : -1) * bufferSize[1],
        )
        params.time += uniforms.iTimeDelta.value
        uniforms.iTime.value = params.time
        uniforms.iFrame.value = params.frame++

        // uniforms.iChannelTime.value = [0, 0, 0, 0]
        // uniforms.iChannelResolution.value = [
        //     new Vector3(uniforms.iChannel0Size.value.x, uniforms.iChannel0Size.value.y, 1),
        //     new Vector3(uniforms.iChannel1Size.value.x, uniforms.iChannel1Size.value.y, 1),
        //     new Vector3(uniforms.iChannel2Size.value.x, uniforms.iChannel2Size.value.y, 1),
        //     new Vector3(uniforms.iChannel3Size.value.x, uniforms.iChannel3Size.value.y, 1),
        // ]
        // for (let i = 0; i < channels.length; i++) {
        //     const channel = uniforms[channels[i]]
        //     if (channel.value) {
        //         channel.value.needsUpdate = true
        //         uniforms[channels[i] + 'Size'].value.set(channel.value.image.width, channel.value.image.height)
        //     } else {
        //         uniforms[channels[i] + 'Size'].value.set(0, 0)
        //     }
        // }
        material.uniformsNeedUpdate = true
        viewer.setDirty()
        ui.uiRefresh?.(true)
        params.stepFrame = false
    })

    viewer.setRenderSize(params.resolution)

    const setShader = (v: string)=>{
        toyExtension.parsFragmentSnippet = v
        toyExtension.computeCacheKey = Math.random().toString()
        material.setDirty()
        viewer.setDirty()
        ui.uiRefresh?.(true)
    }

    const ui: UiObjectConfig = {
        label: 'Edit Properties',
        type: 'folder',
        expanded: true,
        value: params,
        children: [{
            type: 'vec',
            path: 'resolution',
            label: 'Resolution',
            bounds: [10, 4096],
            stepSize: 1,
            onChange: ()=>{
                viewer.setRenderSize(params.resolution, 'contain', 1)
            },
        }, {
            type: 'number',
            path: 'time',
            label: 'Time',
            readOnly: true,
        }, {
            type: 'number',
            path: 'frame',
            label: 'Frame',
            readOnly: true,
        }, {
            type: 'button',
            baseWidth: '100%',
            label: ()=> 'Step',
            disabled: ()=> params.running,
            onClick: ()=>{
                params.stepFrame = true
                ui.uiRefresh?.(true)
            },
        }, {
            type: 'button',
            baseWidth: '100%',
            label: ()=> params.running ? 'Pause' : 'Play',
            onClick: ()=>{
                params.running = !params.running
                ui.uiRefresh?.(true)
            },
        }, {
            type: 'button',
            baseWidth: '100%',
            label: ()=> 'Reset',
            onClick: ()=>{
                params.frame = 0
                params.time = 0
                params.stepFrame = true
                ui.uiRefresh?.(true)
            },
        }, {
            type: 'button',
            baseWidth: '100%',
            label: ()=> 'Edit Shader',
            onClick: ()=>setupShaderEditor(toyExtension.parsFragmentSnippet as string, setShader),
        }, {
            type: 'button',
            label: 'Download png',
            baseWidth: '100%',
            onClick: async()=>{
                const running = params.running
                params.running = false
                await viewer.getPlugin(CanvasSnapshotPlugin)?.downloadSnapshot('snapshot.png', {
                    waitForProgressive: false,
                    displayPixelRatio: undefined,
                })
                params.running = running
                ui.uiRefresh?.(true)
            },
        }],
    }

    const shaderFile = 'https://samples.threepipe.org/shaders/tunnel-cylinders.glsl'
    const response = await fetch(shaderFile)
    const shaderText = await response.text()
    setShader(shaderText)

    const uiPlugin = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    // const uiPlugin = viewer.addPluginSync(new BlueprintJsUiPlugin())
    uiPlugin.appendChild(ui)
    // uiPlugin.setupPluginUi(CanvasSnapshotPlugin, {expanded: true})

}

// region variables

const params = {
    resolution: new Vector2(1280, 720),
    time: 0,
    frame: 0,
    stepFrame: false,
    running: true,
}
const mouse = {
    position: new Vector2(),
    clickPosition: new Vector2(),
    isDown: false,
    isClick: false,
    clientX: 0,
    clientY: 0,
}
const isScreen = true
const channels = ['iChannel0', 'iChannel1', 'iChannel2', 'iChannel3']
const uniforms = {
    iResolution: {value: new Vector3()},
    iTime: {value: 0},
    iFrame: {value: 0},
    iMouse: {value: new Vector4()},
    iTimeDelta: {value: 0},
    iDate: {value: new Vector4()},
    iFrameRate: {value: 0},
    iChannel0: {value: null},
    iChannel1: {value: null},
    iChannel2: {value: null},
    iChannel3: {value: null},
    iChannel0Size: {value: new Vector2()},
    iChannel1Size: {value: new Vector2()},
    iChannel2Size: {value: new Vector2()},
    iChannel3Size: {value: new Vector2()},
    iChannelTime: {value: [0, 0, 0, 0]},
    iChannelResolution: {value: [new Vector3(), new Vector3(), new Vector3(), new Vector3()]},
}

// endregion variables

// region shaders

const toyDefault = glsl`
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord/iResolution.xy;
    fragColor = vec4(uv, 0, 1);
}
`

const toyFrag = glsl`
precision highp int;
precision highp sampler2D;

#define HW_PERFORMANCE 0

uniform vec3 iResolution;                  // viewport resolution (in pixels)
uniform float iTime;                        // shader playback time (in seconds)
//uniform float     iGlobalTime;                  // shader playback time (in seconds)
uniform vec4 iMouse;                       // mouse pixel coords
uniform vec4 iDate;                        // (year, month, day, time in seconds)
uniform float iSampleRate;                  // sound sample rate (i.e., 44100)
vec3 iChannelResolution[4];        // channel resolution (in pixels)
//uniform float iChannelTime[4];              // channel playback time (in sec)

//uniform vec2 ifFragCoordOffsetUniform;     // used for tiled based hq rendering
uniform float iTimeDelta;                   // render time (in seconds)
uniform int  iFrame;                       // shader playback frame
uniform float iFrameRate;

uniform vec2 iChannel0Size;
uniform vec2 iChannel1Size;
uniform vec2 iChannel2Size;
uniform vec2 iChannel3Size;

in vec2 vUv;
#define gl_FragColor glFragColor
layout(location = 0) out vec4 glFragColor;

void main() {
    iChannelResolution[0] = vec3(iChannel0Size,1.0);
    iChannelResolution[1] = vec3(iChannel1Size,1.0);
    iChannelResolution[2] = vec3(iChannel2Size,1.0);
    iChannelResolution[3] = vec3(iChannel3Size,1.0);

    // mainImage(glFragColor,iResolution.xy*vUv); // this has issues in windows?
    mainImage(glFragColor,gl_FragCoord.xy);
    
    vec4 diffuseColor = glFragColor;
    #glMarker
    glFragColor = diffuseColor;
    
    #if IS_SCREEN == 1
    glFragColor.a = 1.0;

    #ifdef IS_LINEAR_OUTPUT
    //glFragColor = sRGBToLinear(glFragColor);
    #else
    #include <colorspace_fragment>
    #endif

    #endif
}
`

const toyVert = glsl`
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// endregion shaders

// region mouse

export function getMouseFromEvent(canvas: HTMLElement, e: PointerEvent|WheelEvent): Vector2 | null {
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
    return mouse.position.set(x / rect.width, 1.0 - y / rect.height)
}

export function onPointerDown(e: PointerEvent, canvas: HTMLElement) {
    if (e.button !== 0 || !mouse) return
    mouse.isDown = false
    mouse.isClick = false
    const m = getMouseFromEvent(canvas, e)
    if (!m) return
    mouse.isDown = true
    mouse.isClick = true
    mouse.clickPosition.copy(m)
    e.preventDefault()
    e.stopPropagation()
}

export function onPointerUp(e: PointerEvent, canvas: HTMLElement) {
    if (e.button !== 0 || !mouse) return
    mouse.isDown = false
    mouse.isClick = false
    getMouseFromEvent(canvas, e)
}

export function onPointerMove(e: PointerEvent, canvas: HTMLElement) {
    if (!mouse) return
    mouse.clientX = e.clientX
    mouse.clientY = e.clientY
    if (!mouse.isDown) return
    getMouseFromEvent(canvas, e)
}

export function onPointerWheel(e: WheelEvent, canvas: HTMLElement) {
    if (!mouse) return
    mouse.clientX = e.clientX
    mouse.clientY = e.clientY
    const m = getMouseFromEvent(canvas, e)
    if (!m) return
    mouse.position.set(0, 0)
    mouse.clickPosition.set(0, 0)
}

export function addMouseListeners(canvas: HTMLElement) {
    canvas.addEventListener('pointerdown', (e) => onPointerDown(e as PointerEvent, canvas), {passive: false})
    canvas.addEventListener('pointerup', (e) => onPointerUp(e as PointerEvent, canvas), {passive: false})
    canvas.addEventListener('pointermove', (e) => onPointerMove(e as PointerEvent, canvas), {passive: false})
    canvas.addEventListener('wheel', (e) => onPointerWheel(e as WheelEvent, canvas), {passive: false})
}

// endregion mouse

// region shader editor

const toyExtension: MaterialExtension = {
    parsFragmentSnippet: toyDefault,
    isCompatible: () => true,
    computeCacheKey: Math.random().toString(),
}

let editor: HTMLElement | undefined = undefined
window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && editor) {
        editor.remove()
        editor = undefined
    }
})
export function setupShaderEditor(value: string, onChange: (v: string)=>void) {
    if (editor) return
    editor = document.createElement('div')
    editor.classList.add('editor-container')
    document.body.appendChild(editor)
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.addEventListener('input', ()=>{
        onChange(textarea.value)
    })
    editor.appendChild(textarea)
    const closeButton = document.createElement('div')
    closeButton.classList.add('close-button')
    closeButton.textContent = '×'
    closeButton.addEventListener('click', ()=>{
        if (!editor) return
        editor.remove()
        editor = undefined
    })
    editor.appendChild(closeButton)
}

// endregion shader editor

_testStart()
init().finally(_testFinish)

createStyles(css`
    *:focus {
        outline: none;
    }

    .editor-container {
        width: min(800px, 80%);
        height: min(600px, 80%);
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 1000;
        background-color: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(10px);
        border-radius: 10px;
        overflow: hidden;
    }

    .editor-container textarea {
        height: 100%;
        width: 100%;
        color: rgba(240, 240, 240, 0.9);
        font-family: monospace;
        font-size: 14px;
        white-space: pre;
        overflow: auto;
        background: rgba(255, 255, 255, 0.10);
        border-radius: 10px;
        border: none;
        outline: none;
        padding: 10px;
        backdrop-filter: blur(6px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        transition: box-shadow 0.2s ease-in-out;
    }

    .editor-container textarea:hover {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), 0 2px 0 rgba(255, 255, 255, 0.15) inset;
    }

    .editor-container .close-button {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 1;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.15);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), 0 1.5px 0 rgba(255, 255, 255, 0.15) inset;
        border: none;
        color: #fff;
        font-size: 20px;
        font-weight: bold;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(4px);
        transition: background 0.4s, box-shadow 0.4s;
    }

    .editor-container .close-button:hover {
        background: rgba(255, 255, 255, 0.3);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    }
`)
