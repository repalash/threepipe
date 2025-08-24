import {
    BackSide,
    Camera,
    CanvasTexture,
    Clock,
    Color,
    Euler,
    LinearFilter,
    Material,
    Mesh,
    MeshBasicMaterial,
    Object3D, Object3DEventMap,
    OrthographicCamera,
    PerspectiveCamera,
    Quaternion,
    Raycaster,
    RepeatWrapping,
    SphereGeometry,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Vector2,
    Vector3,
    Vector4,
    WebGLRenderer,
} from 'three'
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js'
import {onChangeDispatchEvent} from 'ts-browser-helpers'


const [POS_X, POS_Y, POS_Z, NEG_X, NEG_Y, NEG_Z] = Array(6)
    .fill(0)
    .map((_, i) => i)

const axesColors = [
    new Color(0xff3653),
    new Color(0x8adb00),
    new Color(0x2c8fff),
]

const clock = new Clock()
const targetPosition = new Vector3()
const targetQuaternion = new Quaternion()
// const euler = new Euler()
const q1 = new Quaternion()
const q2 = new Quaternion()
const point = new Vector3()
// const dim = 128
const turnRate = 2 * Math.PI // turn rate in angles per second
const raycaster = new Raycaster()
const mouse = new Vector2()
// const mouseStart = new Vector2()
// const mouseAngle = new Vector2()
const dummy = new Object3D()
let radius = 0

export type GizmoOrientation = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'

export type DomPlacement =
    | 'top-left'
    | 'top-right'
    | 'top-center'
    | 'center-right'
    | 'center-left'
    | 'center-center'
    | 'bottom-left'
    | 'bottom-right'
    | 'bottom-center'

export interface ViewHelper2EventMap extends Object3DEventMap{
    ['animating-changed']: {detail: {key: 'animating', value: boolean, oldValue: boolean}}
    update: {event: PointerEvent, change: 'pointer'} | {change: 'orientation'}
}

/**
 * Extended ViewHelper implemented from the following source:
 * https://github.com/Fennec-hub/viewHelper
 * MIT License
 * Copyright (c) 2022 Fennec-hub
 */
export class ViewHelper2 extends Object3D<ViewHelper2EventMap> {
    camera: OrthographicCamera | PerspectiveCamera
    orthoCamera = new OrthographicCamera(-1.8, 1.8, 1.8, -1.8, 0, 4)
    isViewHelper = true
    @onChangeDispatchEvent()
        animating = false
    target = new Vector3()
    backgroundSphere: Mesh
    axesLines: LineSegments2
    spritePoints: Sprite[]
    domElement: HTMLElement
    domContainer: HTMLElement
    domRect: DOMRect
    // dragging = false
    renderer: WebGLRenderer
    // controls?: OrbitControls | TrackballControls
    // controlsChangeEvent: {listener: () => void}
    viewport: Vector4 = new Vector4()
    offsetHeight = 0

    constructor(
        camera: PerspectiveCamera | OrthographicCamera,
        canvas: HTMLCanvasElement,
        placement: DomPlacement = 'bottom-right',
        size = 128,
        pixelRatio = 2,
    ) {
        super()

        this.renderer = new WebGLRenderer({
            canvas: document.createElement('canvas'),
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: false,
        })
        this.renderer.setPixelRatio(pixelRatio)
        this.camera = camera
        this.domElement = canvas

        this.orthoCamera.position.set(0, 0, 2)

        this.backgroundSphere = getBackgroundSphere()
        this.axesLines = getAxesLines()
        this.spritePoints = getAxesSpritePoints()

        this.add(this.backgroundSphere, this.axesLines, ...this.spritePoints)

        this.domContainer = getDomContainer(placement, size)
        this.domContainer.appendChild(this.renderer.domElement)
        this.renderer.domElement.style.width = '100%'
        this.renderer.domElement.style.height = '100%'

        // This may cause confusion if the parent isn't the body and doesn't have a `position:relative`
        this.domElement.parentElement!.appendChild(this.domContainer)

        this.domRect = this.domContainer.getBoundingClientRect()
        this.startListening()

        // this.controlsChangeEvent = {listener: () => this.updateOrientation()}

        this.update()
        this.updateOrientation()
    }

    startListening() {
        // this.domContainer.onpointerdown = (e) => this.onPointerDown(e)
        this.domContainer.onpointermove = (e) => this.onPointerMove(e)
        this.domContainer.onpointerleave = (e) => this.onPointerLeave(e)
        this.domContainer.onclick = (e) => this.handleClick(e)
    }

    onPointerMove(e: PointerEvent) {
        // if (this.dragging) return;
        (this.backgroundSphere.material as Material).opacity = 0.4
        this.handleHover(e)
        this.dispatchEvent({type: 'update', event: e, change: 'pointer'})
    }

    onPointerLeave(e: PointerEvent) {
        // if (this.dragging) return;
        (this.backgroundSphere.material as Material).opacity = 0.2
        resetSprites(this.spritePoints)
        this.domContainer.style.cursor = ''
        this.dispatchEvent({type: 'update', event: e, change: 'pointer'})
    }

    handleClick(e: PointerEvent|MouseEvent) {
        const object = getIntersectionObject(
            e,
            this.domRect,
            this.orthoCamera,
            this.spritePoints
        )

        if (!object) return

        this.setOrientation(object.userData.type)
    }

    handleHover(e: PointerEvent) {
        const object = getIntersectionObject(
            e,
            this.domRect,
            this.orthoCamera,
            this.spritePoints
        )

        resetSprites(this.spritePoints)

        if (!object) {
            this.domContainer.style.cursor = ''
        } else {
            object.material.map!.offset.x = 0.5
            object.scale.multiplyScalar(1.2)
            this.domContainer.style.cursor = 'pointer'
        }
    }

    render() {
        const delta = clock.getDelta()
        if (this.animating) this.animate(Math.min(delta, 1 / 30.0))

        // const x = this.domRect.left
        // const y = this.offsetHeight - this.domRect.bottom

        const autoClear = this.renderer.autoClear
        this.renderer.autoClear = false
        // this.renderer.setViewport(x, y, dim, dim)
        this.renderer.render(this, this.orthoCamera)
        // this.renderer.setViewport(this.viewport)
        this.renderer.autoClear = autoClear
    }

    updateOrientation(fromCamera = true) {
        if (fromCamera) {
            this.quaternion.copy(this.camera.quaternion).invert()
            this.updateMatrixWorld()
        }

        updateSpritesOpacity(this.spritePoints, this.camera)
    }

    update() {
        this.domRect = this.domContainer.getBoundingClientRect()
        this.offsetHeight = this.domElement.offsetHeight
        setRadius(this.camera, this.target)
        this.renderer.getViewport(this.viewport)

        this.updateOrientation()
    }

    animate(delta: number) {
        const step = delta * turnRate

        // animate position by doing a slerp and then scaling the position on the unit sphere

        q1.rotateTowards(q2, step)
        this.camera.position
            .set(0, 0, 1)
            .applyQuaternion(q1)
            .multiplyScalar(radius)
            .add(this.target)

        // animate orientation

        this.camera.quaternion.rotateTowards(targetQuaternion, step)

        this.updateOrientation()

        if (q1.angleTo(q2) === 0) {
            this.animating = false
        }
    }

    setOrientation(orientation: GizmoOrientation) {
        prepareAnimationData(this.camera, this.target, orientation)
        this.animating = true
        this.dispatchEvent({type: 'update', change: 'orientation'})
    }

    dispose() {
        this.axesLines.geometry.dispose();
        (this.axesLines.material as Material).dispose()

        this.backgroundSphere.geometry.dispose();
        (this.backgroundSphere.material as Material).dispose()

        this.spritePoints.forEach((sprite) => {
            sprite.material.map!.dispose()
            sprite.material.dispose()
        })

        this.domContainer.remove()

        // ;(this.controls as any)?.removeEventListener(
        //     'change',
        //     this.controlsChangeEvent.listener
        // )
    }
}

function getDomContainer(placement: DomPlacement, size: number) {
    const div = document.createElement('div')
    const style = div.style

    style.height = `${size}px`
    style.width = `${size}px`
    style.borderRadius = '100%'
    style.position = 'absolute'

    const [y, x] = placement.split('-')

    style.transform = ''
    style.left = x === 'left' ? '0' : x === 'center' ? '50%' : ''
    style.right = x === 'right' ? '0' : ''
    style.transform += x === 'center' ? 'translateX(-50%)' : ''
    style.top = y === 'top' ? '0' : y === 'bottom' ? '' : '50%'
    style.bottom = y === 'bottom' ? '0' : ''
    style.transform += y === 'center' ? 'translateY(-50%)' : ''

    return div
}

function getAxesLines() {
    const distance = 0.9
    const position = Array(3)
        .fill(0)
        .map((_, i) => [
            !i ? distance : 0,
            i === 1 ? distance : 0,
            i === 2 ? distance : 0,
            0,
            0,
            0,
        ])
        .flat()
    const color = Array(6)
        .fill(0)
        .map((_, i) =>
            i < 2
                ? axesColors[0].toArray()
                : i < 4
                    ? axesColors[1].toArray()
                    : axesColors[2].toArray()
        )
        .flat()

    // const geometry = new BufferGeometry()
    // geometry.setAttribute(
    //     'position',
    //     new BufferAttribute(new Float32Array(position), 3)
    // )
    // geometry.setAttribute(
    //     'color',
    //     new BufferAttribute(new Float32Array(color), 3)
    // )
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(position)
    geometry.setColors(color)

    return new LineSegments2(
        geometry,
        new LineMaterial({
            linewidth: 0.02,
            vertexColors: true,
        })
    )
}

function getBackgroundSphere() {
    const geometry = new SphereGeometry(1.6)
    const sphere = new Mesh(
        geometry,
        new MeshBasicMaterial({
            color: 0xffffff,
            side: BackSide,
            transparent: true,
            opacity: 0.2,
            depthTest: false,
        })
    )

    return sphere
}

function getAxesSpritePoints() {
    const axes = ['x', 'y', 'z'] as const
    return Array(6)
        .fill(0)
        .map((_, i) => {
            const isPositive = i < 3
            const sign = isPositive ? '+' : '-'
            const axis = axes[i % 3]
            const color = axesColors[i % 3]

            const sprite = new Sprite(
                getSpriteMaterial(color, isPositive ? axis : null)
            )
            sprite.userData.type = `${sign}${axis}`
            sprite.scale.setScalar(isPositive ? 0.6 : 0.4)
            sprite.position[axis] = isPositive ? 1.2 : -1.2
            sprite.renderOrder = 1

            return sprite
        })
}

function getSpriteMaterial(color: Color, text: 'x' | 'y' | 'z' | null = null) {
    const canvas = document.createElement('canvas')
    const padding = 0
    const scale = 1
    const padding2 = 0 // has a bug

    canvas.width = 128 * scale + 4 * padding + padding2 * 2
    canvas.height = 64 * scale + 2 * padding + padding2 * 2

    const context = canvas.getContext('2d', {alpha: true})!

    context.beginPath()
    context.arc(32 * scale + padding, 32 * scale + padding, 32 * scale - padding, 0, 2 * Math.PI)
    context.closePath()
    context.fillStyle = color.getStyle()
    context.fill()

    // for black border due to interpolation, transparent slightly bigger circle
    context.beginPath()
    context.arc(32 * scale + padding, 32 * scale + padding, 35 * scale - padding, 0, 2 * Math.PI)
    context.closePath()
    context.fillStyle = '#' + color.getHexString() + '01'
    context.fill()

    context.beginPath()
    context.arc(96 * scale + padding * 3 + padding2, 32 * scale + padding + padding2, 32 * scale - padding - padding2, 0, 2 * Math.PI)
    context.closePath()
    context.fillStyle = '#FFF'
    context.fill()

    // for black border due to interpolation, transparent slightly bigger circle
    context.beginPath()
    context.arc(96 * scale + padding * 3 + padding2, 32 * scale + padding + padding2, 35 + scale - padding - padding2, 0, 2 * Math.PI)
    context.closePath()
    context.fillStyle = '#FFFFFF01'
    context.fill()

    if (text !== null) {
        context.font = 'bold calc(44px * ' + scale + ') Arial'
        context.textAlign = 'center'
        context.fillStyle = '#111'
        context.fillText(text.toUpperCase(), 32 * scale + padding, 48 * scale + padding)
        context.fillText(text.toUpperCase(), 96 * scale + padding * 3 + padding2, 48 * scale + padding + padding2)
    }

    // canvas.style.background = '#ff0000'
    const texture = new CanvasTexture(canvas)
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.repeat.x = 0.5
    texture.colorSpace = SRGBColorSpace
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true


    return new SpriteMaterial({
        map: texture,
        toneMapped: false,
        transparent: true,
    })
}

function prepareAnimationData(
    camera: OrthographicCamera | PerspectiveCamera,
    focusPoint: Vector3,
    axis: GizmoOrientation
) {
    switch (axis) {
    case '+x':
        targetPosition.set(1, 0, 0)
        targetQuaternion.setFromEuler(new Euler(0, Math.PI * 0.5, 0))
        break

    case '+y':
        targetPosition.set(0, 1, 0)
        targetQuaternion.setFromEuler(new Euler(-Math.PI * 0.5, 0, 0))
        break

    case '+z':
        targetPosition.set(0, 0, 1)
        targetQuaternion.setFromEuler(new Euler())
        break

    case '-x':
        targetPosition.set(-1, 0, 0)
        targetQuaternion.setFromEuler(new Euler(0, -Math.PI * 0.5, 0))
        break

    case '-y':
        targetPosition.set(0, -1, 0)
        targetQuaternion.setFromEuler(new Euler(Math.PI * 0.5, 0, 0))
        break

    case '-z':
        targetPosition.set(0, 0, -1)
        targetQuaternion.setFromEuler(new Euler(0, Math.PI, 0))
        break

    default:
        console.error('ViewHelper: Invalid axis.')
    }

    setRadius(camera, focusPoint)
    prepareQuaternions(camera, focusPoint)
}

function setRadius(camera: Camera, focusPoint: Vector3) {
    radius = camera.position.distanceTo(focusPoint)
}

function prepareQuaternions(camera: Camera, focusPoint: Vector3) {
    targetPosition.multiplyScalar(radius).add(focusPoint)

    dummy.position.copy(focusPoint)

    dummy.lookAt(camera.position)
    q1.copy(dummy.quaternion)

    dummy.lookAt(targetPosition)
    q2.copy(dummy.quaternion)
}

function updatePointer(
    e: PointerEvent|MouseEvent,
    domRect: DOMRect,
    orthoCamera: OrthographicCamera
) {
    mouse.x = (e.clientX - domRect.left) / domRect.width * 2 - 1
    mouse.y = -((e.clientY - domRect.top) / domRect.height) * 2 + 1

    raycaster.setFromCamera(mouse, orthoCamera)
}

// function isClick(
//     e: PointerEvent,
//     startCoords: Vector2,
//     threshold = 2
// ) {
//     return (
//         Math.abs(e.clientX - startCoords.x) < threshold &&
//         Math.abs(e.clientY - startCoords.y) < threshold
//     )
// }

function getIntersectionObject(
    event: PointerEvent|MouseEvent,
    domRect: DOMRect,
    orthoCamera: OrthographicCamera,
    intersectionObjects: Sprite[]
) {
    updatePointer(event, domRect, orthoCamera)

    const intersects = raycaster.intersectObjects(intersectionObjects)

    if (!intersects.length) return null

    const intersection = intersects[0]
    return intersection.object as Sprite
}

function resetSprites(sprites: Sprite[]) {
    let i = sprites.length

    while (i--) {
        const scale = i < 3 ? 0.6 : 0.4
        sprites[i].scale.set(scale, scale, scale)
        sprites[i].material.map!.offset.x = 1
    }
    // sprites.forEach((sprite) => (sprite.material.map!.offset.x = 1));
}

function updateSpritesOpacity(sprites: Sprite[], camera: Camera) {
    point.set(0, 0, 1)
    point.applyQuaternion(camera.quaternion)

    if (point.x >= 0) {
        sprites[POS_X].material.opacity = 1
        sprites[NEG_X].material.opacity = 0.5
    } else {
        sprites[POS_X].material.opacity = 0.5
        sprites[NEG_X].material.opacity = 1
    }

    if (point.y >= 0) {
        sprites[POS_Y].material.opacity = 1
        sprites[NEG_Y].material.opacity = 0.5
    } else {
        sprites[POS_Y].material.opacity = 0.5
        sprites[NEG_Y].material.opacity = 1
    }

    if (point.z >= 0) {
        sprites[POS_Z].material.opacity = 1
        sprites[NEG_Z].material.opacity = 0.5
    } else {
        sprites[POS_Z].material.opacity = 0.5
        sprites[NEG_Z].material.opacity = 1
    }
}
