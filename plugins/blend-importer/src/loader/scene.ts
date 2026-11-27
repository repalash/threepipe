/**
 * The scenes of a parsed `.blend`: which one to import, and how Blender shows it (render shape, view transform).
 * A file can hold several scenes; Blender opens it on the one open when it was saved.
 */

/** The parts of a parsed `.blend` read here (the `blend` given to `onBlendLoad`, or BlendLoader's `blend`). */
interface ParsedBlend {
    objects: Record<string, any[] | undefined>
}

// The scene open when the file was saved (FileGlobal.curscene), else the first.
export function openScene(file: ParsedBlend): any {
    const scenes: any[] = file.objects.Scene ?? []
    const current = file.objects.FileGlobal?.[0]?.curscene
    return scenes.includes(current) ? current : scenes[0]
}

/**
 * The scene called `name`, else the one open when the file was saved. With `warn`, a name the file doesn't
 * have is reported, with the names it has.
 */
export function chosenScene(file: ParsedBlend, name?: string, warn = false): any {
    const open = openScene(file)
    if (!name) return open
    const scenes: any[] = file.objects.Scene ?? []
    const found = scenes.find(s => s.aname === name)
    if (!found && warn) console.warn(`BlendLoader - the file has no scene "${name}" (its scenes: ${scenes.map(s => `"${s.aname}"`).join(', ')}); importing "${open?.aname ?? ''}"`)
    return found ?? open
}

/** A scene of a `.blend`, from {@link blendScenes}. */
export interface BlendSceneInfo {
    /** The name Blender shows, to pass as the `scene` option */
    name: string
    /** Whether the file was saved with this scene open: the one imported by default */
    active: boolean
    /** The name of the scene shown behind this one (Blender's "Background Scene"), whose objects are imported with it */
    backgroundScene?: string
}

/** The scenes of a parsed `.blend`, in file order. */
export function blendScenes(file: ParsedBlend): BlendSceneInfo[] {
    const open = openScene(file)
    return (file.objects.Scene ?? []).map((s: any) => {
        const info: BlendSceneInfo = {name: s.aname ?? '', active: s === open}
        if (s.set?.aname) info.backgroundScene = s.set.aname
        return info
    })
}

// The scene and its background scenes (Scene.set, "Background Scene"), whose objects Blender shows with it.
export function withBackgroundScenes(scene: any): any[] {
    const scenes: any[] = []
    for (let s = scene; s && !scenes.includes(s) && scenes.length < 32; s = s.set) scenes.push(s)
    return scenes
}

/** Width / height of a scene's render (`RenderData` resolution x pixel aspect), which Blender fits its cameras to. */
export function sceneRenderAspect(scene: any): number | undefined {
    const r = scene?.r
    if (!r) return undefined
    const w = (r.xsch || 0) * (r.xasp || 1), h = (r.ysch || 0) * (r.yasp || 1)
    return w > 0 && h > 0 ? w / h : undefined
}

/**
 * How Blender turns a scene's render into the picture on screen (Render Properties > Color Management), and the
 * three.js tone mapping closest to it.
 */
export interface BlendViewSettings {
    /** Blender's view transform: `'Standard'`, `'Filmic'` (the default in 2.80 to 3.6), `'AgX'` (4.0 on), `'Khronos PBR Neutral'`... */
    viewTransform: string
    /** Blender's look, e.g. `'None'` or `'AgX - Punchy'`. Not reproduced. */
    look: string
    /** Exposure, in stops */
    exposure: number
    /** Gamma (1: none). Not reproduced. */
    gamma: number
    /**
     * The three.js tone mapping closest to the view transform, as the name of its constant:
     * `renderer.toneMapping = THREE[settings.toneMapping]`. Standard is `LinearToneMapping` (the image clipped,
     * as Blender does, and scaled by the exposure), AgX is `AgXToneMapping`, Khronos PBR Neutral
     * `NeutralToneMapping` (three r162+). three.js has no Filmic: `AgXToneMapping` is the nearest, a softer
     * film-like curve from the same author. Raw is `NoToneMapping`. Other transforms: `LinearToneMapping`.
     */
    toneMapping: 'NoToneMapping' | 'LinearToneMapping' | 'AgXToneMapping' | 'NeutralToneMapping'
    /** `renderer.toneMappingExposure` for the exposure: 2^exposure */
    toneMappingExposure: number
}

const TONE_MAPPINGS: Record<string, BlendViewSettings['toneMapping']> = {
    'Standard': 'LinearToneMapping',
    'Default': 'LinearToneMapping', // Standard before 2.80
    'Filmic': 'AgXToneMapping',
    'AgX': 'AgXToneMapping',
    'Khronos PBR Neutral': 'NeutralToneMapping',
    'Raw': 'NoToneMapping',
}

/**
 * The color management of the scene called `sceneName` (default: the one open when the file was saved), or
 * undefined if the file has no scene. Use it to show the model with the exposure and tone mapping it was made
 * with: the lights are imported in Blender's units (`lightUnits: 'blender'`), so with this the picture matches
 * Blender's.
 */
export function blendViewSettings(file: ParsedBlend, sceneName?: string): BlendViewSettings | undefined {
    const scene = chosenScene(file, sceneName)
    if (!scene) return undefined
    const v = scene.view_settings ?? {}
    const viewTransform = typeof v.view_transform === 'string' && v.view_transform ? v.view_transform : 'Standard'
    const exposure = typeof v.exposure === 'number' ? v.exposure : 0
    return {
        viewTransform,
        look: typeof v.look === 'string' && v.look ? v.look : 'None',
        exposure,
        gamma: typeof v.gamma === 'number' ? v.gamma : 1,
        toneMapping: TONE_MAPPINGS[viewTransform] ?? 'LinearToneMapping',
        toneMappingExposure: Math.pow(2, exposure),
    }
}
