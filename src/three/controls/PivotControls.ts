/* eslint-disable */
import {
    BoxGeometry,
    Camera,
    CylinderGeometry,
    Group,
    LineBasicMaterial,
    MathUtils,
    Matrix4,
    Mesh,
    Object3DEventMap,
    MeshBasicMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Plane,
    Quaternion,
    Raycaster,
    Ray,
    SphereGeometry,
    TorusGeometry,
    Vector2,
    Vector3,
} from 'three'

// ============================================================================
// Math helpers (ported from drei)
// ============================================================================

const _vec1 = new Vector3()
const _vec2 = new Vector3()

function calculateOffset(clickPoint: Vector3, normal: Vector3, rayStart: Vector3, rayDir: Vector3): number {
    const e1 = normal.dot(normal)
    const e2 = normal.dot(clickPoint) - normal.dot(rayStart)
    const e3 = normal.dot(rayDir)
    if (e3 === 0) return -e2 / e1
    _vec1.copy(rayDir).multiplyScalar(e1 / e3).sub(normal)
    _vec2.copy(rayDir).multiplyScalar(e2 / e3).add(rayStart).sub(clickPoint)
    return -_vec1.dot(_vec2) / _vec1.dot(_vec1)
}


function decomposeIntoBasis(e1: Vector3, e2: Vector3, offset: Vector3): [number, number] {
    const i1 = Math.abs(e1.x) >= Math.abs(e1.y) && Math.abs(e1.x) >= Math.abs(e1.z) ? 0
        : Math.abs(e1.y) >= Math.abs(e1.x) && Math.abs(e1.y) >= Math.abs(e1.z) ? 1 : 2
    const order = [0, 1, 2].sort((a, b) => Math.abs(e2.getComponent(b)) - Math.abs(e2.getComponent(a)))
    const i2 = i1 === order[0] ? order[1] : order[0]
    const a1 = e1.getComponent(i1), a2 = e1.getComponent(i2)
    const b1 = e2.getComponent(i1), b2 = e2.getComponent(i2)
    const c1 = offset.getComponent(i1), c2 = offset.getComponent(i2)
    const y = (c2 - c1 * (a2 / a1)) / (b2 - b1 * (a2 / a1))
    const x = (c1 - y * b1) / a1
    return [x, y]
}


// ============================================================================
// Reusable temps
// ============================================================================

const _mL0 = new Matrix4()
const _mW0 = new Matrix4()
const _mP = new Matrix4()
const _mPInv = new Matrix4()
const _mW = new Matrix4()
const _mL = new Matrix4()
const _mL0Inv = new Matrix4()
const _mdL = new Matrix4()
const _offsetMatrix = new Matrix4()
const _rotMatrix = new Matrix4()
const _scaleMatrix = new Matrix4()
const _pointer = new Vector2()
const _worldPos = new Vector3()
const _camPos = new Vector3()
const _posNew = new Vector3()
// const _scaleV = new Vector3()
const _ray = new Ray()
const _intersection = new Vector3()
const _upV = new Vector3(0, 1, 0)
const _xDir = new Vector3(1, 0, 0)
const _yDir = new Vector3(0, 1, 0)
const _zDir = new Vector3(0, 0, 1)

// ============================================================================
// Handle types
// ============================================================================

type HandleType = 'arrow' | 'slider' | 'rotator' | 'scaler'

interface HandleInfo {
    type: HandleType
    axis: 0 | 1 | 2
    gizmoMeshes: Mesh[]      // visible meshes
    pickerMeshes: Mesh[]     // invisible picker meshes
    materials: MeshBasicMaterial[]
    // drag state
    clickInfo: any
    extraState: any
}

// ============================================================================
// PivotControls
// ============================================================================

export interface PivotControlsEventMap {
    change: {}
    objectChange: {}
    mouseDown: { mode: string }
    mouseUp: { mode: string }
    'dragging-changed': { value: boolean }
}

/**
 * PivotControls - A gizmo that shows all transform handles simultaneously
 * (translation arrows, plane sliders, rotation arcs, scaling spheres).
 * Follows the same architecture as TransformControls — single class,
 * mesh-based geometry, ObjectConstructors for material injection.
 */
export class PivotControls extends Group<PivotControlsEventMap & Object3DEventMap> {

    static ObjectConstructors: {
        MeshBasicMaterial: typeof MeshBasicMaterial
        LineBasicMaterial: typeof LineBasicMaterial
    } = {
        MeshBasicMaterial: MeshBasicMaterial,
        LineBasicMaterial: LineBasicMaterial,
    }

    camera: Camera
    domElement: HTMLCanvasElement
    object: Object3D | undefined

    enabled = true
    autoTransform = true
    /** Scale multiplier for the gizmo, same as TransformControls 'size'. Applied per-frame. */
    gizmoScale = 1.25
    activeAxes: [boolean, boolean, boolean] = [true, true, true]
    disableAxes = false
    disableSliders = false
    disableRotations = false
    disableScaling = false
    translationLimits?: ([number, number] | undefined)[]
    rotationLimits?: ([number, number] | undefined)[]
    scaleLimits?: ([number, number] | undefined)[]
    axisColors: [number, number, number] = [0xEF0065, 0x1EBE00, 0x0093FD]
    hoveredColor = 0xffff40
    handleOpacity = 0.95
    /** Coordinate space for transformations. 'world' or 'local'. */
    space: 'world' | 'local' = 'world'
    /** Snap values when shift is held. Set to null to disable snapping for that transform. */
    translationSnap: number | null = 0.5
    rotationSnap: number | null = 15 // degrees
    scaleSnap: number | null = 0.1
    /** Whether gizmo materials use depth testing. false = always visible through objects. */
    depthTest = false
    /** When true, gizmo maintains constant screen size regardless of camera distance (default). */
    fixed = true
    /** When true, alt/option+drag on a scale sphere applies uniform scale. */
    uniformScaleEnabled = true
    /** Show value annotations during drag. */
    annotations = true

    private _gizmoGroup: Group
    private _handles: HandleInfo[] = []
    private _raycaster = new Raycaster()
    private _activeHandle: HandleInfo | null = null
    private _dragging = false
    private _hoveredHandle: HandleInfo | null = null
    private _translation: [number, number, number] = [0, 0, 0]
    private _uniformScaling = false
    private _annotationEl: HTMLDivElement | null = null

    private _onPointerDown: (e: PointerEvent) => void
    private _onPointerMove: (e: PointerEvent) => void
    private _onPointerUp: (e: PointerEvent) => void

    constructor(camera: Camera, domElement: HTMLCanvasElement) {
        super()
        this.camera = camera
        this.domElement = domElement

        this._gizmoGroup = new Group()
        this.add(this._gizmoGroup)

        this._buildHandles()

        this._onPointerDown = this._handlePointerDown.bind(this)
        this._onPointerMove = this._handlePointerMove.bind(this)
        this._onPointerUp = this._handlePointerUp.bind(this)

        domElement.addEventListener('pointerdown', this._onPointerDown)
        domElement.addEventListener('pointermove', this._onPointerMove)
        domElement.addEventListener('pointerup', this._onPointerUp)

        this._onKeyDown = this._handleKeyDown.bind(this)
        window.addEventListener('keydown', this._onKeyDown)
    }

    // ========================================================================
    // Keyboard shortcuts (consistent with TransformControls2)
    // ========================================================================

    private _onKeyDown: (e: KeyboardEvent) => void

    private _handleKeyDown(event: KeyboardEvent): void {
        if (!this.enabled || !this.object) return
        if (event.metaKey || event.ctrlKey) return
        if ((event.target as any)?.tagName === 'TEXTAREA' || (event.target as any)?.tagName === 'INPUT') return

        switch (event.code) {

        case 'KeyQ':
            this.space = this.space === 'local' ? 'world' : 'local'
            break

        case 'Equal':
        case 'NumpadAdd':
        case 'Plus':
            this.gizmoScale = this.gizmoScale + 0.1
            break

        case 'Minus':
        case 'NumpadSubtract':
        case 'Underscore':
            this.gizmoScale = Math.max(this.gizmoScale - 0.1, 0.1)
            break

        case 'KeyX':
            this.activeAxes[0] = !this.activeAxes[0]
            this.updateHandleVisibility()
            break

        case 'KeyY':
            this.activeAxes[1] = !this.activeAxes[1]
            this.updateHandleVisibility()
            break

        case 'KeyZ':
            this.activeAxes[2] = !this.activeAxes[2]
            this.updateHandleVisibility()
            break

        case 'Space':
            this.enabled = !this.enabled
            break

        default:
            return
        }

        this.dispatchEvent({type: 'change'})
    }

    // ========================================================================
    // Annotation overlay
    // ========================================================================

    private _ensureAnnotationEl(): HTMLDivElement {
        if (!this._annotationEl) {
            const el = document.createElement('div')
            el.style.cssText = 'position:absolute;pointer-events:none;display:none;' +
                'background:#151520;color:white;padding:6px 8px;border-radius:7px;' +
                'white-space:nowrap;z-index:1000;'
            this.domElement.parentElement?.appendChild(el)
            this._annotationEl = el
        }
        return this._annotationEl
    }

    private _showAnnotation(text: string, worldPos: Vector3): void {
        if (!this.annotations) return
        const el = this._ensureAnnotationEl()
        el.textContent = text
        el.style.display = 'block'

        // Project world position to screen
        const v = worldPos.clone().project(this.camera)
        const rect = this.domElement.getBoundingClientRect()
        const x = (v.x * 0.5 + 0.5) * rect.width
        const y = (-v.y * 0.5 + 0.5) * rect.height
        el.style.left = (rect.left + x + 12) + 'px'
        el.style.top = (rect.top + y - 12) + 'px'
    }

    private _hideAnnotation(): void {
        if (this._annotationEl) this._annotationEl.style.display = 'none'
    }

    private _updateAnnotation(h: HandleInfo): void {
        if (!this.annotations || !this.object) return
        const axisLabels = ['X', 'Y', 'Z']
        let text = ''
        if (h.type === 'arrow') {
            text = `${axisLabels[h.axis]}: ${this._translation[h.axis].toFixed(2)}`
        } else if (h.type === 'slider') {
            const a1 = (h.axis + 1) % 3, a2 = (h.axis + 2) % 3
            text = `${axisLabels[a1]}: ${this._translation[a1].toFixed(2)}, ${axisLabels[a2]}: ${this._translation[a2].toFixed(2)}`
        } else if (h.type === 'rotator') {
            const deg = (h.extraState.angle * 180 / Math.PI).toFixed(0)
            text = `${axisLabels[h.axis]}: ${deg}°`
        } else if (h.type === 'scaler') {
            const label = this._uniformScaling ? 'Uniform' : axisLabels[h.axis]
            text = `${label}: ${h.extraState.scaleCur.toFixed(2)}`
        }
        this._showAnnotation(text, this.position)
    }

    // ========================================================================
    // Build gizmo geometry
    // ========================================================================

    private _buildHandles(): void {
        this._handles = []
        this._gizmoGroup.clear()

        const OC = PivotControls.ObjectConstructors
        // Build geometry at unit scale. gizmoScale is applied in updateGizmoScale() per frame.
        const s = 1

        const dt = this.depthTest

        const makeMat = (color: number, opacity = this.handleOpacity) => new OC.MeshBasicMaterial({
            allowOverride: false,
            depthTest: dt,
            depthWrite: dt,
            fog: false,
            toneMapped: false,
            transparent: true,
            color,
            opacity,
        })

        const makePickerMat = () => new OC.MeshBasicMaterial({
            allowOverride: false,
            depthTest: false,
            depthWrite: false,
            fog: false,
            toneMapped: false,
            transparent: true,
            opacity: 0.15,
            visible: false,
        })

        const dirs = [_xDir, _yDir, _zDir]

        // --- Axis arrows (translate) ---
        for (let i = 0; i < 3; i++) {
            const mat = makeMat(this.axisColors[i])
            const pMat = makePickerMat()

            // Shaft: thin cylinder
            const shaftGeom = new CylinderGeometry(0.0075 * s, 0.0075 * s, 0.5 * s, 3)
            shaftGeom.translate(0, 0.25 * s, 0)
            const shaft = new Mesh(shaftGeom, mat)
            shaft.renderOrder = 500
            shaft.raycast = () => {}

            // Cone tip
            const coneGeom = new CylinderGeometry(0, 0.04 * s, 0.1 * s, 12)
            coneGeom.translate(0, 0.05 * s, 0)
            const cone = new Mesh(coneGeom, mat)
            cone.position.set(0, 0.5 * s, 0)
            cone.renderOrder = 500
            cone.raycast = () => {}

            // Picker
            const pickerGeom = new CylinderGeometry(0.2 * s, 0, 0.6 * s, 4)
            pickerGeom.translate(0, 0.3 * s, 0)
            const picker = new Mesh(pickerGeom, pMat)
            picker.visible = false

            // Orient along axis direction
            const q = new Quaternion().setFromUnitVectors(_upV, dirs[i])
            const group = new Group()
            group.quaternion.copy(q)
            group.add(shaft, cone, picker)
            this._gizmoGroup.add(group)

            const handle: HandleInfo = {
                type: 'arrow', axis: i as 0|1|2,
                gizmoMeshes: [shaft, cone], pickerMeshes: [picker],
                materials: [mat], clickInfo: null, extraState: null,
            }
            picker.userData._pivotHandle = handle
            this._handles.push(handle)
        }

        // --- Plane sliders (translate on plane) ---
        // axis 2 = XY plane, axis 1 = XZ plane, axis 0 = YZ plane
        const sliderDefs: [number, Vector3, Vector3][] = [[2, _xDir, _yDir], [1, _zDir, _xDir], [0, _yDir, _zDir]]
        for (const [axis, d1, d2] of sliderDefs) {
            const mat = makeMat(this.axisColors[axis], 0.75)
            const pMat = makePickerMat()

            const planeSize = 0.2 * s
            const planeGeom = new BoxGeometry(planeSize, planeSize, 0.01 * s)
            const planeMesh = new Mesh(planeGeom, mat)
            planeMesh.renderOrder = 500
            planeMesh.raycast = () => {}

            const pickerGeom = new BoxGeometry(planeSize * 1.25, planeSize * 1.25, 0.01 * s)
            const picker = new Mesh(pickerGeom, pMat)
            picker.visible = false

            // Position offset like TransformControls XY/YZ/XZ
            const d1n = d1.clone().normalize()
            const d2n = d2.clone().normalize()
            const normal = d1n.clone().cross(d2n)
            const pos = d1n.clone().multiplyScalar(planeSize).add(d2n.clone().multiplyScalar(planeSize))

            const group = new Group()
            const basis = new Matrix4().makeBasis(d1n, d2n, normal)
            group.applyMatrix4(basis)
            group.position.copy(pos)
            group.add(planeMesh, picker)
            this._gizmoGroup.add(group)

            const handle: HandleInfo = {
                type: 'slider', axis: axis as 0|1|2,
                gizmoMeshes: [planeMesh], pickerMeshes: [picker],
                materials: [mat], clickInfo: null, extraState: null,
            }
            picker.userData._pivotHandle = handle
            this._handles.push(handle)
        }

        // --- Axis rotators ---
        // axis 2 = around Z (XY plane), axis 1 = around Y (XZ plane), axis 0 = around X (YZ plane)
        const rotatorDefs: [number, Vector3, Vector3][] = [[2, _xDir, _yDir], [1, _zDir, _xDir], [0, _yDir, _zDir]]
        for (const [axis, d1, d2] of rotatorDefs) {
            const mat = makeMat(this.axisColors[axis])
            const pMat = makePickerMat()

            // Visible: quarter torus (like TransformControls CircleGeometry)
            const r = 0.5 * s
            const torusGeom = new TorusGeometry(r, 0.0075 * s, 3, 16, Math.PI / 2)
            const torus = new Mesh(torusGeom, mat)
            torus.renderOrder = 500
            torus.raycast = () => {}

            // Picker: thicker quarter torus (like TransformControls CircleGeometry2)
            const pickerGeom = new TorusGeometry(r, 0.1 * s, 4, 12, Math.PI / 2)
            const picker = new Mesh(pickerGeom, pMat)
            picker.visible = false

            const d1n = d1.clone().normalize()
            const d2n = d2.clone().normalize()
            const normal = d1n.clone().cross(d2n)
            const group = new Group()
            const basis = new Matrix4().makeBasis(d1n, d2n, normal)
            group.applyMatrix4(basis)
            group.add(torus, picker)
            this._gizmoGroup.add(group)

            const handle: HandleInfo = {
                type: 'rotator', axis: axis as 0|1|2,
                gizmoMeshes: [torus], pickerMeshes: [picker],
                materials: [mat], clickInfo: null, extraState: { angle0: 0, angle: 0 },
            }
            picker.userData._pivotHandle = handle
            this._handles.push(handle)
        }

        // --- Scaling spheres ---
        for (let i = 0; i < 3; i++) {
            const mat = makeMat(this.axisColors[i])
            const r = 0.04 * s

            const sphereGeom = new SphereGeometry(r, 12, 12)
            const sphere = new Mesh(sphereGeom, mat)
            sphere.renderOrder = 500

            const q = new Quaternion().setFromUnitVectors(_upV, dirs[i])
            const group = new Group()
            group.quaternion.copy(q)
            // Place sphere at the end of the arrow
            sphere.position.set(0, 0.6 * s + r, 0)
            group.add(sphere)
            this._gizmoGroup.add(group)

            const handle: HandleInfo = {
                type: 'scaler', axis: i as 0|1|2,
                gizmoMeshes: [sphere], pickerMeshes: [sphere], // sphere is its own picker
                materials: [mat], clickInfo: null, extraState: { scale0: 1, scaleCur: 1 },
            }
            sphere.userData._pivotHandle = handle
            this._handles.push(handle)
        }

        this.updateHandleVisibility()

        this._gizmoGroup.traverse(c => {
            c.castShadow = false
            c.receiveShadow = false
            c.userData.__keepShadowDef = true
        })
    }

    updateHandleVisibility(): void {
        if (!this._handles) return
        for (const h of this._handles) {
            let vis = true
            if (h.type === 'arrow') vis = !this.disableAxes && this.activeAxes[h.axis]
            else if (h.type === 'scaler') vis = !this.disableScaling && this.activeAxes[h.axis]
            else if (h.type === 'slider') {
                // slider axis 2 = XY (needs X,Y active), 1 = XZ (needs X,Z), 0 = YZ (needs Y,Z)
                const pairs: [number,number][] = [[1,2],[0,2],[0,1]]
                const [a,b] = pairs[h.axis]
                vis = !this.disableSliders && this.activeAxes[a] && this.activeAxes[b]
            } else if (h.type === 'rotator') {
                const pairs: [number,number][] = [[1,2],[0,2],[0,1]]
                const [a,b] = pairs[h.axis]
                vis = !this.disableRotations && this.activeAxes[a] && this.activeAxes[b]
            }
            for (const m of h.gizmoMeshes) m.visible = vis
            for (const m of h.pickerMeshes) {
                // pickers are always invisible but we toggle their raycast-ability via parent
                if (m.parent) m.parent.visible = vis
            }
        }
    }

    // ========================================================================
    // Public API
    // ========================================================================

    attach(object: Object3D): this {
        this.object = object
        this.visible = true
        this._translation = [0, 0, 0]
        this.updateHandleVisibility()
        this.updateMatrixWorld(true)
        this.dispatchEvent({type: 'change'})
        return this
    }

    detach(): this {
        this.object = undefined
        this.visible = false
        this._activeHandle = null
        this._dragging = false
        this.dispatchEvent({type: 'change'})
        return this
    }

    updateGizmoScale(): void {
        if (!this.object || !this.visible) return

        this.object.updateWorldMatrix(true, false)
        const objectWorldPos = new Vector3().setFromMatrixPosition(this.object.matrixWorld)
        this.position.copy(objectWorldPos)

        // In local space, orient gizmo to match object's world rotation (without scale)
        if (this.space === 'local') {
            this.object.matrixWorld.decompose(_worldPos, this.quaternion, _camPos) // _camPos used as temp for scale
        } else {
            this.quaternion.identity()
        }

        if (this.fixed) {
            // Fixed screen-size scaling (same formula as TransformControls)
            _worldPos.copy(objectWorldPos)
            _camPos.setFromMatrixPosition(this.camera.matrixWorld)

            let factor: number
            if ((this.camera as OrthographicCamera).isOrthographicCamera) {
                const cam = this.camera as OrthographicCamera
                factor = (cam.top - cam.bottom) / cam.zoom
            } else {
                const cam = this.camera as PerspectiveCamera
                factor = _worldPos.distanceTo(_camPos) *
                    Math.min(1.9 * Math.tan(Math.PI * cam.fov / 360) / cam.zoom, 7)
            }
            this._gizmoGroup.scale.setScalar(factor * this.gizmoScale / 4)
        } else {
            // World-space scale
            this._gizmoGroup.scale.setScalar(this.gizmoScale)
        }

        // Visual feedback: enlarge all scale spheres during uniform scaling
        for (const h of this._handles) {
            if (h.type === 'scaler') {
                const scaleFactor = this._uniformScaling ? 1.8 : 1
                for (const m of h.gizmoMeshes) m.scale.setScalar(scaleFactor)
            }
        }
    }

    rebuild(): void {
        this._buildHandles()
    }

    dispose(): void {
        this.domElement.removeEventListener('pointerdown', this._onPointerDown)
        this.domElement.removeEventListener('pointermove', this._onPointerMove)
        this.domElement.removeEventListener('pointerup', this._onPointerUp)
        window.removeEventListener('keydown', this._onKeyDown)
        if (this._annotationEl) {
            this._annotationEl.remove()
            this._annotationEl = null
        }
    }

    // ========================================================================
    // Pointer handling
    // ========================================================================

    private _getNDC(event: PointerEvent): Vector2 {
        const rect = this.domElement.getBoundingClientRect()
        _pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        _pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
        return _pointer
    }

    private _getAllPickers(): Object3D[] {
        const result: Object3D[] = []
        for (const h of this._handles) {
            for (const m of h.pickerMeshes) result.push(m)
        }
        return result
    }

    private _findHandle(object: Object3D): HandleInfo | null {
        let obj: Object3D | null = object
        while (obj) {
            if (obj.userData._pivotHandle) return obj.userData._pivotHandle as HandleInfo
            obj = obj.parent
        }
        return null
    }

    private _handlePointerDown(event: PointerEvent): void {
        if (!this.enabled || !this.object || !this.visible) return

        this._raycaster.setFromCamera(this._getNDC(event), this.camera)
        const intersects = this._raycaster.intersectObjects(this._getAllPickers(), true)
        if (intersects.length === 0) return

        const handle = this._findHandle(intersects[0].object)
        if (!handle) return

        event.stopPropagation()
        this._activeHandle = handle
        this._dragging = true

        _mL0.copy(this.object.matrix)
        _mW0.copy(this.object.matrixWorld)

        this._onDragStart(handle, intersects[0].point, event)
        this.domElement.setPointerCapture(event.pointerId)

        this.dispatchEvent({type: 'mouseDown', mode: this._getMode(handle)})
        this.dispatchEvent({type: 'dragging-changed', value: true})
    }

    private _handlePointerMove(event: PointerEvent): void {
        if (!this.enabled || !this.object || !this.visible) return

        this._raycaster.setFromCamera(this._getNDC(event), this.camera)

        if (this._dragging && this._activeHandle) {
            const deltaWorld = this._onDragMove(this._activeHandle, this._raycaster.ray, event)
            if (deltaWorld) {
                this._applyTransform(deltaWorld)
                this._updateAnnotation(this._activeHandle)
            }
        } else {
            // Hover
            const intersects = this._raycaster.intersectObjects(this._getAllPickers(), true)
            const newHover = intersects.length > 0 ? this._findHandle(intersects[0].object) : null

            if (newHover !== this._hoveredHandle) {
                // Reset old
                if (this._hoveredHandle) {
                    for (const mat of this._hoveredHandle.materials)
                        mat.color.set(this.axisColors[this._hoveredHandle.axis])
                }
                // Highlight new
                if (newHover) {
                    for (const mat of newHover.materials)
                        mat.color.set(this.hoveredColor)
                }
                this._hoveredHandle = newHover
                this.dispatchEvent({type: 'change'})
            }
        }
    }

    private _handlePointerUp(event: PointerEvent): void {
        if (!this._dragging || !this._activeHandle) return

        event.stopPropagation()
        this._onDragEnd(this._activeHandle)
        this._hideAnnotation()

        const mode = this._getMode(this._activeHandle)
        this._activeHandle = null
        this._dragging = false

        this.domElement.releasePointerCapture(event.pointerId)
        this.dispatchEvent({type: 'mouseUp', mode})
        this.dispatchEvent({type: 'dragging-changed', value: false})
    }

    // ========================================================================
    // Per-handle drag logic
    // ========================================================================

    private _onDragStart(h: HandleInfo, point: Vector3, _event: PointerEvent): void {
        const parent = h.gizmoMeshes[0].parent!
        parent.updateWorldMatrix(true, true)

        if (h.type === 'arrow') {
            const rotation = new Matrix4().extractRotation(parent.matrixWorld)
            const dir = _upV.clone().applyMatrix4(rotation).normalize()
            h.clickInfo = { clickPoint: point.clone(), dir }
            h.extraState = this._translation[h.axis]

        } else if (h.type === 'slider') {
            const e1 = new Vector3().setFromMatrixColumn(parent.matrixWorld, 0).normalize()
            const e2 = new Vector3().setFromMatrixColumn(parent.matrixWorld, 1).normalize()
            const normal = new Vector3().setFromMatrixColumn(parent.matrixWorld, 2).normalize()
            const origin = new Vector3().setFromMatrixPosition(parent.matrixWorld)
            const plane = new Plane().setFromNormalAndCoplanarPoint(normal, origin)
            h.clickInfo = { clickPoint: point.clone(), e1, e2, plane }
            h.extraState = {
                x0: this._translation[(h.axis + 1) % 3],
                y0: this._translation[(h.axis + 2) % 3],
            }

        } else if (h.type === 'rotator') {
            const origin = new Vector3().setFromMatrixPosition(parent.matrixWorld)
            const normal = new Vector3().setFromMatrixColumn(parent.matrixWorld, 2).normalize()
            // Compute a perpendicular direction in screen space for linear rotation
            const eye = new Vector3().setFromMatrixPosition(this.camera.matrixWorld).sub(origin).normalize()
            const tangent = normal.clone().cross(eye)
            if (tangent.length() === 0) tangent.copy(eye).cross(_upV) // fallback
            tangent.normalize()
            const rotSpeed = 20 / origin.distanceTo(new Vector3().setFromMatrixPosition(this.camera.matrixWorld))
            h.clickInfo = { clickPoint: point.clone(), origin, normal, tangent, rotSpeed }
            h.extraState = { angle: 0 }

        } else if (h.type === 'scaler') {
            const rotation = new Matrix4().extractRotation(parent.matrixWorld)
            const dir = _upV.clone().applyMatrix4(rotation).normalize()
            const mPLG = parent.matrixWorld.clone()
            const mPLGInv = mPLG.clone().invert()
            h.clickInfo = { clickPoint: point.clone(), dir, mPLG, mPLGInv }
        }
    }

    private _onDragMove(h: HandleInfo, ray: Ray, event: PointerEvent): Matrix4 | null {
        if (!h.clickInfo) return null

        if (h.type === 'arrow') {
            const { clickPoint, dir } = h.clickInfo
            const offset0 = h.extraState as number
            const limits = this.translationLimits?.[h.axis]
            let offset = calculateOffset(clickPoint, dir, ray.origin, ray.direction)
            if (event.shiftKey && this.translationSnap !== null) {
                const snap = this.translationSnap
                offset = Math.round(offset / snap) * snap
            }
            if (limits) {
                if (limits[0] !== undefined) offset = Math.max(offset, limits[0] - offset0)
                if (limits[1] !== undefined) offset = Math.min(offset, limits[1] - offset0)
            }
            this._translation[h.axis] = offset0 + offset
            _offsetMatrix.makeTranslation(dir.x * offset, dir.y * offset, dir.z * offset)
            return _offsetMatrix

        } else if (h.type === 'slider') {
            const { clickPoint, e1, e2, plane } = h.clickInfo
            const { x0, y0 } = h.extraState

            _ray.copy(ray)
            _ray.intersectPlane(plane, _intersection)
            _ray.direction.negate()
            _ray.intersectPlane(plane, _intersection)
            _intersection.sub(clickPoint)

            let [ox, oy] = decomposeIntoBasis(e1, e2, _intersection)
            if (event.shiftKey && this.translationSnap !== null) {
                const snap = this.translationSnap
                ox = Math.round(ox / snap) * snap
                oy = Math.round(oy / snap) * snap
            }
            const limX = this.translationLimits?.[(h.axis + 1) % 3]
            const limY = this.translationLimits?.[(h.axis + 2) % 3]
            if (limX) {
                if (limX[0] !== undefined) ox = Math.max(ox, limX[0] - x0)
                if (limX[1] !== undefined) ox = Math.min(ox, limX[1] - x0)
            }
            if (limY) {
                if (limY[0] !== undefined) oy = Math.max(oy, limY[0] - y0)
                if (limY[1] !== undefined) oy = Math.min(oy, limY[1] - y0)
            }
            this._translation[(h.axis + 1) % 3] = x0 + ox
            this._translation[(h.axis + 2) % 3] = y0 + oy
            _offsetMatrix.makeTranslation(ox * e1.x + oy * e2.x, ox * e1.y + oy * e2.y, ox * e1.z + oy * e2.z)
            return _offsetMatrix

        } else if (h.type === 'rotator') {
            const { clickPoint, origin, normal, tangent, rotSpeed } = h.clickInfo
            const limits = this.rotationLimits?.[h.axis] as [number,number] | undefined

            // Linear rotation: project ray-plane intersection offset onto tangent direction
            // This gives continuous rotation without atan2 wrapping (same approach as TransformControls)
            const plane = new Plane().setFromNormalAndCoplanarPoint(normal, origin)
            _ray.copy(ray)
            if (!_ray.intersectPlane(plane, _intersection)) {
                _ray.direction.negate()
                _ray.intersectPlane(plane, _intersection)
            }
            _intersection.sub(clickPoint)
            let da = _intersection.dot(tangent) * rotSpeed

            if (event.shiftKey && this.rotationSnap !== null) {
                const snapRad = this.rotationSnap * Math.PI / 180
                da = Math.round(da / snapRad) * snapRad
            }
            if (limits) {
                da = MathUtils.clamp(da, limits[0], limits[1])
            }
            h.extraState.angle = da

            _rotMatrix.makeRotationAxis(normal, da)
            _posNew.copy(origin).applyMatrix4(_rotMatrix).sub(origin).negate()
            _rotMatrix.setPosition(_posNew)
            return _rotMatrix

        } else if (h.type === 'scaler') {
            const { clickPoint, dir, mPLG, mPLGInv } = h.clickInfo
            const limits = this.scaleLimits?.[h.axis] as [number,number] | undefined

            const offsetW = calculateOffset(clickPoint, dir, ray.origin, ray.direction)
            let upscale = Math.pow(2, offsetW * 0.2)

            // Shift = snap, Alt = uniform scale
            if (event.shiftKey && this.scaleSnap !== null) {
                upscale = Math.round(upscale / this.scaleSnap) * this.scaleSnap
                if (upscale === 0) upscale = this.scaleSnap
            }
            const isUniform = this.uniformScaleEnabled && event.altKey
            this._uniformScaling = isUniform

            const min = limits ? limits[0] : 1e-5
            upscale = Math.max(upscale, min / h.extraState.scale0)
            if (limits && limits[1] !== undefined) upscale = Math.min(upscale, limits[1] / h.extraState.scale0)
            h.extraState.scaleCur = h.extraState.scale0 * upscale

            if (isUniform) {
                // Uniform scale: apply same factor to all axes
                _scaleMatrix.makeScale(upscale, upscale, upscale)
            } else {
                // Single-axis scale in the handle's local space (local Y = world axis direction)
                _scaleMatrix.makeScale(1, upscale, 1).premultiply(mPLG).multiply(mPLGInv)
            }
            return _scaleMatrix
        }

        return null
    }

    private _onDragEnd(h: HandleInfo): void {
        if (h.type === 'rotator') h.extraState.angle0 = h.extraState.angle
        if (h.type === 'scaler') h.extraState.scale0 = h.extraState.scaleCur
        this._uniformScaling = false
        h.clickInfo = null
    }

    // ========================================================================
    // Transform application (drei matrix math)
    // ========================================================================

    private _applyTransform(mdW: Matrix4): void {
        if (!this.object) return
        if (this.object.parent) {
            _mP.copy(this.object.parent.matrixWorld)
        } else {
            _mP.identity()
        }
        _mPInv.copy(_mP).invert()
        _mW.copy(_mW0).premultiply(mdW)
        _mL.copy(_mW).premultiply(_mPInv)
        _mL0Inv.copy(_mL0).invert()
        _mdL.copy(_mL).multiply(_mL0Inv)

        if (this.autoTransform) {
            this.object.matrix.copy(_mL)
            this.object.matrix.decompose(this.object.position, this.object.quaternion, this.object.scale)
        }
        this.dispatchEvent({type: 'objectChange'})
        this.dispatchEvent({type: 'change'})
    }

    private _getMode(h: HandleInfo): string {
        if (h.type === 'arrow' || h.type === 'slider') return 'translate'
        if (h.type === 'rotator') return 'rotate'
        if (h.type === 'scaler') return 'scale'
        return 'unknown'
    }
}
