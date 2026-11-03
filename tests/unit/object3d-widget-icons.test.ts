/**
 * The icons and colours of the light and camera widgets (Object3DWidgetsPlugin): one colour and icon per kind from
 * `widgetKinds`, a sprite that keeps its pixel size and is drawn on top, not in the GBuffer or the depth passes,
 * picked as the widget's object, and the optional frustum of the shadow camera.
 * No WebGL: the icon textures are drawn on a fake 2D canvas that records the colours, and the pixel size is checked
 * with three.js `Sprite.raycast` at pixel offsets from the icon centre. The DOM icons (`iconMode: 'dom'`) are checked on
 * fake elements that keep their children, styles and listeners.
 */
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest'
import {
    Color,
    DirectionalLight,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    PointLight,
    Raycaster,
    SpotLight,
    Vector2,
} from 'three'

let tp: typeof import('threepipe')

/** The colours each fake canvas was drawn with, by canvas */
const drawn = new Map<object, string[]>()
const realCreateElement = document.createElement
const realPath2D = (globalThis as any).Path2D

const W = 800 // viewer width in CSS px

/** A DOM element with the parts the icon overlay uses */
class FakeElement {
    style: Record<string, string> = {}
    children: FakeElement[] = []
    parent: FakeElement | null = null
    attributes: Record<string, string> = {}
    listeners: Record<string, ((e: any) => void)[]> = {}
    className = ''
    hidden = false
    title = ''
    innerHTML = ''
    innerText = ''
    type = ''
    clientLeft = 0
    clientTop = 0
    constructor(public tagName: string) {}
    appendChild(c: FakeElement) {
        c.remove()
        c.parent = this
        this.children.push(c)
        return c
    }
    remove() {
        if (!this.parent) return
        this.parent.children.splice(this.parent.children.indexOf(this), 1)
        this.parent = null
    }
    setAttribute(k: string, v: any) {
        this.attributes[k] = String(v)
    }
    addEventListener(type: string, f: (e: any) => void) {
        (this.listeners[type] ??= []).push(f)
    }
    removeEventListener() {
        return
    }
    dispatchEvent(e: any) {
        this.listeners[e.type]?.forEach(f => f(e))
        return true
    }
    getBoundingClientRect() {
        return {left: 0, top: 0, width: W, height: H}
    }
    /** All descendants with a class */
    all(className: string): FakeElement[] {
        return this.children.flatMap(c => [...c.className.split(' ').includes(className) ? [c] : [], ...c.all(className)])
    }
}

beforeAll(async() => {
    tp = await import('threepipe')
    ;(globalThis as any).Path2D = class {
        constructor(public d: string) {}
    }
    ;(document as any).createElement = (tag: string) => {
        if (tag !== 'canvas') return new FakeElement(tag)
        const canvas: any = {width: 0, height: 0, style: {}, addEventListener: () => undefined}
        const colors: string[] = []
        drawn.set(canvas, colors)
        const ctx = new Proxy({}, {
            get: (_t, k) => k === 'canvas' ? canvas : () => undefined,
            set: (_t, k, v) => {
                if (k === 'strokeStyle') colors.push(v)
                return true
            },
        })
        canvas.getContext = () => ctx
        return canvas
    }
}, 60_000)

afterAll(() => {
    (document as any).createElement = realCreateElement
    ;(globalThis as any).Path2D = realPath2D
})

const H = 600 // canvas height in CSS px

/** A light or a camera at the origin (three.js puts lights at y 1) */
function light<T extends Object3D>(o: T, parent?: Object3D) {
    if (parent) parent.add(o)
    o.position.set(0, 0, 0)
    o.updateMatrixWorld(true)
    return o
}

function widgets() {
    const dir = light(new DirectionalLight(0x00ff00))
    const spot = light(new SpotLight(0x0000ff))
    const point = light(new PointLight(0xff00ff))
    const persp = light(new PerspectiveCamera(45, 1, 0.1, 10))
    const ortho = light(new OrthographicCamera(-1, 1, 1, -1, 0.1, 10))
    return [
        {object: dir, widget: new tp.DirectionalLightHelper2(dir), kind: 'directionalLight'},
        {object: spot, widget: new tp.SpotLightHelper2(spot), kind: 'spotLight'},
        {object: point, widget: new tp.PointLightHelper2(point), kind: 'pointLight'},
        {object: persp, widget: new tp.CameraHelper2(persp), kind: 'perspectiveCamera'},
        {object: ortho, widget: new tp.CameraHelper2(ortho), kind: 'orthographicCamera'},
    ] as const
}

/** Whether a ray through the pixel `dy` px above the centre of the canvas hits the icon */
function hitsAt(icon: Object3D, camera: PerspectiveCamera | OrthographicCamera, dy: number) {
    const raycaster = new Raycaster()
    raycaster.setFromCamera(new Vector2(0, dy / (H / 2)), camera)
    return raycaster.intersectObject(icon, false).length > 0
}

describe('widgetKinds', () => {
    test('a kind for each light and camera, none for other objects', () => {
        expect(tp.getWidgetKind(new DirectionalLight())).toBe('directionalLight')
        expect(tp.getWidgetKind(new SpotLight())).toBe('spotLight')
        expect(tp.getWidgetKind(new PointLight())).toBe('pointLight')
        expect(tp.getWidgetKind(new tp.RectAreaLight2())).toBe('rectAreaLight')
        expect(tp.getWidgetKind(new tp.HemisphereLight2())).toBe('hemisphereLight')
        expect(tp.getWidgetKind(new tp.AmbientLight2())).toBe('ambientLight')
        expect(tp.getWidgetKind(new PerspectiveCamera())).toBe('perspectiveCamera')
        expect(tp.getWidgetKind(new OrthographicCamera())).toBe('orthographicCamera')
        expect(tp.getWidgetKind(new Mesh())).toBeUndefined()
    })

    test('the icon texture of a kind is drawn in the colour of the kind, at the asked size', () => {
        const t = tp.createWidgetIconTexture('spotLight', 56)!
        expect(t).toBeDefined()
        expect(t.image.width).toBe(56)
        expect(t.image.height).toBe(56)
        expect(t.generateMipmaps).toBe(false)
        expect(drawn.get(t.image)).toContain(tp.widgetKinds.spotLight.color)
        expect(tp.createWidgetIconTexture('spotLight', 56)).not.toBe(t) // owned by the caller
    })

    test('the SVG of the DOM icons comes from the same shapes as the texture', () => {
        for (const kind of Object.keys(tp.widgetKinds) as (keyof typeof tp.widgetKinds)[]) {
            const {color, icon, dot} = tp.widgetKinds[kind]
            const svg = tp.getWidgetIconSvg(kind)
            const shapes = tp.getWidgetIconShapes(kind)
            expect(svg).toContain(`viewBox="0 0 ${tp.widgetIconLayout.box} ${tp.widgetIconLayout.box}"`)
            expect(svg).toContain(`d="${icon}"`)
            expect(svg).toContain(`stroke="${color}"`)
            expect(svg.split('<circle').length - 1 + svg.split('<path').length - 1).toBe(shapes.length)
            // the dot is filled with the CSS colour of the element (the colour of the object)
            expect(svg.includes('fill="currentColor"')).toBe(dot)
            expect(shapes.some(sh => sh.fill === 'object')).toBe(dot)
        }
    })
})

describe('light and camera widget icons', () => {
    test('each kind gets its icon and its colour; lights have a dot in their own colour', () => {
        for (const {object, widget, kind} of widgets()) {
            const style = tp.widgetKinds[kind]
            expect(widget.kind).toBe(kind)
            const icon = widget.icon!
            expect(icon).toBeInstanceOf(tp.WidgetIcon)
            expect(icon.parent).toBe(widget)
            expect(icon.visible).toBe(true)
            expect(icon.material.map).toBeTruthy()
            expect(drawn.get(icon.material.map!.image)).toContain(style.color)
            expect(!!icon.dot.material.map).toBe(style.dot)
            expect(icon.dot.visible).toBe(style.dot)
            if (style.dot) expect(icon.dot.material.color.getHex()).toBe((object as DirectionalLight).color.getHex())
            // the lines too
            const line = (widget as any).hMaterial ?? (widget as any).line.material
            const lineColor = (widget as any).hMaterial ? line.color : new Color().fromArray((widget as any).line.geometry.getAttribute('instanceColorStart').array, 0)
            expect(lineColor.getHex()).toBe(new Color(style.color).getHex())
        }
    })

    test('the colour override of the lines still works', () => {
        const l = light(new DirectionalLight())
        const w = new tp.DirectionalLightHelper2(l, undefined, 0x123456)
        expect(w.hMaterial.color.getHex()).toBe(new Color(0x123456).getHex())
    })

    test('the dot follows a change of the light colour', () => {
        const l = light(new PointLight(0xff0000))
        const w = new tp.PointLightHelper2(l)
        l.color.set(0x00ffff)
        w.update()
        expect(w.icon!.dot.material.color.getHex()).toBe(0x00ffff)
    })

    test('drawn on top and left out of the GBuffer, the depth passes, shadows and exports', () => {
        const l = light(new SpotLight())
        const w = new tp.SpotLightHelper2(l)
        const icon = w.icon!
        for (const m of [icon.material, icon.dot.material]) {
            expect(m.sizeAttenuation).toBe(false)
            expect(m.depthTest).toBe(false)
            expect(m.depthWrite).toBe(false)
            expect(m.toneMapped).toBe(false)
            expect(m.userData.renderToGBuffer).toBe(false)
            expect(m.userData.renderToDepth).toBe(false)
        }
        expect(icon.castShadow).toBe(false)
        expect(icon.userData.__keepShadowDef).toBe(true)
        // the GBuffer pass renders the opaque list only; the icon stays transparent there
        const pass = new tp.GBufferRenderPass('gbuffer', undefined as any, new MeshBasicMaterial())
        pass.preprocessMaterial(icon.material as any)
        expect(icon.material.transparent).toBe(true)
        // widgets are skipped by traverseModels (used by the exports), so the icon is too
        const root = new tp.Group2()
        root.add(w)
        const visited: Object3D[] = []
        root.traverseModels(o => {
            visited.push(o)
        }, {visible: false, widgets: false})
        expect(visited).not.toContain(icon)
        expect(visited).not.toContain(w)
    })

    test('keeps its pixel size at any distance and zoom of a perspective camera', () => {
        const parent = new Object3D()
        parent.scale.setScalar(3) // a light in a scaled model root
        const l = light(new PointLight(), parent)
        const w = new tp.PointLightHelper2(l)
        w.updateMatrixWorld(true)
        const icon = w.icon!
        const half = icon.size * tp.widgetIconLayout.box / tp.widgetIconLayout.diameter / 2 // half of the sprite in px
        const camera = new PerspectiveCamera(45, 1, 0.1, 1000)
        for (const [distance, zoom] of [[5, 1], [50, 1], [50, 2.5], [400, 0.5]]) {
            camera.position.set(0, 0, distance)
            camera.zoom = zoom
            camera.updateProjectionMatrix()
            camera.updateMatrixWorld(true)
            icon.updateScale(camera, H)
            expect(hitsAt(icon, camera, half - 1)).toBe(true)
            expect(hitsAt(icon, camera, half + 1)).toBe(false)
        }
    })

    test('keeps its pixel size at any zoom of an orthographic camera, and follows iconSize', () => {
        const l = light(new DirectionalLight())
        const w = new tp.DirectionalLightHelper2(l)
        w.updateMatrixWorld(true)
        const icon = w.icon!
        const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
        camera.position.set(0, 0, 10)
        for (const [zoom, size] of [[1, 22], [4, 22], [0.25, 40]]) {
            w.iconSize = size
            camera.zoom = zoom
            camera.updateProjectionMatrix()
            camera.updateMatrixWorld(true)
            icon.updateScale(camera, H)
            const half = size * tp.widgetIconLayout.box / tp.widgetIconLayout.diameter / 2
            expect(hitsAt(icon, camera, half - 1)).toBe(true)
            expect(hitsAt(icon, camera, half + 1)).toBe(false)
        }
    })

    test('showIcon hides the icon', () => {
        const l = light(new DirectionalLight())
        const w = new tp.DirectionalLightHelper2(l)
        w.showIcon = false
        expect(w.icon!.visible).toBe(false)
        w.showIcon = true
        expect(w.icon!.visible).toBe(true)
    })

    test('other widgets have no icon', () => {
        const m = new Mesh(undefined, new MeshBasicMaterial())
        const w = new tp.BoneHelper(m as any)
        expect(w.kind).toBeUndefined()
        expect(w.icon).toBeUndefined()
    })
})

describe('picking an icon', () => {
    test('a click on the icon selects the light, also when a mesh is in front of it', () => {
        const scene = new tp.Group2()
        const l = light(new SpotLight())
        const w = new tp.SpotLightHelper2(l)
        const widgetRoot = new tp.Group2()
        widgetRoot.userData.isWidgetRoot = true
        scene.add(widgetRoot)
        widgetRoot.add(w)
        const wall = new Mesh(new tp.PlaneGeometry(10, 10), new MeshBasicMaterial())
        wall.position.z = 2
        scene.add(wall)
        const camera = new PerspectiveCamera(45, 1, 0.1, 100)
        camera.position.set(0, 0, 10)
        camera.updateMatrixWorld(true)
        scene.updateMatrixWorld(true)
        w.icon!.updateScale(camera, H)

        const raycaster = new Raycaster()
        raycaster.setFromCamera(new Vector2(0, 0), camera)
        const hits = raycaster.intersectObjects([wall, widgetRoot], true)
        expect(hits[0].object).toBe(w.icon) // drawn on top, so in front of the wall
        expect(tp.isPickable(w.icon as any)).toBe(true)

        // the PickingPlugin maps the hit on the icon to the object of the widget
        const picking = new tp.PickingPlugin() as any
        picking._viewer = {}
        let event: any
        picking.addEventListener('hitObject', (e: any) => event = e)
        picking._onObjectHit({type: 'hitObject', time: 0, intersects: {selectedObject: hits[0].object, intersect: hits[0], intersects: hits, mouse: new Vector2()}})
        expect(event.intersects.selectedObject).toBe(l)
        expect(event.intersects.selectedWidget).toBe(w)
    })

    test('the dot cannot be picked (the icon under it is)', () => {
        const l = light(new PointLight())
        const w = new tp.PointLightHelper2(l)
        const raycaster = new Raycaster()
        raycaster.setFromCamera(new Vector2(0, 0), new PerspectiveCamera())
        expect(raycaster.intersectObject(w.icon!.dot, false)).toHaveLength(0)
    })
})

describe('shadow camera frustum', () => {
    test('showShadowFrustum adds the helper of the shadow camera for a light that casts shadows, and removes it', () => {
        const l = light(new DirectionalLight())
        l.position.set(3, 4, 5)
        l.updateMatrixWorld(true)
        const w = new tp.DirectionalLightHelper2(l)
        expect(w.showShadowFrustum).toBe(false)
        expect(w.shadowHelper).toBeUndefined()

        w.showShadowFrustum = true
        expect(w.shadowHelper).toBeUndefined() // the light casts no shadows
        l.castShadow = true
        w.update()
        const helper = w.shadowHelper!
        expect(helper).toBeInstanceOf(tp.CameraHelper2)
        expect(helper.object).toBe(l.shadow.camera)
        expect(helper.parent).toBe(w)
        expect(helper.icon?.visible ?? false).toBe(false)
        expect(helper.userData.userSelectable).toBe(false)
        // in the colour of the light kind, where the shadow camera is
        const c = new Color().fromArray(helper.line.geometry.getAttribute('instanceColorStart').array as any, 0)
        expect(c.getHex()).toBe(new Color(tp.widgetKinds.directionalLight.color).getHex())
        w.updateMatrixWorld(true)
        expect(helper.matrixWorld.equals(l.shadow.camera.matrixWorld)).toBe(true)

        w.showShadowFrustum = false
        expect(w.shadowHelper).toBeUndefined()
        expect(helper.parent).toBeNull()
    })

    test('Object3DWidgetsPlugin options reach the widgets', () => {
        const plugin = new tp.Object3DWidgetsPlugin()
        expect(plugin.showIcons).toBe(true)
        expect(plugin.iconSize).toBe(22)
        expect(plugin.showShadowFrustum).toBe(false)
        const l = light(new SpotLight())
        l.castShadow = true
        const w = new tp.SpotLightHelper2(l)
        const c = new tp.CameraHelper2(light(new PerspectiveCamera()))
        plugin.widgets.push(w, c)
        plugin.showShadowFrustum = true
        plugin.iconSize = 30
        plugin.showIcons = false
        expect(w.shadowHelper).toBeInstanceOf(tp.CameraHelper2)
        expect(w.iconSize).toBe(30)
        expect(c.iconSize).toBe(30)
        expect(w.icon!.visible).toBe(false)
        expect(c.icon!.visible).toBe(false)
        const labels = (plugin.uiConfig.children as any[]).map(c => c.label)
        expect(labels).toEqual(expect.arrayContaining(['Show icons', 'Icon size (px)', 'Shadow frustum']))
    })
})

describe('sprite icons on screen', () => {
    test('two overlapping icons: the nearer one is hit first, and both before a model', () => {
        const near = light(new PointLight())
        near.position.set(0, 0, 3)
        near.updateMatrixWorld(true)
        const far = light(new SpotLight())
        const nearW = new tp.PointLightHelper2(near)
        const farW = new tp.SpotLightHelper2(far)
        const wall = new Mesh(new tp.PlaneGeometry(10, 10), new MeshBasicMaterial())
        wall.position.set(0.3, 0.2, 5) // the ray not on the diagonal of the plane, where it hits both triangles
        wall.updateMatrixWorld(true)
        const camera = new PerspectiveCamera(45, 1, 0.1, 100)
        camera.position.set(0, 0, 10)
        camera.updateMatrixWorld(true)
        const raycaster = new Raycaster()
        raycaster.setFromCamera(new Vector2(0, 0), camera)
        for (const order of [[farW, nearW], [nearW, farW]]) { // the order in the scene does not matter
            const root = new tp.Group2()
            root.add(...order)
            root.updateMatrixWorld(true)
            nearW.icon!.updateScale(camera, H)
            farW.icon!.updateScale(camera, H)
            const hits = raycaster.intersectObjects([wall, ...order.map(w => w.icon!)], false)
            expect(hits.map(h => h.object)).toEqual([nearW.icon, farW.icon, wall])
            expect(hits[0].distance).toBeGreaterThanOrEqual(0)
        }
    })

    test('not frustum culled: the icon keeps its pixel size, so it shows at the edge when its centre is just outside', () => {
        const w = new tp.PointLightHelper2(light(new PointLight()))
        expect(w.icon!.frustumCulled).toBe(false)
        expect(w.icon!.dot.frustumCulled).toBe(false)
    })

    test('the texture is drawn at about one texel per device pixel, again only when the size or the render scale changes', () => {
        const w = new tp.PointLightHelper2(light(new PointLight()))
        const icon = w.icon!
        const {box} = tp.widgetIconLayout
        expect(icon.textureSize).toBe(box) // 22 px at a pixel ratio of 1
        const renderer = (pixelRatio: number) => ({getSize: (v: Vector2) => v.set(W, H), getPixelRatio: () => pixelRatio}) as any
        const camera = new PerspectiveCamera(45, 1, 0.1, 100)
        icon.onBeforeRender(renderer(2), undefined, camera)
        expect(icon.textureSize).toBe(2 * box)
        const map = icon.material.map!
        expect(map.image.width).toBe(2 * box)
        expect(icon.dot.material.map!.image.width).toBe(2 * box)
        icon.onBeforeRender(renderer(2), undefined, camera)
        expect(icon.material.map).toBe(map) // same size: not drawn again
        w.iconSize = 44
        icon.onBeforeRender(renderer(2), undefined, camera)
        expect(icon.textureSize).toBe(4 * box)
        expect(icon.material.map).not.toBe(map)
        icon.onBeforeRender(renderer(1.5), undefined, camera)
        expect(icon.textureSize).toBe(3 * box)
        expect(tp.getWidgetIconTextureSize(30, 1.25)).toBe(Math.round(box * 30 / 22 * 1.25))
    })
})

describe('icon mode', () => {
    /** A viewer with a container, a canvas and a camera, and the lights and cameras in its model root */
    function setup({container = true, picking = undefined as any} = {}) {
        const sceneRoot = new tp.Group2()
        const modelRoot = new tp.Group2()
        sceneRoot.add(modelRoot)
        const sun = new DirectionalLight(0x00ff00)
        sun.position.set(-2, 1, 0)
        const bulb = new PointLight(0xff0000)
        bulb.position.set(2, 0, 3) // nearer to the camera
        const cam = new PerspectiveCamera(45, 1, 0.1, 10)
        cam.position.set(0, 0, -4)
        const mesh = new Mesh(new tp.PlaneGeometry(1, 1), new MeshBasicMaterial())
        modelRoot.add(sun, bulb, cam, mesh)
        const camera = new PerspectiveCamera(45, W / H, 0.1, 100)
        camera.position.set(0, 0, 10)
        camera.updateMatrixWorld(true)
        const containerEl = container ? new FakeElement('div') : undefined
        const canvas = new FakeElement('canvas')
        containerEl?.appendChild(canvas)
        const objectManager = new EventTarget() as any
        objectManager.getObjects = () => [sun, bulb, cam, mesh]
        objectManager.addEventListener = () => undefined
        objectManager.removeEventListener = () => undefined
        const viewer = Object.assign(new EventTarget(), {
            container: containerEl,
            canvas,
            scene: {modelRoot, mainCamera: camera, addObject: (o: Object3D) => sceneRoot.add(o)},
            object3dManager: objectManager,
            getPlugin: (p: string) => p === 'PickingPlugin' ? picking : undefined,
            setDirty: vi.fn(),
            console,
        }) as any
        const plugin = new tp.Object3DWidgetsPlugin()
        plugin.onAdded(viewer)
        const render = () => {
            sceneRoot.updateMatrixWorld(true)
            ;(plugin as any)._onViewerEvent({type: 'postRender', eType: 'postRender'})
        }
        const widgetOf = (o: Object3D) => plugin.widgets.find(w => w.object === o) as InstanceType<typeof tp.AHelperWidget>
        const iconOf = (o: Object3D) => plugin.iconOverlay?.getIconElement(widgetOf(o)) as FakeElement | undefined
        render()
        return {plugin, viewer, container: containerEl, camera, sun, bulb, cam, render, widgetOf, iconOf}
    }

    test('DOM by default: an SVG for each light and camera in a layer of the container, and no sprites', () => {
        const {plugin, container, sun, bulb, cam, widgetOf, iconOf} = setup()
        expect(plugin.iconMode).toBe('dom')
        const layer = plugin.iconOverlay!.element as any as FakeElement
        expect(layer.parent).toBe(container)
        expect(layer.className).toBe('widget-icons-layer')
        expect(layer.children).toHaveLength(3)
        for (const o of [sun, bulb, cam]) {
            const w = widgetOf(o)
            expect(w.iconMode).toBe('dom')
            expect(w.icon).toBeUndefined()
            const el = iconOf(o)!
            expect(el.hidden).toBe(false)
            expect(el.innerHTML).toBe(tp.getWidgetIconSvg(w.kind!))
            expect(el.style.width).toBe('28px')
            expect(el.style.transform).toMatch(/^translate\([-\d.]+px, [-\d.]+px\)$/)
        }
        expect(iconOf(bulb)!.style.color).toBe('#ff0000') // the dot in the light colour
        const labels = (plugin.uiConfig.children as any[]).map(c => c.label)
        expect(labels).toContain('Icon mode')
        const dropdown = (plugin.uiConfig.children as any[]).find(c => c.label === 'Icon mode')
        expect(dropdown.type).toBe('dropdown')
        expect(dropdown.children.map((c: any) => c.value)).toEqual(['dom', 'sprite'])
    })

    test('switching the mode at runtime swaps the DOM icons and the sprites, and leaves nothing behind', () => {
        const {plugin, container, sun, bulb, render, widgetOf, iconOf} = setup()
        const layer = plugin.iconOverlay!.element as any as FakeElement
        const sheets = () => container!.children.filter(c => c.tagName === 'style')
        expect(sheets()).toHaveLength(1)

        plugin.iconMode = 'sprite'
        render()
        expect(plugin.iconOverlay).toBeUndefined()
        expect(layer.parent).toBeNull()
        expect(layer.children).toHaveLength(0)
        expect(sheets()).toHaveLength(0)
        expect(container!.children).toHaveLength(1) // the canvas
        for (const o of [sun, bulb]) {
            const w = widgetOf(o)
            expect(w.iconMode).toBe('sprite')
            expect(w.icon).toBeInstanceOf(tp.WidgetIcon)
            expect(w.icon!.parent).toBe(w)
        }
        const sprite = widgetOf(sun).icon!
        const dispose = vi.spyOn(sprite, 'dispose')

        plugin.iconMode = 'dom'
        render()
        expect(dispose).toHaveBeenCalled()
        expect(sprite.parent).toBeNull()
        expect(widgetOf(sun).icon).toBeUndefined()
        expect(iconOf(sun)!.parent).toBe(plugin.iconOverlay!.element)
        expect(sheets()).toHaveLength(1)
    })

    test('a click or tap on a DOM icon selects the object with the PickingPlugin; with shift it toggles it', () => {
        const picking = {isDisabled: () => false, multiSelectEnabled: true, setSelectedObject: vi.fn(), toggleSelectedObject: vi.fn()}
        const {sun, cam, iconOf} = setup({picking})
        iconOf(sun)!.dispatchEvent({type: 'click', shiftKey: false})
        expect(picking.setSelectedObject).toHaveBeenCalledWith(sun)
        iconOf(cam)!.dispatchEvent({type: 'click', shiftKey: true})
        expect(picking.toggleSelectedObject).toHaveBeenCalledWith(cam)
        picking.isDisabled = () => true
        iconOf(sun)!.dispatchEvent({type: 'click'})
        expect(picking.setSelectedObject).toHaveBeenCalledTimes(1)
    })

    test('icons behind the camera are hidden, icons at the edge are shown, the nearer icon is on top', () => {
        const {camera, sun, bulb, render, iconOf} = setup()
        expect(Number(iconOf(bulb)!.style.zIndex)).toBeGreaterThan(Number(iconOf(sun)!.style.zIndex))
        camera.position.set(0, 0, -1) // between the camera (z -4) and the lights, looking at them: the camera is behind
        camera.lookAt(0, 0, 10)
        camera.updateMatrixWorld(true)
        render()
        // looking at +z, now the sun (z 0) is behind the bulb (z 3)
        expect(Number(iconOf(sun)!.style.zIndex)).toBeGreaterThan(Number(iconOf(bulb)!.style.zIndex))
        camera.lookAt(0, 0, -10)
        camera.updateMatrixWorld(true)
        render()
        expect(iconOf(sun)!.hidden).toBe(true)
        expect(iconOf(bulb)!.hidden).toBe(true)
        // the centre just out of the left edge: the right half of the icon is still on screen
        camera.position.set(0, 0, 10)
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld(true)
        const halfWidth = Math.tan(camera.fov / 2 * Math.PI / 180) * 10 * camera.aspect
        sun.position.set(-halfWidth - 0.05, 0, 0)
        sun.updateMatrixWorld()
        render()
        expect(iconOf(sun)!.hidden).toBe(false)
        sun.position.set(-halfWidth - 3, 0, 0)
        sun.updateMatrixWorld()
        render()
        expect(iconOf(sun)!.hidden).toBe(true)
    })

    test('showIcons, iconSize and the visibility of the widgets work the same in DOM mode', () => {
        const {plugin, sun, render, iconOf} = setup()
        plugin.iconSize = 44
        render()
        expect(iconOf(sun)!.style.width).toBe('56px')
        plugin.enabled = false // hides the widgets
        render()
        expect(iconOf(sun)!.hidden).toBe(true)
        plugin.enabled = true
        render()
        expect(iconOf(sun)!.hidden).toBe(false)
        plugin.showIcons = false
        render()
        expect(iconOf(sun)).toBeUndefined()
        expect(plugin.iconOverlay!.element.children).toHaveLength(0)
    })

    test('removing the plugin leaves no DOM', () => {
        const {plugin, viewer, container} = setup()
        plugin.onRemove(viewer)
        expect(container!.children).toHaveLength(1) // the canvas
        expect(plugin.iconOverlay).toBeUndefined()
    })

    test('without a container the icons are sprites', () => {
        const {plugin, sun, widgetOf} = setup({container: false})
        expect(plugin.iconMode).toBe('dom')
        expect(plugin.iconOverlay).toBeUndefined()
        expect(widgetOf(sun).iconMode).toBe('sprite')
        expect(widgetOf(sun).icon).toBeInstanceOf(tp.WidgetIcon)
    })
})
