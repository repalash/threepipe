/**
 * The marquee drawn while box, lasso or circle selecting: a fixed-position SVG over the canvas, so
 * it is crisp at any zoom and costs the renderer nothing.
 *
 * Blender's gesture overlays (`wm_gesture_draw.cc`): a dashed box with a translucent fill, a dashed
 * lasso, and a circle outline that follows the cursor. Dashes alternate black and white so they read
 * on any background.
 */

const NS = 'http://www.w3.org/2000/svg'

export class RegionOverlay {
    private _svg: SVGSVGElement | null = null
    private _shapes: SVGElement[] = []

    constructor(private readonly _canvas: HTMLCanvasElement) {}

    private _ensure(): SVGSVGElement {
        if (this._svg) return this._svg
        const svg = document.createElementNS(NS, 'svg')
        svg.setAttribute('data-mesh-edit-region', '')
        const s = svg.style
        s.position = 'fixed'
        s.pointerEvents = 'none'
        s.zIndex = '2147483000'
        s.overflow = 'visible'
        document.body.appendChild(svg)
        this._svg = svg
        return svg
    }

    /** Size and place the SVG over the canvas. */
    private _fit(svg: SVGSVGElement): void {
        const r = this._canvas.getBoundingClientRect()
        svg.style.left = r.left + 'px'
        svg.style.top = r.top + 'px'
        svg.setAttribute('width', String(Math.max(1, r.width)))
        svg.setAttribute('height', String(Math.max(1, r.height)))
    }

    private _set(elements: SVGElement[]): void {
        const svg = this._ensure()
        this._fit(svg)
        for (const el of this._shapes) el.remove()
        this._shapes = elements
        for (const el of elements) svg.appendChild(el)
    }

    /** Two strokes, black under white dashes, so the outline shows on any colour. */
    private _dashed(tag: 'rect' | 'polygon' | 'circle', attrs: Record<string, string>, fill: boolean): SVGElement[] {
        const make = (stroke: string, dash: string | null) => {
            const el = document.createElementNS(NS, tag)
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
            el.setAttribute('fill', fill && dash ? 'rgba(255, 255, 255, 0.08)' : 'none')
            el.setAttribute('stroke', stroke)
            el.setAttribute('stroke-width', '1')
            if (dash) el.setAttribute('stroke-dasharray', dash)
            return el
        }
        return [make('rgba(0, 0, 0, 0.8)', null), make('rgba(255, 255, 255, 0.9)', '4 4')]
    }

    /** Canvas-space coordinates, as the plugin's pointer positions are. */
    box(x0: number, y0: number, x1: number, y1: number): void {
        const x = Math.min(x0, x1) + 0.5
        const y = Math.min(y0, y1) + 0.5
        const w = Math.max(0, Math.abs(x1 - x0))
        const h = Math.max(0, Math.abs(y1 - y0))
        this._set(this._dashed('rect', {x: String(x), y: String(y), width: String(w), height: String(h)}, true))
    }

    lasso(points: readonly (readonly [number, number])[]): void {
        const pts = points.map(p => `${p[0] + 0.5},${p[1] + 0.5}`).join(' ')
        this._set(this._dashed('polygon', {points: pts}, true))
    }

    circle(cx: number, cy: number, radius: number): void {
        this._set(this._dashed('circle', {cx: String(cx), cy: String(cy), r: String(radius)}, false))
    }

    clear(): void {
        for (const el of this._shapes) el.remove()
        this._shapes = []
        this._svg?.remove()
        this._svg = null
    }

    dispose(): void {
        this.clear()
    }
}
