import {
    AnimationObject,
    AnimationObjectPlugin,
    AViewerPluginEventMap,
    AViewerPluginSync,
    IObject3D,
    PickingPlugin,
    ThreeViewer,
    UndoManagerPlugin,
} from 'threepipe'
import {SelectionUxPlugin} from './SelectionUxPlugin'
import {CameraPathPlugin} from './CameraPathPlugin'
import {VideoRecorderPlugin, VideoRecordResult, videoSupport} from './VideoRecorderPlugin'
import {button, fmtSec, injectMotionStyles, MO_ICONS, row, segmented, select} from './motionUi'

export interface TimelineBarEventMap extends AViewerPluginEventMap {
    /** Shown or hidden */
    change: object
}

interface Lane {anim: AnimationObject, obj?: IObject3D, label: string, color: string}

const SIZES: [string, string, number, number][] = [
    ['view', 'This view', 0, 0],
    ['720p', 'HD 1280×720', 1280, 720],
    ['1080p', 'Full HD 1920×1080', 1920, 1080],
    ['square', 'Square 1080×1080', 1080, 1080],
    ['vertical', 'Vertical 1080×1920', 1080, 1920],
    ['4k', '4K 3840×2160', 3840, 2160],
]

/**
 * A slim timeline at the bottom of the view: play, time, end time, loop, the animations as clips on lanes
 * (drag to move, drag the right edge to change the length, click to select the object), the camera view, and
 * Record. It shows by itself when the scene has animations; the toolbar toggles it.
 *
 * Record opens a small dialog (size, frame rate, camera, quality, format) with a frame on the view that shows what
 * is in the video, then records frame by frame with {@link VideoRecorderPlugin} and shows the result to download.
 */
export class TimelineBarPlugin extends AViewerPluginSync<TimelineBarEventMap> {
    static readonly PluginType = 'TimelineBarPlugin'
    enabled = true
    dependencies = [AnimationObjectPlugin, VideoRecorderPlugin]

    private _root?: HTMLDivElement
    private _lanesEl?: HTMLDivElement
    private _playhead?: HTMLDivElement
    private _timeEl?: HTMLSpanElement
    private _endInput?: HTMLInputElement
    private _playBtn?: HTMLButtonElement
    private _loopBtn?: HTMLButtonElement
    private _camBtn?: HTMLButtonElement
    private _recDialog?: HTMLDivElement
    private _frame?: HTMLDivElement
    private _userOn = false
    private _closed = false
    private _lanes: Lane[] = []
    private _total = 1

    /** Shown: turned on, or the scene has animations and it was not closed */
    get visible() {
        return this.enabled && !this._closed && (this._userOn || this._lanes.length > 0)
    }

    show() {
        this._userOn = true
        this._closed = false
        this.refresh()
    }

    hide() {
        this._userOn = false
        this._closed = true
        this.refresh()
    }

    toggle() {
        this.visible ? this.hide() : this.show()
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        injectMotionStyles()
        injectStyles()
        this._build(viewer)
        viewer.addEventListener('postFrame', this._tick)
        viewer.forPlugin(AnimationObjectPlugin, a => {
            a.addEventListener('rebuildTimeline', this._onAnimations)
            a.addEventListener('animationAdd', this._onAnimationAdd)
            a.addEventListener('animationRemove', this._onAnimations)
        }, a => {
            a.removeEventListener('rebuildTimeline', this._onAnimations)
            a.removeEventListener('animationAdd', this._onAnimationAdd)
            a.removeEventListener('animationRemove', this._onAnimations)
        })
        viewer.timeline.addEventListener('endTimeChanged', this._onAnimations)
        viewer.forPlugin(CameraPathPlugin, p => p.addEventListener('change', this._onAnimations), p => p.removeEventListener('change', this._onAnimations))
        this.refresh()
    }

    onRemove(viewer: ThreeViewer) {
        viewer.removeEventListener('postFrame', this._tick)
        viewer.timeline.removeEventListener('endTimeChanged', this._onAnimations)
        this._root?.remove()
        this.closeRecordDialog()
        super.onRemove(viewer)
    }

    private _onAnimations = () => this.refresh()
    private _onAnimationAdd = () => {
        this._closed = false
        this.refresh()
    }

    // region bar

    private _build(viewer: ThreeViewer) {
        const root = document.createElement('div')
        root.className = 'mo-ui mo-card tlb-root'
        root.dataset.ownKeys = ''
        root.setAttribute('role', 'region')
        root.setAttribute('aria-label', 'Timeline')
        const head = document.createElement('div')
        head.className = 'tlb-head'
        const icon = (svg: string, tip: string, fn: () => void) => {
            const b = button(svg, 'mo-icon', fn)
            b.title = tip
            b.setAttribute('aria-label', tip)
            return b
        }
        this._playBtn = icon(MO_ICONS.play, 'Play', () => this.togglePlay())
        const toStart = icon(MO_ICONS.toStart, 'Go to the start', () => {
            viewer.timeline.stop()
            viewer.timeline.setTime(0)
        })
        this._timeEl = document.createElement('span')
        this._timeEl.className = 'tlb-time'
        const slash = document.createElement('span')
        slash.className = 'tlb-dim'
        slash.textContent = '/'
        const end = document.createElement('input')
        end.type = 'number'
        end.min = '0.5'
        end.step = '0.5'
        end.className = 'tlb-end'
        end.title = 'Length of the timeline in seconds'
        end.addEventListener('change', () => {
            const v = parseFloat(end.value)
            if (v > 0) this._setEndTime(v)
        })
        end.addEventListener('keydown', e => {
            if (e.key === 'Enter') end.blur()
        })
        this._endInput = end
        const unit = document.createElement('span')
        unit.className = 'tlb-dim'
        unit.textContent = 's'
        this._loopBtn = icon(MO_ICONS.loop, 'Loop', () => {
            const t = viewer.timeline
            t.resetOnEnd = !t.resetOnEnd
            t.stopOnEnd = !t.resetOnEnd
            this._syncButtons()
        })
        const spacer = document.createElement('span')
        spacer.style.flex = '1'
        this._camBtn = button(`${MO_ICONS.camera}<span></span>`, 'tlb-cam', () => this._toggleCamera())
        const addPath = button(`${MO_ICONS.path}<span>Camera path</span>`, 'tlb-add', () => viewer.getPlugin(CameraPathPlugin)?.openDialog())
        addPath.title = 'Move a camera along a line over the timeline'
        const rec = button(`${MO_ICONS.record}<span>Record</span>`, 'tlb-rec', () => this.openRecordDialog())
        rec.title = 'Record the timeline as a video'
        const close = icon(MO_ICONS.close, 'Hide the timeline (toolbar brings it back)', () => this.hide())
        head.append(this._playBtn, toStart, this._timeEl, slash, end, unit, this._loopBtn, spacer, this._camBtn, addPath, rec, close)

        const body = document.createElement('div')
        body.className = 'tlb-body'
        const ruler = document.createElement('div')
        ruler.className = 'tlb-ruler'
        const lanes = document.createElement('div')
        lanes.className = 'tlb-lanes'
        const ph = document.createElement('div')
        ph.className = 'tlb-playhead'
        body.append(ruler, lanes, ph)
        root.append(head, body)
        body.addEventListener('pointerdown', e => this._scrubStart(e, body))
        viewer.container.appendChild(root)
        this._root = root
        this._lanesEl = lanes
        this._playhead = ph
    }

    togglePlay() {
        const t = this._viewer?.timeline
        if (!t) return
        if (t.running) t.stop()
        else {
            if (t.endTime > 0 && t.time >= t.endTime - 1e-3) t.setTime(0)
            t.start()
        }
    }

    /** Rebuild the lanes and the ruler */
    refresh() {
        const viewer = this._viewer
        const root = this._root
        if (!viewer || !root) return
        const anims = viewer.getPlugin(AnimationObjectPlugin)?.getAllAnimations() ?? []
        this._lanes = anims.filter(a => a.access).map(a => {
            const obj = a.targetObject as IObject3D | undefined
            const prop = /^userData\.constraints\.\d+\.props\.offset$/.test(a.access) ? 'path' : a.access.split('.').pop() || a.access
            return {anim: a, obj: obj?.isObject3D ? obj : undefined, label: `${obj?.name || a.name || 'Animation'} · ${prop}`, color: laneColor(obj, prop)}
        })
        const was = root.style.display !== 'none'
        root.style.display = this.visible ? '' : 'none'
        if (was !== this.visible) this.dispatchEvent({type: 'change'})
        this._total = Math.max(viewer.timeline.endTime || 0, ...this._lanes.map(l => (l.anim.delay + l.anim.duration) / 1000), 1)
        if (document.activeElement !== this._endInput && this._endInput) this._endInput.value = String(Math.round((viewer.timeline.endTime || 0) * 100) / 100)
        this._drawRuler()
        this._drawLanes()
        this._syncButtons()
    }

    private _drawRuler() {
        const ruler = this._root?.querySelector('.tlb-ruler')
        if (!ruler) return
        const total = this._total
        const step = total <= 4 ? 0.5 : total <= 12 ? 1 : total <= 30 ? 5 : 10
        let html = ''
        for (let s = 0; s <= total + 1e-6; s += step) html += `<span style="left:${s / total * 100}%">${Math.round(s * 10) / 10}</span>`
        const end = this._viewer?.timeline.endTime || 0
        if (end > 0) html += `<i class="tlb-endmark" style="left:${end / total * 100}%" title="End of the timeline"></i>`
        ruler.innerHTML = html
    }

    private _drawLanes() {
        const el = this._lanesEl
        if (!el) return
        el.innerHTML = ''
        if (!this._lanes.length) {
            const empty = document.createElement('div')
            empty.className = 'tlb-empty'
            empty.textContent = 'No animations yet. Camera path moves a camera along a line; ◆ next to a field in the editor panels keys any value.'
            el.appendChild(empty)
            return
        }
        const sel = new Set((this._viewer?.getPlugin(PickingPlugin)?.getSelectedObjects?.() ?? []) as IObject3D[])
        for (const lane of this._lanes) {
            const r = document.createElement('div')
            r.className = 'tlb-lane'
            const clip = document.createElement('div')
            clip.className = 'tlb-clip' + (lane.obj && sel.has(lane.obj) ? ' tlb-sel' : '')
            clip.style.setProperty('--c', lane.color)
            this._placeClip(clip, lane.anim)
            clip.title = `${lane.label}\nDrag to move, drag the right edge to change the length, click to select`
            const name = document.createElement('span')
            name.textContent = lane.label
            clip.appendChild(name)
            for (const o of lane.anim.offsets.length ? lane.anim.offsets : [0, 1]) {
                const k = document.createElement('i')
                k.className = 'tlb-key'
                k.style.left = o * 100 + '%'
                clip.appendChild(k)
            }
            const edge = document.createElement('b')
            edge.className = 'tlb-edge'
            clip.appendChild(edge)
            clip.addEventListener('pointerdown', e => this._clipDrag(e, lane, clip, e.target === edge))
            r.appendChild(clip)
            el.appendChild(r)
        }
    }

    private _placeClip(clip: HTMLElement, a: AnimationObject) {
        clip.style.left = a.delay / 1000 / this._total * 100 + '%'
        clip.style.width = Math.max(0.5, a.duration / 1000 / this._total * 100) + '%'
    }

    private _syncButtons() {
        const viewer = this._viewer
        if (!viewer || !this._playBtn) return
        const t = viewer.timeline
        this._playBtn.innerHTML = t.running ? MO_ICONS.pause : MO_ICONS.play
        this._playBtn.title = t.running ? 'Pause' : 'Play'
        this._loopBtn?.classList.toggle('on', t.resetOnEnd)
        const ux = viewer.getPlugin(SelectionUxPlugin)
        const cam = ux?.viewCamera
        if (this._camBtn) {
            const target = cam ?? this._pathCamera()
            this._camBtn.classList.toggle('on', !!cam)
            this._camBtn.style.display = target ? '' : 'none'
            this._camBtn.querySelector('span')!.textContent = cam ? `${cam.name || 'Camera'} view` : `Look through ${target?.name || 'camera'}`
            this._camBtn.title = cam ? 'Back to your view (0)' : 'See what the camera sees (0)'
        }
    }

    /** The camera that moves along a path, else the first camera */
    private _pathCamera(): IObject3D | undefined {
        const cp = this._viewer?.getPlugin(CameraPathPlugin)
        return cp?.pathAnimations().find(a => (a.object as any).isCamera)?.object ?? cp?.cameras()[0]
    }

    private _toggleCamera() {
        const ux = this._viewer?.getPlugin(SelectionUxPlugin)
        if (!ux) return
        if (ux.viewCamera) ux.exitCameraView()
        else ux.lookThrough(this._pathCamera())
        this._syncButtons()
    }

    private _lastRunning = false
    private _lastCam: unknown = null
    private _tick = () => {
        const viewer = this._viewer
        if (!viewer || !this.visible || !this._playhead || !this._timeEl) return
        const t = viewer.timeline
        this._playhead.style.left = `calc(${Math.min(1, t.time / this._total) * 100}% )`
        this._timeEl.textContent = fmtSec(t.time)
        const cam = viewer.scene.mainCamera
        if (t.running !== this._lastRunning || cam !== this._lastCam) {
            this._lastRunning = t.running
            this._lastCam = cam
            this._syncButtons()
        }
    }

    private _setEndTime(v: number) {
        const viewer = this._viewer
        if (!viewer) return
        const t = viewer.timeline
        const old = t.endTime
        if (old === v) return
        const apply = (x: number) => () => {
            t.endTime = x
            this.refresh()
        }
        apply(v)()
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo: apply(old), redo: apply(v)})
    }

    /** Click or drag on the ruler or an empty lane: move the time */
    private _scrubStart(e: PointerEvent, body: HTMLElement) {
        if ((e.target as HTMLElement).closest('.tlb-clip') || e.button !== 0) return
        const viewer = this._viewer
        if (!viewer) return
        e.preventDefault()
        const t = viewer.timeline
        t.stop()
        const rect = body.getBoundingClientRect()
        // just before the end: a timeline that is still running in this frame goes back to 0 at its end
        const at = (x: number) => Math.min(Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * this._total, t.endTime > 0 ? t.endTime - 1e-3 : Infinity)
        t.setTime(at(e.clientX))
        const move = (m: PointerEvent) => t.setTime(at(m.clientX))
        const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
    }

    /** Drag a clip to move it in time, its right edge to change its length; a click selects its object */
    private _clipDrag(e: PointerEvent, lane: Lane, clip: HTMLElement, edge: boolean) {
        const viewer = this._viewer
        if (!viewer || e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        const a = lane.anim
        const body = this._root!.querySelector<HTMLElement>('.tlb-body')!
        const pxPerSec = body.getBoundingClientRect().width / this._total
        const x0 = e.clientX
        const d0 = a.delay, l0 = a.duration
        let moved = false
        const snap = (ms: number, free: boolean) => free ? ms : Math.round(ms / 100) * 100
        const move = (m: PointerEvent) => {
            const dx = m.clientX - x0
            if (!moved && Math.abs(dx) < 3) return
            moved = true
            const dms = dx / pxPerSec * 1000
            if (edge) a.duration = Math.max(100, snap(l0 + dms, m.altKey))
            else a.delay = Math.max(0, snap(d0 + dms, m.altKey))
            this._placeClip(clip, a)
        }
        const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            if (!moved) {
                if (lane.obj) viewer.getPlugin(SelectionUxPlugin)?.select([lane.obj])
                return
            }
            const d1 = a.delay, l1 = a.duration
            const oldEnd = viewer.timeline.endTime
            const newEnd = Math.max(oldEnd, (d1 + l1) / 1000)
            const set = (d: number, l: number, endT: number) => () => {
                a.delay = d
                a.duration = l
                viewer.timeline.endTime = endT
                viewer.timeline.setTime(viewer.timeline.time)
                this.refresh()
            }
            set(d1, l1, newEnd)()
            viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo: set(d0, l0, oldEnd), redo: set(d1, l1, newEnd)})
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
    }

    // endregion

    // region record

    openRecordDialog() {
        const viewer = this._viewer
        const rec = viewer?.getPlugin(VideoRecorderPlugin)
        if (!viewer || !rec) return
        this.closeRecordDialog()
        if (!this.visible) this.show()
        const d = document.createElement('div')
        d.className = 'mo-ui mo-card tlb-rec-dialog'
        d.dataset.ownKeys = ''
        d.setAttribute('role', 'dialog')
        d.setAttribute('aria-label', 'Record a video')
        this._recDialog = d

        const cams = viewer.getPlugin(CameraPathPlugin)?.cameras() ?? []
        const pathCam = this._pathCamera()
        const cur = viewer.getPlugin(SelectionUxPlugin)?.viewCamera
        const camDefault = cur?.uuid ?? (pathCam && viewer.getPlugin(CameraPathPlugin)?.getPathAnimation(pathCam) ? pathCam.uuid : 'view')
        const camSel = select([['view', 'The current view'], ...cams.map(c => [c.uuid, c.name || 'Camera'] as [string, string])], camDefault)
        const sizeSel = select(SIZES.map(([k, label]) => [k, k === 'view' ? `${label} (${viewer.canvas.width}×${viewer.canvas.height})` : label] as [string, string]), '1080p')
        const fps = segmented([['24', '24'], ['30', '30'], ['60', '60']], '30')
        const quality = segmented([['draft', 'Draft'], ['final', 'Final']], 'draft')
        quality.el.title = 'Final waits for anti-aliasing and effects to settle on every frame: smoother, slower'
        const support = videoSupport()
        const format = segmented([['mp4', 'MP4'], ['webm', 'WebM']], 'mp4')
        const hidePaths = document.createElement('label')
        hidePaths.className = 'mo-check'
        hidePaths.innerHTML = '<input type="checkbox" checked> Hide the camera path lines'
        const lengthEl = document.createElement('span')
        const updateLength = () => {
            const end = viewer.timeline.endTime || 5
            lengthEl.textContent = `${fmtSec(end)} · ${Math.round(end * parseInt(fps.value))} frames`
        }
        fps.el.addEventListener('click', updateLength)
        updateLength()

        const form = document.createElement('div')
        const title = document.createElement('div')
        title.className = 'mo-title'
        title.innerHTML = `<span style="color:var(--mo-rec);display:flex">${MO_ICONS.record}</span>Record a video`
        const x = button(MO_ICONS.close, 'mo-icon mo-x', () => this.closeRecordDialog())
        x.setAttribute('aria-label', 'Close')
        title.appendChild(x)
        form.append(title, row('Camera', camSel), row('Size', sizeSel), row('Frame rate', fps.el), row('Quality', quality.el),
            row('Format', format.el), row('Length', lengthEl), row('', hidePaths))
        const note = document.createElement('p')
        note.className = 'mo-note'
        note.textContent = support.frameByFrame ?
            'Frame by frame: the timing is exact however slow the scene is. The frame on the view shows what is in the video. Selection, grid and helpers are hidden.' :
            'This browser cannot encode frame by frame: it records in real time. Keep this tab in front.'
        const btns = document.createElement('div')
        btns.className = 'mo-btns'
        const start = button(`${MO_ICONS.record} Record`, 'mo-red', () => void this._record({
            camera: camSel.value === 'view' ? undefined : viewer.object3dManager.findObject(camSel.value) as any,
            size: SIZES.find(s => s[0] === sizeSel.value)!,
            fps: parseInt(fps.value),
            quality: quality.value as 'draft' | 'final',
            format: format.value as 'mp4' | 'webm',
            hidePaths: hidePaths.querySelector('input')!.checked,
        }))
        btns.append(button('Cancel', '', () => this.closeRecordDialog()), start)
        form.append(note, btns)
        d.appendChild(form)
        d.addEventListener('keydown', e => {
            if (e.key === 'Escape') this.closeRecordDialog()
            e.stopPropagation()
        })
        const showFrame = () => {
            const s = SIZES.find(z => z[0] === sizeSel.value)!
            this._showFrame(s[2] && s[3] ? s[2] / s[3] : 0)
        }
        sizeSel.addEventListener('change', showFrame)
        showFrame()
        viewer.container.appendChild(d)
        start.focus()
    }

    closeRecordDialog() {
        if (this._abort) this._abort.abort()
        this._recDialog?.remove()
        this._recDialog = undefined
        this._showFrame(-1)
    }

    /** A frame on the view with the video's aspect; outside it is dimmed. 0: the whole view; -1: none */
    private _showFrame(aspect: number) {
        const viewer = this._viewer
        if (!viewer) return
        if (aspect < 0) {
            this._frame?.remove()
            this._frame = undefined
            return
        }
        if (!this._frame) {
            this._frame = document.createElement('div')
            this._frame.className = 'tlb-frame'
            viewer.container.appendChild(this._frame)
        }
        const cw = viewer.canvas.clientWidth, ch = viewer.canvas.clientHeight
        const a = aspect || cw / ch
        const w = Math.min(cw, ch * a), h = w / a
        const r = viewer.canvas.getBoundingClientRect(), c = viewer.container.getBoundingClientRect()
        Object.assign(this._frame.style, {
            left: r.left - c.left + (cw - w) / 2 + 'px', top: r.top - c.top + (ch - h) / 2 + 'px', width: w + 'px', height: h + 'px',
        })
    }

    private _abort?: AbortController

    private async _record(o: {camera?: any, size: typeof SIZES[number], fps: number, quality: 'draft' | 'final', format: 'mp4' | 'webm', hidePaths: boolean}) {
        const viewer = this._viewer
        const rec = viewer?.getPlugin(VideoRecorderPlugin)
        const d = this._recDialog
        if (!viewer || !rec || !d) return
        // a clean view: no selection, gizmo, widgets or grid (the toolbar's View mode), path lines hidden
        const toolbar = viewer.getPlugin('EditorToolbarPlugin') as any
        const picking = viewer.getPlugin(PickingPlugin)
        const selected = (picking?.getSelectedObjects?.() ?? []) as IObject3D[]
        const wasView = !!toolbar?.viewMode
        if (toolbar && !wasView) toolbar.setViewMode(true)
        else picking?.setSelectedObject(undefined)
        const hidden: IObject3D[] = []
        if (o.hidePaths) {
            for (const a of viewer.getPlugin(CameraPathPlugin)?.pathAnimations() ?? []) {
                if (a.path?.visible) {
                    a.path.visible = false
                    hidden.push(a.path)
                }
            }
            viewer.scene.setDirty()
        }

        d.innerHTML = ''
        const title = document.createElement('div')
        title.className = 'mo-title'
        title.innerHTML = '<span class="tlb-recdot"></span>Recording…'
        const preview = document.createElement('canvas')
        preview.className = 'tlb-preview'
        const bar = document.createElement('div')
        bar.className = 'tlb-progress'
        bar.innerHTML = '<i></i>'
        const status = document.createElement('p')
        status.className = 'mo-note'
        const btns = document.createElement('div')
        btns.className = 'mo-btns'
        this._abort = new AbortController()
        btns.append(button('Cancel', '', () => this._abort?.abort()))
        d.append(title, preview, bar, status, btns)
        this._root?.classList.add('tlb-busy')

        const [, , w, h] = o.size
        const t0 = performance.now()
        let result: VideoRecordResult | undefined
        let error: unknown
        try {
            result = await rec.record({
                fps: o.fps, quality: o.quality, format: o.format, camera: o.camera,
                width: w || undefined, height: h || undefined, signal: this._abort.signal,
                onProgress: (done, frames, frame) => {
                    (bar.firstChild as HTMLElement).style.width = done / frames * 100 + '%'
                    status.textContent = `Frame ${done} of ${frames} · ${((performance.now() - t0) / 1000).toFixed(0)} s`
                    if (done % 3 === 1 || done === frames) {
                        const pw = 300, ph = Math.round(pw * frame.height / frame.width)
                        if (preview.width !== pw) {
                            preview.width = pw
                            preview.height = ph
                        }
                        preview.getContext('2d')?.drawImage(frame, 0, 0, pw, ph)
                    }
                },
            })
        } catch (e) {
            error = e
        }
        this._abort = undefined
        this._root?.classList.remove('tlb-busy')
        hidden.forEach(p => p.visible = true)
        viewer.scene.setDirty()
        if (toolbar && !wasView) toolbar.setViewMode(false)
        if (selected.length) viewer.getPlugin(SelectionUxPlugin)?.select(selected)
        if (!this._recDialog) return
        if (error || !result) {
            const cancelled = (error as any)?.name === 'AbortError'
            if (cancelled) this.closeRecordDialog()
            else {
                title.textContent = 'Recording failed'
                status.textContent = String((error as any)?.message ?? error)
                btns.innerHTML = ''
                btns.append(button('Close', '', () => this.closeRecordDialog()))
            }
            return
        }
        this._showResult(result, (performance.now() - t0) / 1000)
    }

    private _showResult(r: VideoRecordResult, secs: number) {
        const d = this._recDialog
        if (!d) return
        const url = URL.createObjectURL(r.blob)
        this._showFrame(-1)
        d.innerHTML = ''
        const title = document.createElement('div')
        title.className = 'mo-title'
        title.textContent = 'Your video'
        const x = button(MO_ICONS.close, 'mo-icon mo-x', () => {
            URL.revokeObjectURL(url)
            this.closeRecordDialog()
        })
        x.setAttribute('aria-label', 'Close')
        title.appendChild(x)
        const video = document.createElement('video')
        video.className = 'tlb-video'
        video.src = url
        video.controls = true
        video.loop = true
        video.muted = true
        video.autoplay = true
        video.playsInline = true
        const info = document.createElement('p')
        info.className = 'mo-note'
        info.textContent = `${r.width}×${r.height} · ${r.frames} frames · ${r.ext.toUpperCase()} · ${(r.blob.size / 1e6).toFixed(1)} MB · made in ${secs.toFixed(0)} s${r.method === 'realtime' ? ' (real time)' : ''}`
        const name = `threepipe-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${r.ext}`
        const dl = document.createElement('a')
        dl.className = 'mo-btn mo-primary'
        dl.href = url
        dl.download = name
        dl.textContent = `Download .${r.ext}`
        const again = button('Record again', '', () => {
            URL.revokeObjectURL(url)
            this.openRecordDialog()
        })
        const btns = document.createElement('div')
        btns.className = 'mo-btns'
        btns.append(again, dl)
        d.append(title, video, info, btns)
        dl.focus()
    }

    // endregion
}

function laneColor(obj: any, prop: string) {
    if (prop === 'path' || obj?.isCamera) return '#8b5cf6'
    if (obj?.isLight) return '#f59e0b'
    if (/color/i.test(prop)) return '#ec4899'
    return '#0d99ff'
}

let stylesAdded = false
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
/* between the layers/notes column on the left and the edge; --tlb-left is the column's width */
.tlb-root { position: absolute; left: var(--tlb-left, 184px); right: 12px; bottom: 52px; margin: 0 auto; z-index: 12; max-width: 760px; padding: 6px 8px 8px; }
.tlb-head { display: flex; align-items: center; gap: 4px; height: 28px; }
.tlb-time { font-variant-numeric: tabular-nums; min-width: 44px; text-align: right; margin-left: 4px; }
.tlb-dim { color: var(--mo-dim); }
.tlb-end { width: 52px !important; height: 22px !important; text-align: right; }
.tlb-head .mo-btn:not(.mo-icon) { height: 26px; padding: 0 8px; }
.tlb-cam { background: transparent; }
.tlb-cam.on { background: var(--mo-soft); color: var(--mo-cam); }
.tlb-rec { color: var(--mo-rec); }
.tlb-body { position: relative; margin: 6px 4px 0; cursor: ew-resize; user-select: none; }
.tlb-ruler { position: relative; height: 14px; border-bottom: 1px solid var(--mo-line); }
.tlb-ruler span { position: absolute; top: 0; transform: translateX(-50%); color: var(--mo-dim); font-size: 10px; font-variant-numeric: tabular-nums; }
.tlb-ruler span:first-child { transform: none; }
.tlb-endmark { position: absolute; top: 0; bottom: -200px; width: 0; border-left: 2px dashed var(--mo-rec); opacity: .5; pointer-events: none; }
.tlb-lanes { display: flex; flex-direction: column; gap: 3px; padding-top: 4px; max-height: 92px; overflow-y: auto; overflow-x: hidden; }
.tlb-lane { position: relative; height: 20px; }
.tlb-empty { color: var(--mo-dim); padding: 4px 0 2px; cursor: default; }
.tlb-clip {
  position: absolute; top: 0; bottom: 0; border-radius: 4px; background: color-mix(in srgb, var(--c) 18%, var(--mo-bg)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 55%, transparent);
  color: var(--mo-fg); cursor: grab; overflow: hidden; display: flex; align-items: center; padding: 0 8px; font-size: 10px; white-space: nowrap;
}
.tlb-clip.tlb-sel { box-shadow: inset 0 0 0 2px var(--c); }
.tlb-clip span { overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.tlb-key { position: absolute; top: 50%; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; background: var(--c); transform: rotate(45deg); pointer-events: none; }
.tlb-key:first-of-type { margin-left: 1px; }
.tlb-key:last-of-type { margin-left: -9px; }
.tlb-edge { position: absolute; right: 0; top: 0; bottom: 0; width: 7px; cursor: ew-resize; }
.tlb-playhead { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--mo-rec); pointer-events: none; border-radius: 1px; }
.tlb-playhead::before { content: ''; position: absolute; top: -2px; left: -4px; border: 5px solid transparent; border-top-color: var(--mo-rec); }
.tlb-busy { opacity: .5; pointer-events: none; }
.tlb-rec-dialog { position: absolute; right: 16px; bottom: 170px; width: 320px; z-index: 14; max-width: calc(100% - 24px); }
.tlb-preview, .tlb-video { display: block; width: 100%; border-radius: 5px; background: #000; margin-top: 4px; }
.tlb-video { max-height: 260px; }
.tlb-progress { height: 4px; border-radius: 2px; background: var(--mo-field); margin-top: 10px; overflow: hidden; }
.tlb-progress i { display: block; height: 100%; width: 0; background: var(--mo-rec); transition: width .1s; }
.tlb-recdot { width: 10px; height: 10px; border-radius: 50%; background: var(--mo-rec); animation: tlb-blink 1s infinite; }
@keyframes tlb-blink { 50% { opacity: .3; } }
a.mo-btn { text-decoration: none; }
.tlb-frame { position: absolute; z-index: 6; pointer-events: none; box-shadow: 0 0 0 9999px rgba(0,0,0,.35); outline: 1.5px solid #ef4444; }
`
    document.head.appendChild(st)
}

