/**
 * Blender's demo files (https://www.blender.org/download/demo-files/) for the .blend examples, and helpers to show a
 * scene the way it was set up in Blender. No imports: the plain three.js example uses this file too.
 *
 * download.blender.org sends no CORS headers, so the files are copies on files.threepipe.org, re-saved with zstd
 * compression (Blender's own format since 3.0, read by the importer) and otherwise unchanged. Each entry links to its
 * original download.
 */

export interface BlenderDemoFile {
    /** Short id, used in `?file=` */
    id: string
    label: string
    url: string
    /** Download size */
    size: string
    /** The Blender version the file was saved with */
    blender: string
    author?: string
    license?: string
    /** The file's page or download on download.blender.org */
    source: string
}

const BASE = 'https://files.threepipe.org/p/blender-demo-files/'
const DEMO = 'https://download.blender.org/demo/'

export const blenderDemoFiles: BlenderDemoFile[] = [
    {id: 'barcelona-pavilion', label: 'Barcelona Pavilion', url: BASE + 'barcelona-pavilion.blend', size: '6 MB', blender: '2.66', source: DEMO + 'test/pabellon_barcelona_v1.scene_.zip'},
    {id: 'wasp-bot', label: 'Wasp Bot', url: BASE + 'wasp-bot.blend', size: '54 MB', blender: '2.80', author: 'Emiliano Colantoni', license: 'CC BY 4.0', source: DEMO + 'eevee/wasp_bot/'},
    {id: 'mr-elephant', label: 'Mr Elephant', url: BASE + 'mr-elephant.blend', size: '60 MB', blender: '2.93', author: 'Glenn Melenhorst', license: 'CC BY-ND', source: DEMO + 'eevee/mr_elephant/'},
    {id: 'race-spaceship', label: 'Race Spaceship', url: BASE + 'race-spaceship.blend', size: '15 MB', blender: '2.80', author: 'Alessandro Chiffi / ONdata Studio', license: 'CC BY', source: DEMO + 'eevee/race_spaceship/'},
    {id: 'forest-tree', label: 'Ember Forest tree', url: BASE + 'forest-tree.blend', size: '64 MB', blender: '2.80', author: 'Mike Pan', license: 'CC BY', source: DEMO + 'eevee/ember_forest/'},
    {id: 'splash-3-5', label: 'Blender 3.5 splash', url: BASE + 'blender-3.5-splash.blend', size: '5 MB', blender: '3.5', source: DEMO + 'splash/blender-3.5-splash.blend'},
    {id: 'atv-buggy', label: 'ATV Buggy', url: BASE + 'atv-buggy.blend', size: '0.2 MB', blender: '2.66', source: DEMO + 'test/AtvBuggy.zip'},
]

/**
 * Mr Elephant exactly as Blender published it (Blender 2.93, gzip, 66 MB; the `mr-elephant` above is the same
 * scene re-saved with zstd). Big enough to watch a load: the preview example uses it.
 */
export const mrElephantOriginal: BlenderDemoFile = {
    ...blenderDemoFiles.find(f => f.id === 'mr-elephant')!,
    id: 'mr-elephant-original', label: 'Mr Elephant (original file)', url: BASE + 'mr-elephant-2.93-original.blend', size: '66 MB',
}

/** The demo file in `?file=<id>`, else the one with `fallbackId`. */
export function demoFileFromQuery(fallbackId = blenderDemoFiles[0].id): BlenderDemoFile {
    const id = new URLSearchParams(location.search).get('file')
    return blenderDemoFiles.find(f => f.id === id) ?? blenderDemoFiles.find(f => f.id === fallbackId) ?? blenderDemoFiles[0]
}

/** A credit line for a demo file: its name, author and license, and a link to the original download. */
export function creditLine(file: BlenderDemoFile): HTMLElement {
    const p = document.createElement('p')
    p.className = 'blender-demo-credit'
    const by = [file.author && `by ${file.author}`, file.license].filter(Boolean).join(', ')
    p.append(`${file.label}${by ? ' ' + by : ''}. Blender ${file.blender} demo file, ${file.size}. `)
    const a = document.createElement('a')
    a.href = file.source
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = 'Source'
    p.append(a)
    return p
}

/** The parts of a parsed .blend this file reads (the `blend` passed to `onBlendLoad`, or BlendLoader's result). */
interface ParsedBlend {
    objects: Record<string, any[] | undefined>
}

/**
 * The name of the camera Blender renders the file's active scene with, if it has one. The active scene is the one
 * open when the file was saved (`FileGlobal.curscene`); a file can hold several.
 */
export function sceneCameraName(blend: ParsedBlend): string | undefined {
    const scenes = blend.objects.Scene ?? []
    const current = blend.objects.FileGlobal?.[0]?.curscene
    const scene = scenes.includes(current) ? current : scenes.find(s => s.camera) ?? scenes[0]
    return scene?.camera?.aname
}

/** Duck types of the three.js classes used below, so this works with threepipe's and with plain three.js. */
interface Vec3 {
    x: number, y: number, z: number
    set(x: number, y: number, z: number): Vec3
    copy(v: Vec3): Vec3
    clone(): Vec3
    sub(v: Vec3): Vec3
    dot(v: Vec3): number
    addScaledVector(v: Vec3, s: number): Vec3
    setFromMatrixPosition(m: any): Vec3
    transformDirection(m: any): Vec3
}
interface Obj3D {
    aspect?: number
    left?: number
    right?: number
    name: string
    position: Vec3
    matrixWorld: any
    updateWorldMatrix(parents: boolean, children: boolean): void
    getObjectByName(name: string): Obj3D | undefined
    isPerspectiveCamera?: boolean
    isOrthographicCamera?: boolean
    fov?: number
    top?: number
    bottom?: number
    zoom?: number
}

/** Where to put a perspective camera and what to orbit around to see what a Blender camera sees. */
export interface CameraView {
    position: Vec3
    target: Vec3
    /** Vertical field of view, degrees, for the render's shape (`aspect`) */
    fov: number
    /** Width / height of Blender's render */
    aspect: number
}

/**
 * The vertical field of view that shows at least what Blender's render shows, in a viewport of `aspect` (width /
 * height): the same as the render's when the viewport is as wide or wider, wider when it is narrower.
 */
export function fitFov(view: CameraView, aspect: number): number {
    if (aspect >= view.aspect) return view.fov
    const half = Math.atan(Math.tan(view.fov * Math.PI / 360) * view.aspect / aspect)
    return Math.min(2 * half * 180 / Math.PI, 120)
}

/**
 * The view of the Blender camera `cameraName` in `root` (the imported scene), for a perspective camera with orbit
 * controls: the same position and direction, the same field of view, and an orbit target in front of it at the
 * distance of `center` (the middle of the scene). An orthographic Blender camera becomes a perspective one with
 * `fallbackFov`, far enough back to show the same height.
 */
export function blenderCameraView(root: Obj3D, cameraName: string | undefined, center: Vec3, fallbackFov = 40): CameraView | undefined {
    const camera = cameraName ? root.getObjectByName(cameraName) : undefined
    if (!camera) return undefined
    camera.updateWorldMatrix(true, false)
    const position = root.position.clone().setFromMatrixPosition(camera.matrixWorld)
    // cameras look down their local -Z
    const direction = root.position.clone().set(0, 0, -1).transformDirection(camera.matrixWorld)
    const ahead = Math.max(center.clone().sub(position).dot(direction), 0.1)
    if (camera.isOrthographicCamera && camera.top !== undefined && camera.bottom !== undefined) {
        const height = (camera.top - camera.bottom) / (camera.zoom || 1)
        const width = camera.right !== undefined && camera.left !== undefined ? (camera.right - camera.left) / (camera.zoom || 1) : height
        const distance = height / 2 / Math.tan(fallbackFov * Math.PI / 360)
        const target = position.clone().addScaledVector(direction, ahead)
        return {position: target.clone().addScaledVector(direction, -distance), target, fov: fallbackFov, aspect: width / height}
    }
    return {position, target: position.clone().addScaledVector(direction, ahead), fov: camera.fov || fallbackFov, aspect: camera.aspect || 1.5}
}
