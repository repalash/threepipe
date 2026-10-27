import {BoxGeometry, CatmullRomCurve3, ContactShadowGroundPlugin, CubicBezierCurve3, CylinderGeometry, GeometryGeneratorPlugin, Group2, IObject3D, LineMaterial2, Matrix4, Mesh, Object3DGeneratorPlugin, PhysicalMaterial, Quaternion, Raycaster, SphereGeometry, ThreeViewer, TorusGeometry, UndoManagerPlugin, Vector3} from 'threepipe'
import {AnnotationsPlugin, AnnotationView} from './AnnotationsPlugin'
import {SPLASH_ICONS, SplashSample} from './splash'

/** A small jewellery scene with nested groups, to try the selection rules on */
export function buildScene(viewer: ThreeViewer) {
    const gold = new PhysicalMaterial({name: 'Yellow Gold', color: '#e8c372', metalness: 1, roughness: 0.22})
    const white = new PhysicalMaterial({name: 'White Gold', color: '#dfe3e8', metalness: 1, roughness: 0.18})
    const gem = new PhysicalMaterial({name: 'Diamond', color: '#a9dcff', metalness: 0.2, roughness: 0.04})
    const ruby = new PhysicalMaterial({name: 'Ruby', color: '#d2304f', metalness: 0.2, roughness: 0.05})
    const pearl = new PhysicalMaterial({name: 'Pearl', color: '#f4efe6', metalness: 0, roughness: 0.32})
    const paper = new PhysicalMaterial({name: 'Gift Paper', color: '#e25c5c', metalness: 0, roughness: 0.6})
    const ribbon = new PhysicalMaterial({name: 'Ribbon', color: '#f2c94c', metalness: 0.1, roughness: 0.45})
    const leather = new PhysicalMaterial({name: 'Leather', color: '#5b4636', metalness: 0, roughness: 0.7})
    const plaster = new PhysicalMaterial({name: 'Plaster', color: '#fafafa', metalness: 0, roughness: 0.8})

    const mesh = (name: string, g: any, m: PhysicalMaterial, p: [number, number, number] = [0, 0, 0], r?: [number, number, number]) => {
        const o = new Mesh(g, m)
        o.name = name
        o.position.set(...p)
        if (r) o.rotation.set(...r)
        return o
    }
    const group = (name: string, p: [number, number, number], ...children: any[]) => {
        const g = new Group2()
        g.name = name
        g.position.set(...p)
        g.add(...children)
        return g
    }

    // Ring > Band, Head > (Gem > Crown, Pavilion), Prongs > Prong 1-4, Gallery
    const prongs = [0, 1, 2, 3].map(i => {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4
        return mesh(`Prong ${i + 1}`, new CylinderGeometry(0.035, 0.05, 0.62, 12), white, [Math.cos(a) * 0.33, 0.12, Math.sin(a) * 0.33], [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25])
    })
    const ring = group('Solitaire Ring', [0, 0, 0],
        mesh('Band', new TorusGeometry(1, 0.12, 32, 128), gold, [0, 1.12, 0]),
        group('Head', [0, 2.32, 0],
            group('Gem', [0, 0.2, 0],
                mesh('Crown', new CylinderGeometry(0.26, 0.4, 0.14, 16), gem, [0, 0.07, 0]),
                mesh('Pavilion', new CylinderGeometry(0.4, 0.01, 0.42, 16), gem, [0, -0.21, 0]),
            ),
            group('Prongs', [0, 0, 0], ...prongs),
            mesh('Gallery', new TorusGeometry(0.3, 0.04, 12, 48), white, [0, -0.08, 0], [Math.PI / 2, 0, 0]),
        ),
    )

    const stud = (name: string, x: number) => group(name, [x, 0, 0],
        mesh('Pearl', new SphereGeometry(0.36, 32, 16), pearl, [0, 0.62, 0]),
        mesh('Cup', new SphereGeometry(0.18, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), gold, [0, 0.36, 0]),
        mesh('Post', new CylinderGeometry(0.03, 0.03, 0.3, 8), gold, [0, 0.15, 0]),
    )
    const earrings = group('Pearl Earrings', [4, 0, 0.5], stud('Left Stud', -0.6), stud('Right Stud', 0.6))

    const drop = mesh('Drop', new SphereGeometry(0.45, 32, 16), ruby, [0, 0.62, 0])
    drop.scale.set(1, 1.35, 1)
    const pendant = group('Ruby Pendant', [-4, 0, 0.5],
        drop,
        mesh('Bail', new TorusGeometry(0.16, 0.04, 12, 32), gold, [0, 1.36, 0]),
        group('Chain', [0, 0, 0], ...Array.from({length: 6}, (_, i) =>
            mesh(`Link ${i + 1}`, new TorusGeometry(0.12, 0.025, 8, 24), gold, [0, 1.62 + i * 0.2, 0], [0, i % 2 ? Math.PI / 2 : 0, 0]))),
    )

    const gift = group('Gift Box', [0, 0, -4.5],
        mesh('Base', new BoxGeometry(2, 1.2, 2), paper, [0, 0.6, 0]),
        group('Lid', [0, 1.3, 0],
            mesh('Lid Top', new BoxGeometry(2.1, 0.22, 2.1), paper),
            mesh('Bow', new TorusGeometry(0.28, 0.07, 12, 32), ribbon, [0, 0.34, 0]),
        ),
        mesh('Ribbon X', new BoxGeometry(2.04, 1.25, 0.22), ribbon, [0, 0.62, 0]),
        mesh('Ribbon Z', new BoxGeometry(0.22, 1.25, 2.04), ribbon, [0, 0.62, 0]),
    )

    // like an imported glTF: Scene > root > Watch (wrappers are merged into one level)
    const watch = group('Scene', [4.5, 0, -4.5], group('root', [0, 0, 0], group('Watch', [0, 0, 0],
        mesh('Case', new CylinderGeometry(0.9, 0.9, 0.3, 48), white, [0, 0.25, 0]),
        mesh('Dial', new CylinderGeometry(0.8, 0.8, 0.02, 48), plaster, [0, 0.41, 0]),
        mesh('Crown', new CylinderGeometry(0.12, 0.12, 0.2, 16), white, [1.0, 0.25, 0], [0, 0, Math.PI / 2]),
        mesh('Strap', new BoxGeometry(0.9, 0.1, 3.6), leather, [0, 0.05, 0]),
    )))

    const stand = mesh('Display Stand', new CylinderGeometry(1.1, 1.3, 0.5, 48), plaster, [-4.5, 0.25, -4.5])

    for (const o of [ring, earrings, pendant, gift, watch, stand]) viewer.scene.addObject(o)
}

/**
 * Lights, a camera, shapes from the geometry generator and two curves, to try the selection UX on objects that are
 * not plain meshes. Uses Object3DGeneratorPlugin and GeometryGeneratorPlugin when the viewer has them.
 */
export function buildExtras(viewer: ThreeViewer) {
    const objGen = viewer.getPlugin(Object3DGeneratorPlugin)
    const geoGen = viewer.getPlugin(GeometryGeneratorPlugin)
    const group = (name: string, x: number, z: number) => {
        const g = new Group2()
        g.name = name
        g.position.set(x, 0, z)
        return g
    }
    if (objGen) {
        const make = (type: string, params: any, name: string) => {
            const o = objGen.generate(type, params, false, false, false)!
            o.name = name
            return o
        }
        const lights = group('Lights', 0, 0)
        lights.add(
            make('light-directional', {color: 0xfff1dd, intensity: 8, position: new Vector3(-5, 7, 4), target: new Vector3(0, 0, 0)}, 'Sun'),
            make('light-spot', {color: 0xffffff, intensity: 400, position: new Vector3(3.5, 5.5, 3), target: new Vector3(0, 1, 0)}, 'Key Spot'),
            make('light-point', {color: 0xffc58a, intensity: 4, position: new Vector3(-3, 2.5, -2)}, 'Warm Fill'),
        )
        const cams = group('Cameras', 0, 0)
        cams.add(make('camera-perspective', {position: new Vector3(5.5, 2.5, 7), target: new Vector3(0, 1, 0)}, 'Product Camera'))
        // shadows from the lights, so moving one moves its shadow on the ground
        const shadow = (name: string, size: number) => {
            const l = lights.getObjectByName(name) as IObject3D & {shadow: any}
            l.castShadow = true
            l.shadow.mapSize.set(size, size)
            l.shadow.bias = -0.0005
            l.shadow.normalBias = 0.02
            return l
        }
        const sun = shadow('Sun', 2048)
        // the sun's shadow box covers the whole scene, shapes and curves included
        Object.assign(sun.shadow.camera, {left: -13, right: 13, top: 13, bottom: -13, near: 0.5, far: 30})
        sun.shadow.camera.updateProjectionMatrix()
        shadow('Key Spot', 1024)
        shadow('Warm Fill', 512)
        // the lights, not the environment, make the shadows: keep the environment softer so they show
        viewer.scene.environmentIntensity = 0.5
        viewer.scene.addObject(lights)
        viewer.scene.addObject(cams)
    }
    if (geoGen) {
        const shapes = group('Generated Shapes', 8, 0)
        const mat = (c: string, name: string) => new PhysicalMaterial({name, color: c, metalness: 0.6, roughness: 0.3})
        const torus = geoGen.generateObject('torus', {radius: 0.7, tube: 0.2, radialSegments: 24, tubularSegments: 64, material: mat('#e8c372', 'Brushed Gold')})
        torus.name = 'Torus'
        torus.position.set(0, 0.9, -2.5)
        const box = geoGen.generateObject('box', {width: 1.2, height: 0.8, depth: 1.2, material: mat('#7aa7e8', 'Blue Metal')})
        box.name = 'Box'
        box.position.set(0, 0.4, 0)
        const cyl = geoGen.generateObject('cylinder', {radiusTop: 0.4, radiusBottom: 0.6, height: 1.4, material: mat('#c58ae8', 'Violet Metal')})
        cyl.name = 'Cylinder'
        cyl.position.set(0, 0.7, 2.5)
        shapes.add(torus, box, cyl)

        const curves = group('Curves', -8, 0)
        const spline = geoGen.generateObject('line', {curve: new CatmullRomCurve3([
            new Vector3(-1, 0.2, -2), new Vector3(0.5, 1.2, -1), new Vector3(-0.5, 0.6, 0.5), new Vector3(1, 1.5, 2),
        ]), segments: 120, material: new LineMaterial2({name: 'Spline Line', color: '#ff6b3d', linewidth: 4})})
        spline.name = 'Spline'
        const bezier = geoGen.generateObject('line', {curve: new CubicBezierCurve3(
            new Vector3(-1.5, 0.3, 3), new Vector3(-1, 2.5, 3), new Vector3(1, -1, 3), new Vector3(1.5, 1.2, 3),
        ), segments: 80, material: new LineMaterial2({name: 'Bezier Line', color: '#3d8bff', linewidth: 4})})
        bezier.name = 'Bezier'
        curves.add(spline, bezier)
        viewer.scene.addObject(shapes)
        viewer.scene.addObject(curves)
    }
    // a ground under everything (the shapes and curves stand at x = ±8), so every object has somewhere to cast its shadow
    const ground = viewer.getPlugin(ContactShadowGroundPlugin)
    if (ground) ground.size = 26
}

/** Two example annotations (when the plugin is there and the scene has none): a point on the surface seen from a view */
export function demoAnnotations(viewer: ThreeViewer) {
    const plugin = viewer.getPlugin(AnnotationsPlugin)
    if (!plugin || plugin.getAnnotations().length) return
    viewer.scene.modelRoot.updateMatrixWorld(true)
    const add = (from: Vector3, at: Vector3, title: string, text: string) => {
        // the view looks from `from` at `at`; the annotation goes where that line first meets a surface
        const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(from, at, new Vector3(0, 1, 0)))
        const view: AnnotationView = {position: from.toArray(), target: at.toArray(), quaternion: quaternion.toArray(), zoom: 1}
        const ray = new Raycaster(from, at.clone().sub(from).normalize())
        ray.camera = viewer.scene.mainCamera // fat lines (Line2) need it to raycast
        const hit = ray.intersectObject(viewer.scene.modelRoot, true).find(h => (h.object as any).isMesh && h.object.visible && h.face)
        if (!hit) return
        const obj = hit.object as any
        const localPoint = obj.worldToLocal(hit.point.clone())
        const localNormal = hit.face!.normal.clone()
        plugin.add(obj, localPoint, localNormal, view, {title, text})
    }
    add(new Vector3(2.2, 3.6, 4.2), new Vector3(0, 2.6, 0), 'Solitaire', '**Round brilliant**, 4-prong setting.\nClick the numbers to move between notes, or use ← →.')
    add(new Vector3(4.2, 3.2, -0.8), new Vector3(0, 1.2, -4.5), 'Gift box', 'Notes are saved inside the .glb with the camera view, like Sketchfab annotations.\n- Edit mode: + Annotate (N)\n- View mode: Tour')
    // the examples are not edits: keep them out of the undo history
    viewer.getPlugin(UndoManagerPlugin)?.undoManager?.reset()
}

/** The samples of the splash screen: this demo scene, models from samples.threepipe.org, an empty scene */
export function splashSamples(viewer: ThreeViewer): SplashSample[] {
    const reset = () => {
        // a new scene: its annotations and undo steps go with the old one
        const notes = viewer.getPlugin(AnnotationsPlugin)
        if (notes?.getAnnotations().length) notes.clear()
        viewer.scene.disposeSceneModels()
    }
    const done = () => viewer.getPlugin(UndoManagerPlugin)?.undoManager?.reset()
    const model = (label: string, icon: string, url: string): SplashSample => ({label, icon, load: async() => {
        reset()
        const obj = await viewer.load(url, {autoScale: true, autoCenter: true, autoScaleRadius: 2.5})
        if (!obj) throw new Error(`Could not load ${label}`) // the splash stays open and says so
        await viewer.fitToView(undefined, 1.2, 0)
        done()
    }})
    return [
        {label: 'Jewellery demo', icon: SPLASH_ICONS.ring, load: () => {
            if (viewer.scene.getObjectByName('Solitaire Ring')) return // already loaded
            reset()
            buildScene(viewer)
            buildExtras(viewer)
            demoAnnotations(viewer)
            done()
        }},
        model('Classic watch', SPLASH_ICONS.watch, 'https://samples.threepipe.org/demos/classic-watch.glb'),
        model('Damaged helmet', SPLASH_ICONS.helmet, 'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'),
        model('Horse', SPLASH_ICONS.horse, 'https://samples.threepipe.org/minimal/Horse.glb'),
        {label: 'Empty scene', icon: SPLASH_ICONS.empty, load: () => {
            reset()
            done()
        }},
    ]
}
