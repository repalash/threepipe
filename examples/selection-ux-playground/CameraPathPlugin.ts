import {
    AnimationObject,
    AnimationObjectPlugin,
    AViewerPluginEventMap,
    AViewerPluginSync,
    Box3,
    IObject3D,
    Object3DGeneratorPlugin,
    ObjectConstraint,
    ObjectConstraintsPlugin,
    PickingPlugin,
    PopmotionPlugin,
    ThreeViewer,
    UndoManagerPlugin,
    Vector3,
} from 'threepipe'
import {SelectionUxPlugin} from './SelectionUxPlugin'
import {PenToolPlugin} from './PenToolPlugin'
import {button, fmtSec, injectMotionStyles, MO_ICONS, numberInput, row, segmented, select} from './motionUi'

/** Where the camera looks while it moves: the scene's centre, ahead along the path, or its own target as it is */
export type PathLook = 'center' | 'ahead' | 'target'

export interface PathAnimationOptions {
    /** Seconds, default 6 */
    duration?: number
    look?: PathLook
    /** End to start */
    reverse?: boolean
    /** Constant speed, or slow at the start and the end */
    ease?: 'linear' | 'easeInOutSine'
    /** Seconds on the timeline, default 0 */
    start?: number
    /** Move the path up by this much first (a path drawn on the floor puts the camera at eye height) */
    lift?: number
}

export interface PathAnimation {
    object: IObject3D
    path?: IObject3D
    constraint: ObjectConstraint
    anim?: AnimationObject
    duration: number
    start: number
    reverse: boolean
    look: PathLook
    ease: string
}

export interface CameraPathEventMap extends AViewerPluginEventMap {
    /** A path animation was made, changed or removed (also by undo) */
    change: object
}

const isPath = (o: any) => !!(o?.isLine2 || o?.isLineSegments2 || o?.isLine) && !!o.geometry && !o.isWidget
const isSceneCamera = (o: any) => !!o?.isCamera && typeof o.activateMain === 'function'

/**
 * "Animate along path": a camera (or any object) moves along a line over the timeline, in one step that can be undone.
 * It is the `follow_path` constraint plus a 0 → 1 keyframe track on its offset, which used to take about 11 steps in
 * three panels and a typed object name. A dialog picks the camera, the path, the look, the duration, the speed and the
 * direction; a chip offers it right after the pen draws a path; the view shows where the camera goes (dots along the
 * path, start and end times) while the camera or its path is selected.
 */
export class CameraPathPlugin extends AViewerPluginSync<CameraPathEventMap> {
    static readonly PluginType = 'CameraPathPlugin'
    enabled = true
    dependencies = [ObjectConstraintsPlugin, AnimationObjectPlugin, PopmotionPlugin]

    private _svg?: SVGSVGElement
    private _dialog?: HTMLDivElement
    private _chip?: HTMLDivElement

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        injectMotionStyles()
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('class', 'cp-overlay')
        svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:7;overflow:visible'
        viewer.container.appendChild(svg)
        this._svg = svg
        injectStyles()
        viewer.addEventListener('postRender', this._markDirty)
        viewer.addEventListener('postFrame', this._draw)
        viewer.forPlugin(PickingPlugin, p => p.addEventListener('selectedObjectChanged', this._onSelect), p => p.removeEventListener('selectedObjectChanged', this._onSelect))
        viewer.forPlugin(PenToolPlugin, p => p.addEventListener('created', this._onPathCreated), p => p.removeEventListener('created', this._onPathCreated))
    }

    onRemove(viewer: ThreeViewer) {
        viewer.removeEventListener('postRender', this._markDirty)
        viewer.removeEventListener('postFrame', this._draw)
        viewer.getPlugin(PickingPlugin)?.removeEventListener('selectedObjectChanged', this._onSelect)
        viewer.getPlugin(PenToolPlugin)?.removeEventListener('created', this._onPathCreated)
        this._svg?.remove()
        this.closeDialog()
        this._hideChip()
        super.onRemove(viewer)
    }

    // region model

    /** Lines in the scene that can be paths */
    paths(): IObject3D[] {
        const out: IObject3D[] = []
        this._viewer?.scene.modelRoot.traverse(o => {
            if (isPath(o)) out.push(o as IObject3D)
        })
        return out
    }

    /** Cameras in the scene (not the editor camera) */
    cameras(): IObject3D[] {
        const out: IObject3D[] = []
        this._viewer?.scene.modelRoot.traverse(o => {
            if (isSceneCamera(o)) out.push(o as IObject3D)
        })
        return out
    }

    /** The path animation of an object, if it has one */
    getPathAnimation(obj: IObject3D): PathAnimation | undefined {
        const cs = obj.userData.constraints as ObjectConstraint[] | undefined
        const i = cs?.findIndex(c => c.type === 'follow_path') ?? -1
        if (!cs || i < 0) return undefined
        const c = cs[i]
        const anim = (obj.userData.animationObjects as AnimationObject[] | undefined)?.find(a => a.access === offsetAccess(i))
        const values = (anim?.values ?? []) as number[]
        return {
            object: obj,
            path: c.target ? this._viewer?.object3dManager.findObject(c.target) as IObject3D | undefined : undefined,
            constraint: c,
            anim,
            duration: (anim?.duration ?? 6000) / 1000,
            start: (anim?.delay ?? 0) / 1000,
            reverse: values.length > 1 && values[0] > values[values.length - 1],
            look: (c.props as any).followCurve ? 'ahead' : 'center',
            ease: anim?.ease ?? 'linear',
        }
    }

    /** All objects that move along a path */
    pathAnimations(): PathAnimation[] {
        const out: PathAnimation[] = []
        this._viewer?.scene.modelRoot.traverse(o => {
            const a = (o as IObject3D).userData?.constraints && this.getPathAnimation(o as IObject3D)
            if (a) out.push(a)
        })
        return out
    }

    /**
     * Move `obj` along `path` over the timeline: a follow_path constraint and a keyframe track on its offset.
     * Replaces the object's earlier path animation. One undo step.
     */
    animateAlongPath(obj: IObject3D, path: IObject3D, options: PathAnimationOptions = {}) {
        const viewer = this._viewer
        const cons = viewer?.getPlugin(ObjectConstraintsPlugin)
        const anims = viewer?.getPlugin(AnimationObjectPlugin)
        if (!viewer || !cons || !anims) return
        const duration = Math.max(0.1, options.duration ?? 6)
        const start = Math.max(0, options.start ?? 0)
        const look = options.look ?? 'center'
        const ease = options.ease ?? 'linear'
        const old = this.getPathAnimation(obj)
        const cam = obj as any
        const before = this._pose(obj)
        const oldEnd = viewer.timeline.endTime

        const c = new ObjectConstraint('follow_path')
        c.target = path.uuid
        c.props = {offset: options.reverse ? 1 : 0, followCurve: look === 'ahead'}
        const ao = new AnimationObject()
        ao.name = `${obj.name || 'Camera'} along ${path.name || 'path'}`
        ao.values = options.reverse ? [1, 0] : [0, 1]
        ao.offsets = [0, 1]
        ao.duration = duration * 1000
        ao.delay = start * 1000
        ao.ease = ease
        ao.updateTarget = true // the object's setDirty runs the constraint on every change
        const lift = options.lift ?? 0
        const pathY = path.position.y
        const center = look === 'center' ? this.sceneCenter([path, obj]) : undefined

        const apply = () => {
            if (old) this._detach(obj, old)
            if (lift) this._setY(path, pathY + lift)
            cons.addConstraint(obj, c)
            this._addAnim(obj, ao, obj.userData.constraints!.indexOf(c))
            if (cam.isCamera) {
                cam.autoLookAtTarget = look !== 'ahead'
                if (center) cam.target.copy(center)
            }
            this._fitTimeline()
            this._refresh(obj)
        }
        const revert = () => {
            cons.removeConstraint(obj, c)
            anims.removeAnimation(ao, obj)
            if (old) this._attach(obj, old)
            if (lift) this._setY(path, pathY)
            this._setPose(obj, before)
            viewer.timeline.endTime = oldEnd
            this._refresh(obj)
        }
        apply()
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo: revert, redo: apply})
    }

    /** Stop an object following its path. One undo step. */
    removePathAnimation(obj: IObject3D) {
        const viewer = this._viewer
        const old = this.getPathAnimation(obj)
        if (!viewer || !old) return
        const pose = this._pose(obj)
        const oldEnd = viewer.timeline.endTime
        const apply = () => {
            this._detach(obj, old)
            this._fitTimeline()
            this._refresh(obj)
        }
        const revert = () => {
            this._attach(obj, old)
            this._setPose(obj, pose)
            viewer.timeline.endTime = oldEnd
            this._refresh(obj)
        }
        apply()
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo: revert, redo: apply})
    }

    /** Height of the lowest point of a path above the ground (y = 0), in world space */
    pathHeight(path: IObject3D) {
        const pts = pathPoints(path)
        return pts.length ? Math.min(...pts.map(p => p.y)) : 0
    }

    private _setY(o: IObject3D, y: number) {
        o.position.y = y
        o.setDirty?.({change: 'position'})
    }

    /** Centre of the scene's meshes, without lines, cameras, lights and the given objects */
    sceneCenter(exclude: IObject3D[] = []): Vector3 {
        const box = new Box3()
        const skip = new Set(exclude)
        this._viewer?.scene.modelRoot.traverse(o => {
            const m = o as any
            if (!m.isMesh || isPath(m) || skip.has(m) || m.isWidget || !m.visible) return
            box.expandByObject(m)
        })
        return box.isEmpty() ? new Vector3() : box.getCenter(new Vector3())
    }

    private _detach(obj: IObject3D, a: PathAnimation) {
        this._viewer?.getPlugin(ObjectConstraintsPlugin)?.removeConstraint(obj, a.constraint)
        if (a.anim) this._viewer?.getPlugin(AnimationObjectPlugin)?.removeAnimation(a.anim, obj)
    }

    private _attach(obj: IObject3D, a: PathAnimation) {
        this._viewer?.getPlugin(ObjectConstraintsPlugin)?.addConstraint(obj, a.constraint)
        if (a.anim) this._addAnim(obj, a.anim, obj.userData.constraints!.indexOf(a.constraint))
    }

    /** Add the offset track of the constraint at `index`, keeping its keyframes */
    private _addAnim(obj: IObject3D, ao: AnimationObject, index: number) {
        const values = [...ao.values], offsets = [...ao.offsets]
        this._viewer?.getPlugin(AnimationObjectPlugin)?.addAnimation(offsetAccess(index), obj, ao)
        // a new access or target resets the keyframes to the current value
        ao.values = values
        ao.offsets = offsets
        ao.setDirty()
    }

    private _pose(obj: IObject3D) {
        const cam = obj as any
        return {p: obj.position.clone(), q: obj.quaternion.clone(), auto: cam.autoLookAtTarget as boolean | undefined, t: cam.target?.clone() as Vector3 | undefined}
    }

    private _setPose(obj: IObject3D, s: ReturnType<CameraPathPlugin['_pose']>) {
        const cam = obj as any
        obj.position.copy(s.p)
        obj.quaternion.copy(s.q)
        if (s.auto !== undefined) cam.autoLookAtTarget = s.auto
        if (s.t) cam.target.copy(s.t)
    }

    /** The timeline ends where the last animation ends */
    private _fitTimeline() {
        const viewer = this._viewer
        const anims = viewer?.getPlugin(AnimationObjectPlugin)
        if (!viewer || !anims) return
        let end = 0
        for (const a of anims.getAllAnimations()) end = Math.max(end, (a.delay + a.duration) / 1000)
        if (end > 0) viewer.timeline.endTime = Math.round(end * 100) / 100
    }

    private _refresh(obj: IObject3D) {
        const viewer = this._viewer
        if (!viewer) return
        obj.setDirty?.({change: 'transform'})
        viewer.setDirty()
        this._redraw = true
        this.dispatchEvent({type: 'change'})
    }

    // endregion

    // region dialog

    /** The "Camera along a path" dialog. Preselects the given camera and path, else the selection. */
    openDialog(init: {object?: IObject3D, path?: IObject3D} = {}) {
        const viewer = this._viewer
        if (!viewer) return
        this.closeDialog()
        this._hideChip()
        const sel = (viewer.getPlugin(PickingPlugin)?.getSelectedObjects?.() ?? []) as IObject3D[]
        const cams = this.cameras()
        const paths = this.paths()
        const object = init.object ?? sel.find(isSceneCamera) ?? this.pathAnimations()[0]?.object ?? cams[0]
        const existing = object ? this.getPathAnimation(object) : undefined
        const path = init.path ?? sel.find(isPath) ?? existing?.path ?? paths[paths.length - 1]

        const d = document.createElement('div')
        d.className = 'mo-ui mo-card cp-dialog'
        d.dataset.ownKeys = ''
        d.setAttribute('role', 'dialog')
        d.setAttribute('aria-label', 'Camera along a path')
        const title = document.createElement('div')
        title.className = 'mo-title'
        title.innerHTML = `<span style="color:var(--mo-cam);display:flex">${MO_ICONS.camera}</span>Camera along a path`
        const x = button(MO_ICONS.close, 'mo-icon mo-x', () => this.closeDialog())
        x.setAttribute('aria-label', 'Close')
        title.appendChild(x)
        d.appendChild(title)

        const camSel = select([...cams.map(c => [c.uuid, c.name || 'Camera'] as [string, string]), ['new', '+ New camera']], object?.uuid ?? 'new')
        const pathSel = select(paths.length ? paths.map(p => [p.uuid, p.name || 'Line'] as [string, string]) : [['', 'No path yet: draw one with the pen (P)']], path?.uuid ?? '')
        const look = segmented<PathLook>([['center', 'The centre'], ['ahead', 'Ahead'], ['target', 'Its target']], existing?.look ?? 'center')
        look.el.title = 'Where the camera looks: the middle of the scene, along the path, or its own target as it is now'
        const dur = numberInput(existing?.duration ?? 6, 's', 0.5, 0.5)
        const speed = segmented([['linear', 'Constant'], ['easeInOutSine', 'Ease in and out']], existing?.ease === 'easeInOutSine' ? 'easeInOutSine' : 'linear')
        const dir = segmented([['fwd', 'Start → end'], ['rev', 'End → start']], existing?.reverse ? 'rev' : 'fwd')
        // a path drawn on the floor would put the camera on the floor: offer to lift it to eye height
        const lift = numberInput(0, 'm up', -100, 0.1)
        lift.el.title = 'Moves the path up before the camera follows it. A path drawn on the floor puts the camera on the floor.'
        const liftRow = row('Lift the path', lift.el)
        const syncLift = () => {
            const p = viewer.object3dManager.findObject(pathSel.value) as IObject3D | undefined
            const low = p ? this.pathHeight(p) : 1
            lift.input.value = low < 0.25 ? (Math.round((1.2 - low) * 10) / 10).toString() : '0'
        }
        pathSel.addEventListener('change', syncLift)
        syncLift()
        d.append(row('Camera', camSel), row('Path', pathSel), liftRow, row('Look at', look.el), row('Duration', dur.el), row('Speed', speed.el), row('Direction', dir.el))
        const note = document.createElement('p')
        note.className = 'mo-note'
        note.textContent = 'Plays on the timeline, from 0 s. Undo removes it in one step.'
        d.appendChild(note)

        const btns = document.createElement('div')
        btns.className = 'mo-btns'
        const remove = button('Remove', 'mo-danger', () => {
            const o = viewer.object3dManager.findObject(camSel.value) as IObject3D | undefined
            if (o) this.removePathAnimation(o)
            this.closeDialog()
        })
        const go = button(existing ? 'Update' : 'Animate', 'mo-primary', () => {
            const p = viewer.object3dManager.findObject(pathSel.value) as IObject3D | undefined
            if (!p) return
            let o = viewer.object3dManager.findObject(camSel.value) as IObject3D | undefined
            if (!o) o = this._newCamera()
            if (!o) return
            this.animateAlongPath(o, p, {
                duration: parseFloat(dur.input.value) || 6,
                look: look.value,
                ease: speed.value as PathAnimationOptions['ease'],
                reverse: dir.value === 'rev',
                lift: parseFloat(lift.input.value) || 0,
            })
            this.closeDialog()
            this._play(o)
        })
        const sync = () => {
            const o = viewer.object3dManager.findObject(camSel.value) as IObject3D | undefined
            const has = !!o && !!this.getPathAnimation(o)
            remove.style.display = has ? '' : 'none'
            go.textContent = has ? 'Update' : 'Animate'
            go.disabled = !pathSel.value
        }
        camSel.addEventListener('change', sync)
        sync()
        btns.append(remove, button('Cancel', '', () => this.closeDialog()), go)
        d.appendChild(btns)
        d.addEventListener('keydown', e => {
            if (e.key === 'Escape') this.closeDialog()
            else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'SELECT') go.click()
            e.stopPropagation()
        })
        viewer.container.appendChild(d)
        this._dialog = d
        this._redraw = true
        go.focus()
    }

    closeDialog() {
        this._dialog?.remove()
        this._dialog = undefined
    }

    /** A new camera at the current view, in one undo step with the path animation that follows */
    private _newCamera() {
        const viewer = this._viewer
        const gen = viewer?.getPlugin(Object3DGeneratorPlugin)
        const obj = gen?.generate('camera-perspective', {}, false, false, false) as IObject3D | undefined
        if (!viewer || !obj) return undefined
        obj.name = 'Path Camera'
        const root = viewer.scene.modelRoot
        const add = () => {
            root.add(obj)
            viewer.scene.setDirty({refreshScene: true})
        }
        add()
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo: () => {
            obj.removeFromParent()
            viewer.scene.setDirty({refreshScene: true})
        }, redo: add})
        return obj
    }

    /** Look through the camera and play the timeline from the start of its animation */
    private _play(obj: IObject3D) {
        const viewer = this._viewer
        if (!viewer) return
        const a = this.getPathAnimation(obj)
        const ux = viewer.getPlugin(SelectionUxPlugin)
        if (isSceneCamera(obj)) ux?.lookThrough(obj)
        const tl = viewer.timeline
        viewer.doOnce('postFrame', () => {
            tl.setTime(a?.start ?? 0)
            tl.start()
        })
        ux?.dispatchEvent({type: 'toast', message: `${obj.name || 'The camera'} follows ${a?.path?.name || 'the path'} for ${fmtSec(a?.duration ?? 6)}. Record a video with ● in the timeline; 0 goes back to your view`})
    }

    // endregion

    // region chip after the pen

    private _onPathCreated = (e: {object: IObject3D}) => {
        const viewer = this._viewer
        if (!viewer) return
        this._hideChip()
        const chip = document.createElement('div')
        chip.className = 'mo-ui mo-card mo-chip cp-chip'
        const label = document.createElement('span')
        label.textContent = `${e.object.name || 'Path'} drawn`
        const go = button(`${MO_ICONS.camera} Animate a camera along it`, 'mo-primary', () => this.openDialog({path: e.object}))
        const x = button(MO_ICONS.close, 'mo-icon', () => this._hideChip())
        x.setAttribute('aria-label', 'Dismiss')
        chip.append(label, go, x)
        viewer.container.appendChild(chip)
        this._chip = chip
    }

    private _hideChip() {
        this._chip?.remove()
        this._chip = undefined
    }

    // endregion

    // region path preview

    private _redraw = true
    private _markDirty = () => {
        this._redraw = true
    }

    private _onSelect = () => {
        this._redraw = true
        const sel = this._viewer?.getPlugin(PickingPlugin)?.getSelectedObject() as IObject3D | undefined
        if (this._chip && sel && !isPath(sel)) this._hideChip()
    }

    /** Dots along each path that a selected camera follows (or a camera follows a selected path), with start and end times */
    private _draw = () => {
        const viewer = this._viewer
        const svg = this._svg
        if (!viewer || !svg || !this._redraw) return
        this._redraw = false
        const sel = new Set((viewer.getPlugin(PickingPlugin)?.getSelectedObjects?.() ?? []) as IObject3D[])
        const cam = viewer.scene.mainCamera
        // not for the camera you look through: its own path runs through the eye
        const show = this.enabled ? this.pathAnimations().filter(a => a.path && a.object !== cam && (this._dialog || sel.has(a.object) || sel.has(a.path))) : []
        if (!show.length) {
            if (svg.childNodes.length) svg.innerHTML = ''
            return
        }
        const w = viewer.container.clientWidth, h = viewer.container.clientHeight
        const scr = (v: Vector3) => {
            const p = v.clone().project(cam)
            return p.z > 1 || !Number.isFinite(p.x) || !Number.isFinite(p.y) ? null : [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h] as const
        }
        let out = ''
        for (const a of show) {
            const pts = pathPoints(a.path!)
            if (pts.length < 2) continue
            const n = 9
            const center = a.look === 'center' ? (a.object as any).target as Vector3 | undefined : undefined
            for (let i = 0; i < n; i++) {
                const u = i / (n - 1)
                const at = sampleAt(pts, a.reverse ? 1 - u : u)
                const s = scr(at.p)
                if (!s) continue
                // the look direction, 0.6 units long in the scene
                const dir = a.look === 'ahead' ? at.d.clone().multiplyScalar(a.reverse ? -1 : 1) : center ? center.clone().sub(at.p).normalize() : null
                const e = dir ? scr(at.p.clone().addScaledVector(dir, 0.6)) : null
                if (e) out += `<line x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}" class="cp-look"/>`
                out += `<circle cx="${s[0]}" cy="${s[1]}" r="${i === 0 || i === n - 1 ? 4.5 : 3}" class="cp-dot${i === 0 ? ' cp-start' : ''}"/>`
                if (i === 0 || i === n - 1) {
                    const t = a.start + (i === 0 ? 0 : a.duration)
                    out += `<text x="${s[0] + 8}" y="${s[1] - 8}" class="cp-label">${i === 0 ? 'Start' : 'End'} · ${fmtSec(t)}</text>`
                }
            }
        }
        svg.innerHTML = out
    }

    // endregion
}

const offsetAccess = (i: number) => `userData.constraints.${i}.props.offset`

/** World points of a line object */
function pathPoints(path: IObject3D): Vector3[] {
    const g = path.geometry as any
    const arr: ArrayLike<number> | undefined = g?.getPositions ? g.getPositions() : g?.attributes?.position?.array
    if (!arr) return []
    path.updateWorldMatrix(true, false)
    const out: Vector3[] = []
    for (let i = 0; i + 2 < arr.length; i += 3) {
        const v = new Vector3(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(path.matrixWorld)
        if (!out.length || !out[out.length - 1].equals(v)) out.push(v)
    }
    return out
}

/** Point and direction at a fraction of the path's length */
function sampleAt(pts: Vector3[], u: number) {
    const lens = [0]
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]))
    const target = Math.max(0, Math.min(1, u)) * lens[lens.length - 1]
    let i = 1
    while (i < pts.length - 1 && lens[i] < target) i++
    const seg = lens[i] - lens[i - 1] || 1
    const t = (target - lens[i - 1]) / seg
    return {p: pts[i - 1].clone().lerp(pts[i], t), d: pts[i].clone().sub(pts[i - 1]).normalize()}
}

let stylesAdded = false
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.cp-dialog { position: absolute; left: 50%; bottom: 150px; transform: translateX(-50%); width: 340px; max-width: calc(100% - 24px); z-index: 14; }
.cp-chip { bottom: 150px; }
.cp-overlay .cp-dot { fill: #fff; stroke: #8b5cf6; stroke-width: 2; }
.cp-overlay .cp-start { fill: #8b5cf6; }
.cp-overlay .cp-look { stroke: #8b5cf6; stroke-width: 1.5; stroke-opacity: .7; }
.cp-overlay .cp-label { font: 600 11px var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif); fill: #6d28d9; paint-order: stroke; stroke: #fff; stroke-width: 3px; }
`
    document.head.appendChild(st)
}
