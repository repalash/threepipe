import {CanvasTexture, LinearFilter, Object3D, SRGBColorSpace} from 'three'

/**
 * The kinds of lights and cameras that have their own colour and icon in the widgets (and in any other UI that shows
 * them, like an editor overlay).
 */
export type WidgetKind =
    'directionalLight' | 'spotLight' | 'pointLight' | 'rectAreaLight' | 'hemisphereLight' | 'ambientLight' |
    'perspectiveCamera' | 'orthographicCamera'

/**
 * How the icons of lights and cameras are drawn: `dom`, an element in an overlay over the canvas, or `sprite`, a sprite
 * in the scene. See `Object3DWidgetsPlugin.iconMode`.
 */
export type WidgetIconMode = 'dom' | 'sprite'

export interface WidgetKindStyle {
    /** The colour of the kind (CSS hex, sRGB), for its icon and its lines */
    color: string
    /** The icon: SVG path data in a 16 x 16 box, drawn as a stroke */
    icon: string
    /** A dot in the object's own colour is drawn on the icon (lights) */
    dot: boolean
}

/**
 * The colour and the icon of each {@link WidgetKind}. One colour per kind (as in Blender), so a light or a camera is
 * easy to find in the scene and to talk about. Read it, do not copy it: every view of lights and cameras uses this
 * table.
 */
export const widgetKinds: Readonly<Record<WidgetKind, Readonly<WidgetKindStyle>>> = {
    directionalLight: {color: '#f59e0b', dot: true, icon: 'M8 5.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4'},
    spotLight: {color: '#f97316', dot: true, icon: 'M5.5 3h5l3 8.5h-11zM6 13.5h4'},
    pointLight: {color: '#eab308', dot: true, icon: 'M8 2.5a4 4 0 0 1 2.5 7.1V11h-5V9.6A4 4 0 0 1 8 2.5M6 13.5h4'},
    rectAreaLight: {color: '#fb923c', dot: true, icon: 'M2.5 4.5h11v7h-11zM5 14h6'},
    hemisphereLight: {color: '#64748b', dot: true, icon: 'M2.5 10a5.5 5.5 0 0 1 11 0zM2 12.5h12'},
    ambientLight: {color: '#64748b', dot: true, icon: 'M2.5 10a5.5 5.5 0 0 1 11 0zM2 12.5h12'},
    perspectiveCamera: {color: '#8b5cf6', dot: false, icon: 'M2 5.5h8.5v6H2zM10.5 7.5l3.5-2v6l-3.5-2'},
    orthographicCamera: {color: '#8b5cf6', dot: false, icon: 'M2 5.5h8.5v6H2zM10.5 6.5h3.5v4h-3.5'},
}

/**
 * The {@link WidgetKind} of a light or a camera, `undefined` for any other object.
 */
export function getWidgetKind(object: Object3D): WidgetKind | undefined {
    const o = object as any
    if (o.isDirectionalLight) return 'directionalLight'
    if (o.isSpotLight) return 'spotLight'
    if (o.isPointLight) return 'pointLight'
    if (o.isRectAreaLight) return 'rectAreaLight'
    if (o.isHemisphereLight) return 'hemisphereLight'
    if (o.isAmbientLight) return 'ambientLight'
    if (o.isPerspectiveCamera) return 'perspectiveCamera'
    if (o.isOrthographicCamera) return 'orthographicCamera'
    return undefined
}

/**
 * The layout of an icon, in icon units (1 unit is 1 CSS px at the default size): a round icon of
 * {@link widgetIconLayout.diameter} in a square of {@link widgetIconLayout.box}, and a dot of
 * {@link widgetIconLayout.dot} at {@link widgetIconLayout.dotOffset} right and down of the centre.
 */
export const widgetIconLayout = {
    box: 28,
    diameter: 22,
    dot: 7,
    dotOffset: 8,
} as const


/**
 * One shape of a widget icon, in icon units ({@link widgetIconLayout}): a circle, or SVG path data in a 16 x 16 box.
 * Paths are stroked with round caps and joins.
 */
export interface WidgetIconShape {
    /** Centre x, centre y and radius of a circle */
    circle?: readonly [number, number, number]
    /** SVG path data, in a 16 x 16 box with its top left corner at {@link at} */
    path?: string
    at?: readonly [number, number]
    /** Fill colour. `'object'`: the colour of the object (the dot of a light) */
    fill?: string
    stroke?: string
    lineWidth?: number
}

/**
 * The shapes of the icon of a kind, in drawing order: a white disc with a ring in the colour of the kind, the icon of
 * the kind, and for lights the dot in the object's colour with a white edge. The one definition of the icon: the sprite
 * texture ({@link createWidgetIconTexture}) and the DOM icon ({@link getWidgetIconSvg}) are drawn from it.
 */
export function getWidgetIconShapes(kind: WidgetKind): WidgetIconShape[] {
    const {color, icon, dot} = widgetKinds[kind]
    const {box, diameter, dot: dotSize, dotOffset} = widgetIconLayout
    const mid = box / 2
    const shapes: WidgetIconShape[] = [
        {circle: [mid, mid, diameter / 2], fill: 'rgba(255,255,255,0.95)', stroke: color, lineWidth: 1.5},
        {path: icon, at: [mid - 8, mid - 8], stroke: color, lineWidth: 1.4},
    ]
    if (dot) shapes.push(
        {circle: [mid + dotOffset, mid + dotOffset, dotSize / 2 + 1.2], fill: '#ffffff'},
        {circle: [mid + dotOffset, mid + dotOffset, dotSize / 2], fill: 'object'},
    )
    return shapes
}

const n = (v: number) => +v.toFixed(2)

/**
 * The icon of a kind as SVG markup, `viewBox` {@link widgetIconLayout.box} square, for an icon in the DOM. The dot is
 * filled with `currentColor`: set the CSS `color` of the element to the colour of the object.
 */
export function getWidgetIconSvg(kind: WidgetKind): string {
    const {box} = widgetIconLayout
    const body = getWidgetIconShapes(kind).map(s => {
        const paint = `fill="${s.fill === 'object' ? 'currentColor' : s.fill ?? 'none'}"` +
            (s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.lineWidth ?? 1}"` : '')
        if (s.circle) return `<circle cx="${n(s.circle[0])}" cy="${n(s.circle[1])}" r="${n(s.circle[2])}" ${paint}/>`
        const [x, y] = s.at ?? [0, 0]
        return `<path d="${s.path}" transform="translate(${n(x)} ${n(y)})" stroke-linecap="round" stroke-linejoin="round" ${paint}/>`
    }).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="100%" height="100%">${body}</svg>`
}

/**
 * The size in texels of the icon texture for an icon of `size` CSS pixels (its diameter) on a canvas with `pixelRatio`
 * (the render scale): about one texel per device pixel, so the texture is neither upscaled nor shrunk on screen.
 */
export function getWidgetIconTextureSize(size: number, pixelRatio: number) {
    const {box, diameter} = widgetIconLayout
    return Math.max(1, Math.round(box * size / diameter * (pixelRatio || 1)))
}

/**
 * Draws the icon of a kind ({@link getWidgetIconShapes}) on a square canvas of `texels` and returns it as an sRGB
 * texture, premultiplied, without mipmaps. `'icon'` draws all shapes but the dot, `'dot'` only the dot, in white (the
 * sprite colour tints it), at the same place in the same square. The caller owns the texture and disposes it.
 * `undefined` where there is no 2D canvas (Node.js without a canvas polyfill).
 */
export function createWidgetIconTexture(kind: WidgetKind, texels: number, layer: 'icon' | 'dot' = 'icon'): CanvasTexture | undefined {
    if (typeof document === 'undefined' || typeof Path2D === 'undefined') return undefined
    const canvas = document.createElement('canvas')
    canvas.width = texels
    canvas.height = texels
    const ctx = canvas.getContext?.('2d')
    if (!ctx) return undefined
    const scale = texels / widgetIconLayout.box
    ctx.scale(scale, scale)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of getWidgetIconShapes(kind)) {
        if (layer === 'dot' ? s.fill !== 'object' : s.fill === 'object') continue
        ctx.save()
        let path: Path2D | undefined
        if (s.circle) {
            ctx.beginPath()
            ctx.arc(s.circle[0], s.circle[1], s.circle[2], 0, Math.PI * 2)
        } else if (s.path) {
            const [x, y] = s.at ?? [0, 0]
            ctx.translate(x, y)
            path = new Path2D(s.path)
        }
        if (s.fill && s.fill !== 'none') {
            ctx.fillStyle = s.fill === 'object' ? '#ffffff' : s.fill
            path ? ctx.fill(path) : ctx.fill()
        }
        if (s.stroke) {
            ctx.lineWidth = s.lineWidth ?? 1
            ctx.strokeStyle = s.stroke
            path ? ctx.stroke(path) : ctx.stroke()
        }
        ctx.restore()
    }
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    // one texel per device pixel (see getWidgetIconTextureSize): no mipmaps needed, and the thin coloured lines keep
    // their colour instead of being averaged with the white disc
    t.generateMipmaps = false
    t.minFilter = LinearFilter
    t.premultiplyAlpha = true // no dark edges where the transparent texels are filtered in
    return t
}
