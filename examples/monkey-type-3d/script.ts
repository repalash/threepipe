import {
    _testFinish,
    _testStart,
    BoxGeometry,
    DepthBufferPlugin,
    LoadingScreenPlugin,
    Mesh,
    Object3D,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    PhysicalMaterial,
    PickingPlugin,
    SpotLight2,
    SRGBColorSpace,
    Texture,
    ThreeViewer,
    timeout,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin} from '@threepipe/webgi-plugins'
import {TroikaTextPlugin} from '@threepipe/plugin-troika-text'
import {Fire} from './Fire'

// Vibe coded mini-game like monkeytype.com using three.js and troika text

const wordlist = [
    'TEST', 'MONKEY', 'TYPE', '3D', 'TEXT', 'EXAMPLE', 'THREEJS', 'TROIKA', 'PLUGIN', 'THREEPIPE', 'VIEWER', 'CANVAS', 'RENDER', 'SCALE', 'ENVIRONMENT', 'MAP', 'LOADING', 'SCREEN', 'DEPTH', 'BUFFER', 'BLOOM', 'PICKING',
    'WIDGETS', 'UI', 'TWEAKPANE', 'WORD', 'SPEED', 'SCORE', 'GAME', 'OVER', 'START', 'FINISH', 'TIME', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'ARROW', 'KEYBOARD', 'MOUSE', 'CLICK', 'DRAG', 'DROP', 'INPUT', 'OUTPUT', 'CODE', 'SCRIPT', 'LANGUAGE', 'JAVASCRIPT', 'TYPESCRIPT',
    'HTML', 'CSS', 'WEBGL', 'OPENGL', 'GRAPHICS', '3D', 'MODEL', 'MESH', 'GEOMETRY', 'MATERIAL', 'LIGHT', 'SHADOW', 'CAMERA', 'SCENE', 'OBJECT', 'POSITION', 'ROTATION', 'SCALE', 'VECTOR', 'COLOR', 'TEXTURE', 'ANIMATION', 'FRAME', 'UPDATE', 'LOOP',
    'FUNCTION', 'VARIABLE', 'CONSTANT', 'ARRAY', 'STRING', 'NUMBER', 'BOOLEAN', 'NULL', 'UNDEFINED', 'IF', 'ELSE', 'FOR', 'WHILE', 'DO', 'SWITCH', 'CASE', 'BREAK', 'CONTINUE', 'RETURN', 'CLASS', 'EXTENDS', 'IMPORT', 'EXPORT', 'DEFAULT',
    'TRY', 'CATCH', 'FINALLY', 'THROW', 'NEW', 'THIS', 'SUPER', 'STATIC', 'PUBLIC', 'PRIVATE', 'PROTECTED', 'GET', 'SET', 'ASYNC', 'AWAIT', 'PROMISE', 'RESOLVE', 'REJECT', 'FETCH',
]

const col1 = '#ffffff'
const col2 = '#222222'
const col3 = '#ff2222'

const maxTime = 15
let speed = 10

let score = 0
let wpm = 0

let timer = 0
let started = false
let ended = false

let block = ''
const count = 1000
// let line = 0
for (let i = 0; i < count; i++) {
    const word = (block ? ' ' : '') + wordlist[Math.floor(Math.random() * wordlist.length)].toLowerCase()
    block += word
}

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        rgbm: false,
        msaa: false,
        plugins: [LoadingScreenPlugin, DepthBufferPlugin, Object3DGeneratorPlugin, BloomPlugin, PickingPlugin, TroikaTextPlugin, new Object3DWidgetsPlugin(false)],
    })
    viewer.scene.backgroundColor?.set(0x222222)

    await viewer.setEnvironmentMap('https://dist.pixotronics.com/webgi/assets/hdr/gem_2.hdr')
    const spotLight = new SpotLight2()
    spotLight.castShadow = true
    spotLight.position.set(0, 4.5, 3)
    spotLight.intensity = 30
    spotLight.decay = 0.03
    spotLight.penumbra = 0.25
    spotLight.angle = 0.5
    spotLight.color.set(0xffaaaa)
    spotLight.lookAt(0, 0, 0)
    viewer.scene.addObject(spotLight)

    const plugin = viewer.getPlugin(TroikaTextPlugin)!
    const colorRanges: Record<number, number|string> = {[0]: col1}
    const text = plugin.createText({
        text: block, colorRanges,
        fontSize: 0.2,
        maxWidth: 7,
        anchorX: 'center',
        anchorY: 'top',
        font: 'https://samples.threepipe.org/fonts/Space_Mono/SpaceMono-Regular.ttf',
    })
    const material = text.children[0].material as PhysicalMaterial
    material.roughness = 0.04
    material.metalness = 0.9
    // material.emissiveIntensity = 0.1
    // material.emissive.set(0xffffff)
    const container = new Object3D()
    container.add(text)
    container.translateY(-2)
    viewer.scene.addObject(container)

    const timerText = plugin.createText({
        text: `time left:   ${maxTime.toString().padStart(2, '0')}s`, color: col1,
        fontSize: 0.15,
        anchorX: 'left',
        anchorY: 'top',
        font: 'https://samples.threepipe.org/fonts/Space_Mono/SpaceMono-Regular.ttf',
    })
    timerText.position.set(-3.5, 1.3, 0)
    viewer.scene.addObject(timerText)
    const wpmText = plugin.createText({
        text: '', color: col1,
        fontSize: 0.15,
        anchorX: 'left',
        anchorY: 'top',
        font: 'https://samples.threepipe.org/fonts/Space_Mono/SpaceMono-Regular.ttf',
    })
    wpmText.position.set(-3.5, 1.5, 0)
    viewer.scene.addObject(wpmText)
    const speedText = plugin.createText({
        text: `multiplier:  ${speed}`, color: col1,
        fontSize: 0.15,
        anchorX: 'left',
        anchorY: 'top',
        font: 'https://samples.threepipe.org/fonts/Space_Mono/SpaceMono-Regular.ttf',
    })
    speedText.position.set(-3.5, 1.1, 0)
    viewer.scene.addObject(speedText)

    const gameOverText = plugin.createText({
        text: 'GAME OVER', color: '#ff4444',
        fontSize: 0.4,
        anchorX: 'center',
        anchorY: 'middle',
        font: 'https://samples.threepipe.org/fonts/Space_Mono/SpaceMono-Regular.ttf',
    })
    gameOverText.position.set(0, 0, 0)
    gameOverText.visible = false
    viewer.scene.addObject(gameOverText)

    const startLabel = plugin.createText({
        text: 'START TYPING', color: '#44ff44',
        fontSize: 0.2,
        anchorX: 'center',
        anchorY: 'middle',
        font: 'https://samples.threepipe.org/fonts/Space_Mono/SpaceMono-Regular.ttf',
    })
    startLabel.position.set(0, -0.5, 0)
    startLabel.visible = true
    viewer.scene.addObject(startLabel)

    const caret = new Mesh(new BoxGeometry(0.5, 4, 1, 2, 2, 2), new PhysicalMaterial({
        color: 0xaaff55,
        emissive: 0xaaff55,
        emissiveIntensity: 10,
        roughness: 0.25,
        metalness: 0.25,
        transparent: true,
        opacity: 0.75,
        side: 2,
        userData: {renderToGBuffer: true},
    }))
    caret.scale.multiplyScalar(0.05)
    text.add(caret)

    const fireTex = await viewer.load<Texture>('https://samples.threepipe.org/minimal/Fire.png')
    if (!fireTex) return
    fireTex.colorSpace = SRGBColorSpace
    const fire = new Fire(fireTex)
    fire.scale.set(14, 14, 14)
    fire.position.set(0, -1, -5)
    fire.rotation.x = Math.PI

    container.rotateX(-0.6)

    viewer.scene.addObject(fire)

    viewer.addEventListener('preFrame', (e)=>{
        fire.update(1.3 * (e.time || 0) / 1000)

        spotLight.position.x = Math.sin((e.time || 0) / 1000) * 0.2
        // text.position.y += 0.5
        viewer.scene.environment!.rotation += 0.0013


        viewer.setDirty()

        if (!started || ended) return
        // Move text up every frame
        text.position.y += 0.0001 * speed
        timer += e.deltaTime || 0
        const timeLeft = Math.max(0, maxTime - Math.floor(timer / 1000))
        plugin.updateText(timerText, {text: `time left:   ${timeLeft.toString().padStart(2, '0')}s`})
        if (timeLeft === 0 || caret.getWorldPosition(new Vector3()).y > 1.5) {
            // end
            started = false
            ended = true
            speed += 10
            gameOverText.visible = true
            plugin.updateText(startLabel, {text: 'PRESS Enter TO RESTART'})
            plugin.updateText(speedText, {text: `multiplier:  ${speed}`})
            speedText.visible = false
            startLabel.visible = true
            viewer.scene.mainCamera.controls!.enabled = true
            material.opacity = 0.25
            let accuracy = 0
            if (currentText.length > 0) {
                const t = block.toUpperCase()
                const ct = currentText.toUpperCase()
                let correct = 0
                for (let i = 0; i < ct.length; i++) {
                    if (t[i] === ct[i]) correct++
                }
                accuracy = correct / ct.length * 100
            }
            const accuracyText = Math.floor(accuracy).toString().padStart(2, '0')
            plugin.updateText(timerText, {text: `time taken:  ${Math.floor(timer / 1000).toString().padStart(2, '0')}s\naccuracy:    ${accuracyText}%`})
        }
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild(spotLight.uiConfig)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(Object3DWidgetsPlugin)

    // maintain the same FOV when the window is resized
    viewer.scene.mainCamera.controls!.enabled = false
    const squarePos = 5
    const squareFov = 90// viewer.scene.mainCamera.fov!
    function refreshFov() {
        const size = viewer.renderManager.renderSize.clone()
        const camera = viewer.scene.mainCamera
        camera.fov = squareFov * (size.y / size.x)
        console.log(camera.fov)
        camera.position.z = squarePos / Math.tan(squareFov / 2 * Math.PI / 180)
        camera.updateProjectionMatrix()
    }
    refreshFov()
    viewer.renderManager.addEventListener('resize', () => {
        refreshFov()
    })

    let currentText = ''
    viewer.canvas.addEventListener('keydown', (e) => {
        if (ended) {
            if (e.key === 'Enter') {
                material.opacity = 1
                // Restart the game
                score = 0
                wpm = 0
                timer = 0
                started = false
                ended = false
                viewer.scene.mainCamera.controls!.enabled = false
                currentText = ''
                // Reset colorRanges
                Object.keys(colorRanges).forEach(key => delete colorRanges[parseInt(key)])
                colorRanges[0] = col1
                speedText.visible = true
                plugin.updateText(text, {colorRanges: {...colorRanges}})
                plugin.updateText(startLabel, {text: 'START TYPING'})
                plugin.updateText(wpmText, {text: `words / min: ${wpm}`})
                plugin.updateText(timerText, {text: `time left:   ${maxTime.toString().padStart(2, '0')}`})
                gameOverText.visible = false
                startLabel.visible = false
                text.position.set(0, 0, 0)
                if (viewer.scene.environment) viewer.scene.environment.rotation = 0
                viewer.setDirty()
                return
            } else {
                return
            }
        }
        if (e.key === 'Backspace') {
            currentText = currentText.slice(0, -1)
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            currentText += e.key
        } else {
            return
        }
        if (!started) {
            started = true
            startLabel.visible = false
        }
        // console.log(currentText)
        updateColors()
    })
    viewer.canvas.focus()

    function updateColors() {
        const ct = currentText.toUpperCase()
        const t = block.toUpperCase()
        let last = col2
        score = 0
        let check = true
        for (let i = 0; i < ct.length + 1; i++) {
            if (t[i] === ' ') {
                if (check) score++
                check = true
            }
            if (i > ct.length - 1) {
                last = col1
            } else if (t[i] !== ct[i]) {
                last = col3
                check = false
            } else if (last !== col2) {
                last = col2
            } else if (i > 0) {
                delete colorRanges[i]
                continue
            }
            colorRanges[i] = last
        }
        plugin.updateText(text, {colorRanges: {...colorRanges}})
        wpm = timer > 0 ? Math.floor(score / (timer / 1000 / 60)) : 0
        plugin.updateText(wpmText, {text: `words / min: ${wpm}`})
        // console.log(score, wpm)

        const textInfo = (text.children[0] as any).textRenderInfo
        if (!textInfo) {
            caret.visible = false
        } else {
            caret.visible = true
            // four elements: the starting X, the ending X, the bottom Y, and the top Y for the caret. (in local text plane)
            const caretPos = textInfo.caretPositions.slice(currentText.length * 4, (currentText.length + 1) * 4)
            const pos = new Vector3((caretPos[0] + caretPos[0]) / 2, (caretPos[2] + caretPos[3]) / 2, 0)
            caret.position.copy(pos)
        }

        viewer.setDirty()
    }

    await timeout(200)
    updateColors()

}

_testStart()
init().finally(_testFinish)
