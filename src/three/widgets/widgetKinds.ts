import {CanvasTexture, LinearFilter, Object3D, SRGBColorSpace} from 'three'

/**
 * The kinds of lights and cameras that have their own colour and icon in the widgets (and in any other UI that shows
 * them, like an editor overlay).
 */
export type WidgetKind =
    'directionalLight' | 'spotLight' | 'pointLight' | 'rectAreaLight' | 'hemisphereLight' | 'ambientLight' |
    'perspectiveCamera' | 'orthographicCamera'

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
 * The layout of an icon texture, in icon units (1 unit is 1 px at the default size): a round icon of
 * {@link widgetIconLayout.diameter} in a square of {@link widgetIconLayout.box}, and a dot of
 * {@link widgetIconLayout.dot} at {@link widgetIconLayout.dotOffset} right and down of the centre.
 */
export const widgetIconLayout = {
    box: 28,
    diameter: 22,
    dot: 7,
    dotOffset: 8,
} as const

// about 2 texels per icon unit: no mipmaps, so the thin coloured lines keep their colour at the default size instead of
// being averaged with the white disc
const textureSize = 64
const iconTextures = new Map<WidgetKind, CanvasTexture>()
let dotTexture: CanvasTexture | undefined

/** A square canvas and its 2D context, `undefined` where there is none */
function canvas2d(size: number) {
    if (typeof document === 'undefined' || typeof Path2D === 'undefined') return undefined
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext?.('2d')
    return ctx ? {canvas, ctx} : undefined
}

/** An sRGB texture of a canvas, premultiplied, without mipmaps */
function texture(canvas: HTMLCanvasElement) {
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    t.generateMipmaps = false
    t.minFilter = LinearFilter
    t.premultiplyAlpha = true // no dark edges where the transparent texels are filtered in
    return t
}

/**
 * The icon of a kind as a texture (see {@link widgetIconLayout}): a white disc with a ring and the icon in the
 * colour of the kind, and for lights a white spot for the dot. Made once per kind and shared; do not dispose it.
 * `undefined` where there is no 2D canvas (Node.js without a canvas polyfill).
 */
export function getWidgetIconTexture(kind: WidgetKind): CanvasTexture | undefined {
    const cached = iconTextures.get(kind)
    if (cached) return cached
    const c = canvas2d(textureSize)
    if (!c) return undefined
    const {ctx} = c
    const {color, icon, dot} = widgetKinds[kind]
    const {box, diameter, dot: dotSize, dotOffset} = widgetIconLayout
    const mid = box / 2
    ctx.scale(textureSize / box, textureSize / box)
    ctx.beginPath()
    ctx.arc(mid, mid, diameter / 2, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = color
    ctx.stroke()
    ctx.save()
    ctx.translate(mid - 8, mid - 8)
    ctx.lineWidth = 1.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.stroke(new Path2D(icon))
    ctx.restore()
    if (dot) { // the white edge around the dot, the dot sprite draws the colour inside it
        ctx.beginPath()
        ctx.arc(mid + dotOffset, mid + dotOffset, dotSize / 2 + 1.2, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
    }
    const t = texture(c.canvas)
    iconTextures.set(kind, t)
    return t
}

/**
 * A white disc, for the dot in the object's own colour (the sprite colour tints it). Made once and shared; do not
 * dispose it. `undefined` where there is no 2D canvas.
 */
export function getWidgetDotTexture(): CanvasTexture | undefined {
    if (dotTexture) return dotTexture
    const c = canvas2d(textureSize / 2)
    if (!c) return undefined
    const r = textureSize / 4
    c.ctx.beginPath()
    c.ctx.arc(r, r, r - 1, 0, Math.PI * 2)
    c.ctx.fillStyle = '#ffffff'
    c.ctx.fill()
    dotTexture = texture(c.canvas)
    return dotTexture
}
