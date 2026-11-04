/**
 * The icons and colours of the light and camera widgets (Object3DWidgetsPlugin): one colour and icon per kind from
 * `widgetKinds`, a camera-facing quad that keeps its pixel size and is drawn on top, not in the depth passes (only its
 * GBuffer flags), picked as the widget's object, and the optional frustum of the shadow camera.
 * No WebGL: the icon textures are drawn on a fake 2D canvas that records the colours, and the pixel size is checked
 * with the raycast of the icon at pixel offsets from the icon centre. The DOM icons (`iconMode: 'dom'`) are checked on
 * fake elements that keep their children, styles and listeners.
 */
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {
    Color,
    DirectionalLight,
    EventDispatcher,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    PointLight,
    Raycaster,
    SpotLight,
    Vector2,
    Vector3,
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
        FakeElement.rectReads++
        return {left: 0, top: 0, width: W, height: H}
    }
    static rectReads = 0
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
            // the lines of a light in the light colour (as before the icons), of a camera in the kind colour
            const expected = (object as any).isLight ? (object as DirectionalLight).color.getHex() : new Color(style.color).getHex()
            expect(lineColor.getHex()).toBe(expected)
        }
    })

    test('the colour override of the lines still works', () => {
        const l = light(new DirectionalLight())
        const w = new tp.DirectionalLightHelper2(l, undefined, 0x123456)
        expect(w.hMaterial.color.getHex()).toBe(new Color(0x123456).getHex())
    })

    test('the lines follow the light colour, and a colour set at runtime redraws them', () => {
        const l = light(new PointLight(0xff0000))
        const w = new tp.PointLightHelper2(l)
        expect(w.hMaterial.color.getHex()).toBe(0xff0000)
        l.color.set(0x00ff00)
        w.update()
        expect(w.hMaterial.color.getHex()).toBe(0x00ff00)
        w.color = 0x123456 // no update() call
        expect(w.hMaterial.color.getHex()).toBe(new Color(0x123456).getHex())
        const c = new tp.CameraHelper2(light(new PerspectiveCamera()))
        c.color = 0x00ffff
        expect(new Color().fromArray(c.line.geometry.getAttribute('instanceColorStart').array as any, 0).getHex()).toBe(0x00ffff)
    })

    test('dispose removes the icon and the shadow frustum and clears them', () => {
        const l = light(new DirectionalLight())
        l.castShadow = true
        const w = new tp.DirectionalLightHelper2(l)
        w.showShadowFrustum = true
        const icon = w.icon!, helper = w.shadowHelper!
        expect(icon.parent).toBe(w)
        expect(helper.parent).toBe(w)
        w.dispose()
        expect(w.icon).toBeUndefined()
        expect(w.shadowHelper).toBeUndefined()
        expect(icon.parent).toBeNull()
        expect(helper.parent).toBeNull()
    })

    test('the plugin sets the options of a widget with one update', () => {
        const plugin = new tp.Object3DWidgetsPlugin()
        const l = light(new SpotLight())
        const w = new tp.SpotLightHelper2(l)
        const update = vi.spyOn(w, 'update')
        plugin.showIcons = false
        plugin.iconSize = 30
        plugin.showShadowFrustum = true
        update.mockClear()
        ;(plugin as any)._applyOptions(w) // all four differ from the widget
        expect(update).toHaveBeenCalledTimes(1)
        expect([w.showIcon, w.iconSize, w.iconMode, w.showShadowFrustum]).toEqual([false, 30, 'sprite', true])
        update.mockClear()
        ;(plugin as any)._applyOptions(w) // nothing changes
        expect(update).toHaveBeenCalledTimes(0)
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
        for (const [o, m] of [[icon, icon.material], [icon.dot, icon.dot.material]] as const) {
            expect(m.depthTest).toBe(false)
            expect(m.depthWrite).toBe(false)
            expect(m.toneMapped).toBe(false)
            expect(m.userData.renderToGBuffer).toBe(false)
            expect(m.userData.renderToDepth).toBe(false)
            // only the GBuffer flags (not tone mapped), with its own GBuffer material: the material keeps allowOverride
            // false, so the debug views of ViewOverridesPlugin do not draw it as a square
            expect(m.userData.renderToFlags).toBe(true)
            expect(m.allowOverride).toBe(false)
            expect((o as any).customGBufferMaterial).toBeInstanceOf(tp.GBufferMaterial)
            // not blended: the GBuffer pass draws it as transparent, and blended flags mix with the ones under them
            expect((o as any).customGBufferMaterial.blending).toBe(tp.NoBlending)
            // premultiplied textures, blended once: not multiplied by the alpha again in the shader
            expect(m.map!.premultiplyAlpha).toBe(true)
            expect(m.premultipliedAlpha).toBe(false)
            expect([m.blending, m.blendSrc, m.blendDst]).toEqual([tp.CustomBlending, tp.OneFactor, tp.OneMinusSrcAlphaFactor])
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
        parent.updateMatrixWorld(true) // the light's world matrix gets the transform of its parent
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

    test('faces a camera at any angle, also under a rotated parent, at the same pixel size', () => {
        const parent = new Object3D()
        parent.rotation.set(0.4, -1.1, 0.3)
        const l = light(new PointLight(), parent)
        parent.updateMatrixWorld(true) // the light's world matrix gets the transform of its parent
        const w = new tp.PointLightHelper2(l)
        w.updateMatrixWorld(true)
        const icon = w.icon!
        const half = icon.size * tp.widgetIconLayout.box / tp.widgetIconLayout.diameter / 2
        const camera = new PerspectiveCamera(45, 1, 0.1, 1000)
        camera.position.set(6, 4, 9)
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld(true)
        icon.updateScale(camera, H)
        const q = icon.getWorldQuaternion(new tp.Quaternion())
        expect(q.angleTo(camera.quaternion)).toBeLessThan(1e-5)
        expect(hitsAt(icon, camera, half - 1)).toBe(true)
        expect(hitsAt(icon, camera, half + 1)).toBe(false)
    })

    test('keeps its pixel size under a non-uniform scale of the parent, with a rolled camera', () => {
        const parent = new Object3D()
        parent.scale.set(2, 1, 1)
        const l = light(new PointLight(), parent)
        parent.updateMatrixWorld(true) // the light's world matrix gets the scale of its parent
        const w = new tp.PointLightHelper2(l)
        w.updateMatrixWorld(true)
        expect(w.matrixWorld.getMaxScaleOnAxis()).toBe(2)
        const icon = w.icon!
        const half = icon.size * tp.widgetIconLayout.box / tp.widgetIconLayout.diameter / 2
        const camera = new PerspectiveCamera(45, 1, 0.1, 1000)
        camera.position.set(0, 0, 10)
        camera.up.set(1, 0, 0) // rolled 90 degrees: the screen up is the scaled axis of the parent
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld(true)
        icon.updateScale(camera, H)
        expect(hitsAt(icon, camera, half - 1)).toBe(true)
        expect(hitsAt(icon, camera, half + 1)).toBe(false)
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
        picking._viewer = {setDirty: () => undefined}
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
        // in the colour of the lines of the light (the light colour), where the shadow camera is
        const c = new Color().fromArray(helper.line.geometry.getAttribute('instanceColorStart').array as any, 0)
        expect(c.getHex()).toBe(l.color.getHex())
        w.updateMatrixWorld(true)
        expect(helper.matrixWorld.equals(l.shadow.camera.matrixWorld)).toBe(true)

        w.showShadowFrustum = false
        expect(w.shadowHelper).toBeUndefined()
        expect(helper.parent).toBeNull()
    })

    test('the shadow frustum lines are not picked: a click on one selects nothing, and a model behind it gets the hit', () => {
        const scene = new tp.Group2()
        const modelRoot = new tp.Group2()
        scene.add(modelRoot)
        const l = light(new DirectionalLight()) // the widget maps a hit to the light, wherever the light is
        l.position.set(0, 0, 2)
        l.castShadow = true
        l.shadow.camera.far = 10
        l.shadow.camera.updateProjectionMatrix()
        l.updateMatrixWorld(true)
        const widgetRoot = new tp.Group2()
        widgetRoot.userData.isWidgetRoot = true
        scene.add(widgetRoot)
        const w = new tp.DirectionalLightHelper2(l)
        w.showShadowFrustum = true
        w.showIcon = false // only the lines
        widgetRoot.add(w)
        scene.updateMatrixWorld(true)
        const helper = w.shadowHelper!
        // the line width is in pixels of the canvas, as the renderer sets it
        w.traverse(o => (o as any).material?.resolution?.set(H, H))
        // a far corner of the shadow camera frustum, where its lines meet, away from the other lines of the light
        const corner = new Vector3(1, 1, 1).unproject(l.shadow.camera as any)
        const camera = new PerspectiveCamera(45, 1, 0.1, 1000)
        camera.position.copy(corner).add(new Vector3(0.3, 0.2, 20))
        camera.lookAt(corner)
        camera.updateMatrixWorld(true)
        const wall = new Mesh(new tp.PlaneGeometry(1000, 1000), new MeshBasicMaterial())
        wall.position.z = corner.z - 50
        wall.lookAt(camera.position)
        modelRoot.add(wall)
        scene.updateMatrixWorld(true)

        const picker = new tp.ObjectPicker(modelRoot as any, new FakeElement('canvas') as any, camera as any, tp.isPickable)
        picker.extraObjects.push(widgetRoot as any)
        picker.mouse.set(0, 0) // the centre of the view, on the corner
        const hit = picker.checkIntersection()
        // compare names: a failing toBe would print the whole scene
        wall.name = 'Wall'
        expect(hit?.selectedObject?.name).toBe('Wall')
        // the lines of the frustum are hit by the ray, but none of the picked hits is the light or its widget
        expect(hit!.intersects.some(i => i.object === w || i.object === (l as any))).toBe(false)
        expect(helper.line.userData.userSelectable).toBeUndefined() // nothing special on the lines: the flag of the helper
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
        const labels = (plugin.uiConfig.children as any[]).map(ch => ch.label)
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

    test('a hidden icon (showIcon off) takes no hits, so a click there does not select the object', () => {
        const w = new tp.PointLightHelper2(light(new PointLight()))
        w.updateMatrixWorld(true)
        const camera = new PerspectiveCamera(45, 1, 0.1, 100)
        camera.position.set(0, 0, 10)
        camera.updateMatrixWorld(true)
        w.icon!.updateScale(camera, H)
        const raycaster = new Raycaster()
        raycaster.setFromCamera(new Vector2(0, 0), camera)
        const root = new tp.Group2()
        root.add(w)
        root.updateMatrixWorld(true)
        const picker = new tp.ObjectPicker(new tp.Group2() as any, new FakeElement('canvas') as any, camera as any, tp.isPickable)
        expect(picker.selectableFor(w.icon as any)).toBe(w.icon)
        w.showIcon = false
        // a hit on the hidden icon does not go up to the widget (and select the light)
        expect(picker.selectableFor(w.icon as any)).toBeNull()
    })

    test('a part of a widget with userSelectable false is not picked, and its hit does not go up to the widget', () => {
        const w = new tp.PointLightHelper2(light(new PointLight()))
        const root = new tp.Group2()
        root.add(w)
        const picker = new tp.ObjectPicker(new tp.Group2() as any, new FakeElement('canvas') as any, new PerspectiveCamera() as any, tp.isPickable)
        expect(tp.isPickable(w.lightSphere as any)).toBe(true)
        w.lightSphere.userData.userSelectable = false
        expect(tp.isPickable(w.lightSphere as any)).toBe(false)
        expect(picker.selectableFor(w.lightSphere as any)).toBeNull()
        // the widget itself (a DOM icon) is still picked
        expect(picker.selectableFor(w as any)).toBe(w)
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
            scene: {modelRoot, mainCamera: camera, renderCamera: camera, addObject: (o: Object3D) => sceneRoot.add(o)},
            renderManager: new EventDispatcher(),
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
        /** A change in the viewer (an update event, as a setDirty sends), then a render */
        const changed = () => {
            ;(plugin as any)._onViewerEvent({type: 'update', eType: 'update'})
            render()
        }
        const widgetOf = (o: Object3D) => plugin.widgets.find(w => w.object === o) as InstanceType<typeof tp.AHelperWidget>
        const iconOf = (o: Object3D) => plugin.iconOverlay?.getIconElement(widgetOf(o)) as FakeElement | undefined
        render()
        return {plugin, viewer, container: containerEl, camera, sun, bulb, cam, render, changed, widgetOf, iconOf}
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

    /** A PickingPlugin with its picker (selection condition isPickable) and its hitObject handler, without a viewer */
    function realPicking() {
        const picking = new tp.PickingPlugin() as any
        picking._viewer = {setDirty: () => undefined}
        return picking
    }
    function withPicker(picking: any, s: ReturnType<typeof setup>) {
        const picker = new tp.ObjectPicker(s.viewer.scene.modelRoot, new FakeElement('canvas') as any, s.camera as any, tp.isPickable)
        picker.addEventListener('hitObject', picking._onObjectHit)
        picking._picker = picker
        ;(s.plugin as any)._onViewerEvent({type: 'addPlugin', eType: 'addPlugin'})
        s.render()
        return s
    }
    const selected = (picking: any) => picking.getSelectedObjects().map((o: any) => o.name || o.type)

    test('a click or tap on a DOM icon selects the object as a click on the sprite does; with shift it toggles it', () => {
        const picking = realPicking()
        const s = withPicker(picking, setup({picking}))
        const {sun, cam, iconOf, widgetOf} = s
        sun.name = 'Sun'
        cam.name = 'Cam'
        const hits: any[] = []
        picking.addEventListener('hitObject', (e: any) => hits.push({...e.intersects}))
        expect(iconOf(sun)!.className).toBe('widget-icon') // the pointer cursor
        iconOf(sun)!.dispatchEvent({type: 'click', shiftKey: false})
        expect(selected(picking)).toEqual(['Sun'])
        // the hitObject event of the PickingPlugin, as for a sprite: the object and its widget
        expect(hits[0].selectedObject === sun && hits[0].selectedWidget === widgetOf(sun)).toBe(true)
        picking.multiSelectEnabled = true
        iconOf(cam)!.dispatchEvent({type: 'click', shiftKey: true})
        expect(selected(picking)).toEqual(['Cam', 'Sun'])
        iconOf(cam)!.dispatchEvent({type: 'click', shiftKey: true})
        expect(selected(picking)).toEqual(['Sun'])
        // a hitObject listener can consume the click, as for a sprite
        const consume = (e: any) => e.intersects.consumed = true
        picking.addEventListener('hitObject', consume)
        iconOf(cam)!.dispatchEvent({type: 'click'})
        expect(selected(picking)).toEqual(['Sun'])
        picking.removeEventListener('hitObject', consume)
        // the picking mode applies: a light has no geometry
        picking.picker.pickingMode = 'geometry'
        iconOf(cam)!.dispatchEvent({type: 'click'})
        expect(selected(picking)).toEqual([])
        picking.picker.pickingMode = 'auto'
        picking.enabled = false // its setDirty sends an update event
        s.changed()
        expect(iconOf(sun)!.className).toContain('widget-icon-static')
        iconOf(sun)!.dispatchEvent({type: 'click'})
        expect(selected(picking)).toEqual([])
    })

    test('DOM icons: a long press or a drag is not a click, as on the canvas; the pointer on an icon hovers the object', () => {
        const picking = realPicking()
        const {sun, iconOf} = withPicker(picking, setup({picking}))
        sun.name = 'Sun'
        const el = iconOf(sun)!
        let t = 1000
        const time = vi.spyOn(performance, 'now').mockImplementation(() => t)
        try {
            el.dispatchEvent({type: 'pointerdown', isPrimary: true, clientX: 100, clientY: 100})
            t += tp.ObjectPicker.PointerClickMaxTime + 50
            el.dispatchEvent({type: 'click', clientX: 100, clientY: 100})
            expect(selected(picking)).toEqual([])
            el.dispatchEvent({type: 'pointerdown', isPrimary: true, clientX: 100, clientY: 100})
            el.dispatchEvent({type: 'click', clientX: 100 + W * tp.ObjectPicker.PointerClickMaxDistance, clientY: 100})
            expect(selected(picking)).toEqual([])
            el.dispatchEvent({type: 'pointerdown', isPrimary: true, clientX: 100, clientY: 100})
            t += 50
            el.dispatchEvent({type: 'click', clientX: 101, clientY: 100})
            expect(selected(picking)).toEqual(['Sun'])
        } finally {
            time.mockRestore()
        }
        // hover, when the picker hovers
        expect(picking.picker.hoverObject).toBeFalsy()
        el.dispatchEvent({type: 'pointerenter'})
        expect(picking.picker.hoverObject).toBeFalsy() // hover is off
        picking.picker.hoverEnabled = true
        el.dispatchEvent({type: 'pointerenter'})
        expect(picking.picker.hoverObject?.name).toBe('Sun')
        el.dispatchEvent({type: 'pointerleave'})
        expect(picking.picker.hoverObject).toBeFalsy()
    })

    test('a DOM icon click passes the same check as a picker hit: userSelectable, bboxVisible and the selection condition', () => {
        const picking = realPicking()
        const {sun, bulb, cam, changed, widgetOf, iconOf} = withPicker(picking, setup({picking}))
        sun.name = 'Sun'
        widgetOf(sun).userData.userSelectable = false
        widgetOf(bulb).userData.bboxVisible = false
        changed()
        for (const o of [sun, bulb]) {
            iconOf(o)!.dispatchEvent({type: 'click'})
            expect(iconOf(o)!.className).toContain('widget-icon-static') // no pointer cursor
        }
        expect(selected(picking)).toEqual([])
        // a custom condition of the picker: the camera cannot be selected either
        picking.picker.selectionCondition = (o: any) => tp.isPickable(o) && o !== widgetOf(cam)
        changed()
        iconOf(cam)!.dispatchEvent({type: 'click'})
        expect(selected(picking)).toEqual([])
        expect(iconOf(cam)!.className).toContain('widget-icon-static')
        // the same widgets as sprites: a hit on the icon does not select them either
        for (const o of [sun, bulb, cam]) expect(picking.picker.selectableFor(widgetOf(o))).toBeNull()
        widgetOf(sun).userData.userSelectable = undefined
        changed()
        expect(iconOf(sun)!.className).toBe('widget-icon')
        iconOf(sun)!.dispatchEvent({type: 'click'})
        expect(selected(picking)).toEqual(['Sun'])
    })

    test('the DOM icons follow the camera of the render, read the layout only on a resize, and check the picking only on a change', () => {
        const picking = realPicking()
        const s = withPicker(picking, setup({picking}))
        const {plugin, viewer, sun, render, iconOf} = s
        const before = iconOf(sun)!.style.transform
        const other = new PerspectiveCamera(45, W / H, 0.1, 100)
        other.position.set(5, 0, 10)
        other.lookAt(0, 0, 0)
        other.updateMatrixWorld(true)
        viewer.scene.renderCamera = other
        render()
        expect(iconOf(sun)!.style.transform).not.toBe(before)
        viewer.scene.renderCamera = s.camera
        // frames without a change: no layout reads, no picking checks
        const getPlugin = vi.spyOn(viewer, 'getPlugin')
        const reads = FakeElement.rectReads
        render()
        render()
        expect(FakeElement.rectReads).toBe(reads)
        expect(getPlugin).not.toHaveBeenCalled()
        viewer.renderManager.dispatchEvent({type: 'resize'})
        render()
        expect(FakeElement.rectReads).toBeGreaterThan(reads)
        ;(plugin as any)._onViewerEvent({type: 'update', eType: 'update'}) // a change in the viewer (picking enabled, selection, options)
        render()
        expect(getPlugin).toHaveBeenCalled()
    })

    test('a DOM icon that cannot be selected lets the pointer through to the canvas', () => {
        const css = readFileSync(new URL('../../src/three/widgets/WidgetIconOverlay.css', import.meta.url), 'utf8')
        expect(css).toMatch(/\.widget-icon-static\s*\{[^}]*pointer-events:\s*none/)
    })

    test('without the PickingPlugin the DOM icons have no pointer cursor', () => {
        const {sun, iconOf} = setup()
        expect(iconOf(sun)!.className).toContain('widget-icon-static')
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

    test('removing an object removes its DOM icon at once; removing the plugin leaves no DOM', () => {
        const {plugin, viewer, container, sun, iconOf} = setup()
        const el = iconOf(sun)!
        ;(plugin as any)._objectRemove({object: sun})
        expect(el.parent).toBeNull()
        expect(plugin.iconOverlay!.element.children).toHaveLength(2)
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
