/**
 * Viewport navigation per keymap preset: which mouse button orbits, pans and zooms, what a left drag
 * means, and what a trackpad's two-finger scroll and pinch do.
 *
 * The camera controls are threepipe's `OrbitControls3` (three.js `OrbitControls`). Its `mouseButtons`
 * table decides what each button does, with one rule from three.js itself: a ROTATE button with
 * Ctrl/Shift held pans instead (`OrbitControls.js` `onMouseDown`, :1395-1405) - which is exactly
 * Blender's MMB orbit / Shift+MMB pan. What `OrbitControls` cannot express is a *modifier* on the
 * left button (Alt+LMB orbit, Space+LMB pan) or a left button that does nothing because a drag
 * selects; both are done here by rewriting `mouseButtons.LEFT` on each `pointerdown`, in the
 * capture phase, before the controls read it.
 *
 * Trackpad: a `wheel` event with small pixel deltas is taken to be a two-finger scroll, a `wheel`
 * with `ctrlKey` a pinch (browsers report pinch that way). The threshold and the 150 ms gesture
 * lock are kokraf's (`js/controls/QuaternionOrbitControls.js:211-262`), the one web modeller in
 * the research that handles trackpads at all. Two-finger scroll orbits (Blender, `km_view3d`
 * TRACKPADPAN :1653) or pans (Figma, the Design preset); Shift+two-finger does the other one;
 * pinch zooms through the controls' own wheel handler.
 */

import {MOUSE, PerspectiveCamera, Quaternion, Spherical, ThreeViewer, Vector3} from 'threepipe'
import {GESTURE_TEXT} from '../registry'
import type {EditorMode, GestureKind, KeymapPreset, NavigationApi, NavigationGesture, PointingDevice} from '../registry'

export type NavigationSpec = KeymapPreset['navigation']

/**
 * The device to assume before any wheel event has been seen: a Mac is a laptop with a trackpad far
 * more often than not; everything else is called a mouse (a wrong guess is corrected by the first
 * scroll, and the user can choose). Only the hints and cards depend on it.
 */
export function defaultPointingDevice(): PointingDevice {
    const platform = typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : ''
    return /Mac|iPhone|iPad/.test(platform) ? 'trackpad' : 'mouse'
}

/** The parts of `OrbitControls3` this reads and writes. Other camera controls simply lack them. */
interface OrbitLike {
    mouseButtons?: {LEFT: number, MIDDLE: number, RIGHT: number}
    target?: Vector3
    object?: PerspectiveCamera
    enableRotate?: boolean
    enablePan?: boolean
    rotateSpeed?: number
    panSpeed?: number
    minPolarAngle?: number
    maxPolarAngle?: number
    update?: () => void
}

export class Navigation implements NavigationApi {
    private _spec: NavigationSpec | null = null
    private _mode: EditorMode = 'object'
    private _spaceDown = false
    private _lastTrackpad = 0
    private _gesture: 'orbit' | 'pan' | 'zoom' | null = null
    /** kokraf's gesture lock: a two-finger gesture keeps its meaning for this long after the last event. */
    gestureLockMs = 150

    private _chosenDevice: PointingDevice | null = null
    private _detectedDevice: PointingDevice | null = null
    /** Called when {@link device} or {@link deviceSource} changes. */
    onDeviceChange: ((device: PointingDevice, source: NavigationApi['deviceSource']) => void) | null = null

    constructor(private _viewer: ThreeViewer, private _dragSelectTarget: () => {dragSelect?: 'box' | 'lasso' | 'none', objectDragSelect?: boolean} | undefined) {
        const canvas = _viewer.canvas
        canvas.addEventListener('pointerdown', this._onPointerDown, true)
        canvas.addEventListener('wheel', this._onWheel, {capture: true, passive: false})
        _viewer.scene.addEventListener('mainCameraChange', this._onCameraChange)
    }

    // region device

    get device(): PointingDevice {
        return this._chosenDevice ?? this._detectedDevice ?? defaultPointingDevice()
    }

    get deviceSource(): NavigationApi['deviceSource'] {
        return this._chosenDevice ? 'chosen' : this._detectedDevice ? 'detected' : 'default'
    }

    setDevice(device: PointingDevice | 'auto'): void {
        const before = [this.device, this.deviceSource]
        this._chosenDevice = device === 'auto' ? null : device
        if (before[0] !== this.device || before[1] !== this.deviceSource) this.onDeviceChange?.(this.device, this.deviceSource)
    }

    /**
     * What a wheel event says about the device, if anything. Only unambiguous events give a verdict,
     * so one fast trackpad swipe (large deltas) or one smooth-scrolling mouse notch does not flip the
     * hints back and forth:
     * - a trackpad streams fractional pixel deltas, scrolls on both axes at once, and pinches as
     *   Ctrl+wheel with small deltas (Chrome, Safari and Firefox all synthesise `ctrlKey` for a pinch);
     * - a mouse wheel reports lines or pages (`deltaMode` 1/2, Firefox), or a whole notch of 100+
     *   pixels on one axis (Chrome, Edge: 100 or 120 per notch).
     * The per-event routing in {@link _onWheel} keeps kokraf's looser test; this only drives what the
     * hints and cards describe.
     */
    static wheelVerdict(event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'ctrlKey'>): PointingDevice | null {
        const {deltaMode, deltaX: dx, deltaY: dy} = event
        if (deltaMode !== 0) return 'mouse'
        if (!Number.isInteger(dx) || !Number.isInteger(dy)) return 'trackpad'
        if (dx !== 0 && dy !== 0) return 'trackpad'
        if (event.ctrlKey && Math.abs(dy) < 50) return 'trackpad'
        if (dx === 0 && Math.abs(dy) >= 100) return 'mouse'
        return null
    }

    private _noteDevice(verdict: PointingDevice | null): void {
        if (!verdict || this._detectedDevice === verdict) return
        const before = [this.device, this.deviceSource]
        this._detectedDevice = verdict
        if (before[0] !== this.device || before[1] !== this.deviceSource) this.onDeviceChange?.(this.device, this.deviceSource)
    }

    /**
     * Orbit, pan and zoom as the user does them with the active preset on a device. Derived from the
     * preset's `navigation` spec and the paths that implement it (the controls' buttons, `OrbitControls`
     * panning a ROTATE drag with Shift held, the Alt / Space left-button override, the trackpad
     * routing), so a card can never disagree with the controls.
     */
    gestures(device: PointingDevice = this.device): NavigationGesture[] {
        const s = this._spec
        if (!s) return []
        const buttonKind = (b: 'left' | 'middle' | 'right'): GestureKind => b === 'left' ? 'left-drag' : b === 'middle' ? 'middle-drag' : 'right-drag'
        // A left button that selects is not free for the action, whatever the spec says.
        const button = (b: 'left' | 'middle' | 'right'): GestureKind | undefined => b === 'left' && s.leftDrag === 'select' ? undefined : buttonKind(b)
        const orbit: (GestureKind | undefined)[] = []
        const pan: (GestureKind | undefined)[] = []
        const zoom: (GestureKind | undefined)[] = []
        if (device === 'trackpad') {
            if (s.trackpad) {
                orbit.push(s.trackpad === 'orbit' ? 'two-finger' : 'shift-two-finger')
                pan.push(s.trackpad === 'pan' ? 'two-finger' : 'shift-two-finger')
            }
            zoom.push('pinch', 'ctrl-two-finger')
        }
        if (device === 'mouse') {
            orbit.push(button(s.orbit))
            pan.push(button(s.pan))
            // `OrbitControls` pans a ROTATE drag while Shift is held (Blender's Shift+MMB).
            if (s.orbit === 'middle') pan.push('shift-middle-drag')
            zoom.push(s.zoom === 'wheel' ? 'wheel' : button(s.zoom))
        }
        if (s.altOrbit) {
            orbit.push('alt-drag')
            if (!s.spacePan) pan.push('shift-alt-drag')
        }
        if (s.spacePan) pan.push('space-drag')
        if (device === 'trackpad' && !s.trackpad) {
            orbit.push(button(s.orbit))
            pan.push(button(s.pan))
        }
        const make = (action: NavigationGesture['action'], label: string, list: (GestureKind | undefined)[]): NavigationGesture | null => {
            const kinds = [...new Set(list.filter((k): k is GestureKind => !!k))]
            if (!kinds.length) return null
            return {
                action, label, kind: kinds[0], gesture: GESTURE_TEXT[kinds[0]],
                alternatives: kinds.slice(1).map(kind => ({kind, gesture: GESTURE_TEXT[kind]})),
            }
        }
        return [make('orbit', 'Orbit', orbit), make('pan', 'Pan', pan), make('zoom', 'Zoom', zoom)].filter((g): g is NavigationGesture => !!g)
    }

    // endregion

    dispose(): void {
        const canvas = this._viewer.canvas
        canvas.removeEventListener('pointerdown', this._onPointerDown, true)
        canvas.removeEventListener('wheel', this._onWheel, true)
        this._viewer.scene.removeEventListener('mainCameraChange', this._onCameraChange)
    }

    private _controls(): OrbitLike | undefined {
        return this._viewer.scene.mainCamera?.controls as unknown as OrbitLike | undefined
    }

    /** Apply a preset's mapping. Called on preset change, mode change and camera change. */
    apply(spec: NavigationSpec, mode: EditorMode): void {
        this._spec = spec
        this._mode = mode
        const controls = this._controls()
        if (controls?.mouseButtons) {
            const buttons = controls.mouseButtons
            buttons.LEFT = this._leftAction(false, false)
            buttons.MIDDLE = this._actionFor('middle')
            buttons.RIGHT = this._actionFor('right')
        }
        // A left drag box-selects, as in Blender, in edit mode and object mode alike; the controls are
        // told the left button is free. `MeshEditPlugin.dragSelect` is `'box' | 'lasso' | 'none'`: a
        // boolean here used to read as "not none", so turning drag-select off did nothing.
        const target = this._dragSelectTarget()
        if (target && 'dragSelect' in target) target.dragSelect = spec.leftDrag === 'select' ? 'box' : 'none'
        // Object mode as well: the left button no longer orbits there either, so a drag selects objects.
        if (target && 'objectDragSelect' in target) target.objectDragSelect = spec.leftDrag === 'select'
    }

    setSpace(down: boolean): void {
        this._spaceDown = down
    }

    /** What the preset assigns to a physical button, as an `OrbitControls` action. */
    private _actionFor(button: 'middle' | 'right'): number {
        const s = this._spec
        if (!s) return -1
        if (s.orbit === button) return MOUSE.ROTATE
        if (s.pan === button) return MOUSE.PAN
        if (s.zoom === button) return MOUSE.DOLLY
        return -1
    }

    private _leftAction(alt: boolean, space: boolean): number {
        const s = this._spec
        if (!s) return MOUSE.ROTATE
        if (space && s.spacePan) return MOUSE.PAN
        if (alt && s.altOrbit) return MOUSE.ROTATE
        if (s.leftDrag === 'orbit' || s.orbit === 'left') return MOUSE.ROTATE
        if (s.pan === 'left') return MOUSE.PAN
        return -1 // selection owns the left button
    }

    private _onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0 || event.pointerType === 'touch') return
        const controls = this._controls()
        if (!controls?.mouseButtons) return
        controls.mouseButtons.LEFT = this._leftAction(event.altKey, this._spaceDown)
    }

    private _onCameraChange = (): void => {
        if (this._spec) this.apply(this._spec, this._mode)
    }

    // region trackpad

    private _onWheel = (event: WheelEvent): void => {
        const s = this._spec
        this._noteDevice(Navigation.wheelVerdict(event))
        if (!s?.trackpad || event.defaultPrevented) return
        let dx = event.deltaX
        let dy = event.deltaY
        if (event.deltaMode === 1) {
            dx *= 16
            dy *= 16
        }
        const isTrackpad = event.deltaMode === 0 && Math.abs(dx) + Math.abs(dy) < 100
        if (!isTrackpad) {
            this._gesture = null
            return
        }
        const now = performance.now()
        if (now - this._lastTrackpad > this.gestureLockMs || !this._gesture) {
            if (event.ctrlKey || event.metaKey) this._gesture = 'zoom'
            else if (event.shiftKey) this._gesture = s.trackpad === 'orbit' ? 'pan' : 'orbit'
            else this._gesture = s.trackpad
        }
        this._lastTrackpad = now
        // Pinch: the controls' own wheel handler zooms (to the cursor when `zoomToCursor` is on).
        if (this._gesture === 'zoom') return
        event.preventDefault()
        event.stopPropagation()
        if (this._gesture === 'pan') this.pan(-dx, -dy)
        else this.orbit(dx, dy)
    }

    /**
     * Pan the view by a screen-space delta in pixels. The maths is `OrbitControls._pan`
     * (`OrbitControls.js:691-738`): a perspective camera pans by the view height at the target's
     * distance, an orthographic one by its frustum size over zoom.
     */
    pan(dx: number, dy: number): void {
        const controls = this._controls()
        const camera = this._viewer.scene.mainCamera as unknown as PerspectiveCamera & {isOrthographicCamera?: boolean, top?: number, bottom?: number, right?: number, left?: number, zoom: number}
        const target = controls?.target
        if (!controls || !target || controls.enablePan === false) return
        const rect = this._viewer.canvas.getBoundingClientRect()
        const speed = controls.panSpeed ?? 1
        const offset = new Vector3().copy(camera.position).sub(target)
        let left: number
        let up: number
        if (camera.isOrthographicCamera) {
            left = dx * ((camera.right! - camera.left!) / camera.zoom) / rect.width
            up = dy * ((camera.top! - camera.bottom!) / camera.zoom) / rect.height
        } else {
            let distance = offset.length()
            distance *= Math.tan((camera.fov / 2) * Math.PI / 180)
            left = 2 * dx * distance / rect.height
            up = 2 * dy * distance / rect.height
        }
        const v = new Vector3()
        const delta = new Vector3()
        v.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(-left * speed)
        delta.add(v)
        v.setFromMatrixColumn(camera.matrix, 1).multiplyScalar(up * speed)
        delta.add(v)
        target.add(delta)
        camera.position.add(delta)
        controls.update?.()
        ;(camera as any).setDirty?.()
        this._viewer.setDirty()
    }

    /**
     * Orbit the view by a screen-space delta in pixels: `OrbitControls` `_rotateLeft/_rotateUp` with
     * the `onMouseMove` rotate scaling (`2π · Δ / height · rotateSpeed`, :829-836) applied through
     * the same spherical-around-target update (`update()`, :300-360).
     */
    orbit(dx: number, dy: number): void {
        const controls = this._controls()
        const camera = this._viewer.scene.mainCamera as unknown as PerspectiveCamera
        const target = controls?.target
        if (!controls || !target || controls.enableRotate === false) return
        const rect = this._viewer.canvas.getBoundingClientRect()
        const speed = controls.rotateSpeed ?? 1
        const thetaDelta = 2 * Math.PI * dx / rect.height * speed
        const phiDelta = 2 * Math.PI * dy / rect.height * speed
        const quat = new Quaternion().setFromUnitVectors(camera.up, new Vector3(0, 1, 0))
        const quatInverse = quat.clone().invert()
        const offset = new Vector3().copy(camera.position).sub(target).applyQuaternion(quat)
        const spherical = new Spherical().setFromVector3(offset)
        spherical.theta -= thetaDelta
        spherical.phi -= phiDelta
        const minPolar = controls.minPolarAngle ?? 0
        const maxPolar = controls.maxPolarAngle ?? Math.PI
        spherical.phi = Math.max(minPolar, Math.min(maxPolar, spherical.phi))
        spherical.makeSafe()
        offset.setFromSpherical(spherical).applyQuaternion(quatInverse)
        camera.position.copy(target).add(offset)
        camera.lookAt(target)
        controls.update?.()
        ;(camera as any).setDirty?.()
        this._viewer.setDirty()
    }

    // endregion

    /**
     * The status-bar wording for the current mapping. On a trackpad the mouse-button hints give way
     * to the gestures the user actually has (no middle button, no wheel).
     */
    hints(): {lmb: string, mmb?: string, rmb?: string, extra: {key: string, label: string}[]} {
        const s = this._spec
        if (!s) return {lmb: 'Select', extra: []}
        const word = (b: 'left' | 'middle' | 'right'): string | undefined =>
            s.orbit === b ? 'Orbit' : s.pan === b ? 'Pan' : s.zoom === b ? 'Zoom' : undefined
        const left = s.leftDrag === 'select' ? (this._mode === 'edit' ? 'Select / drag to box select' : 'Select') : word('left') ?? 'Select'
        const extra: {key: string, label: string}[] = []
        if (this.device === 'trackpad') {
            if (s.trackpad) extra.push({key: 'Two fingers', label: s.trackpad === 'orbit' ? 'Orbit (Shift: pan)' : 'Pan (Shift: orbit)'}, {key: 'Pinch', label: 'Zoom'})
            if (s.altOrbit) extra.push({key: 'Alt+Drag', label: 'Orbit'})
            if (s.spacePan) extra.push({key: 'Space+Drag', label: 'Pan'})
            const rmb = word('right')
            return {lmb: left, rmb: rmb ? `${rmb} / context menu` : 'Context menu', extra}
        }
        if (s.altOrbit) extra.push({key: 'Alt+Drag', label: 'Orbit'})
        if (s.spacePan) extra.push({key: 'Space+Drag', label: 'Pan'})
        if (s.orbit === 'middle') extra.push({key: 'Shift+MMB', label: 'Pan'})
        const mmb = word('middle')
        const rmb = word('right')
        return {lmb: left, mmb: mmb ?? (s.zoom === 'wheel' ? 'Wheel: zoom' : undefined), rmb: rmb ? `${rmb} / context menu` : 'Context menu', extra}
    }
}
