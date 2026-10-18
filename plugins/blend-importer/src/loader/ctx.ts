import {
    AmbientLight,
    BufferAttribute,
    BufferGeometry,
    DirectionalLight,
    Mesh,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    PointLight,
    SpotLight,
    Texture,
} from 'threepipe'

export interface Ctx {
    PointLight: typeof PointLight
    SpotLight: typeof SpotLight
    DirectionalLight: typeof DirectionalLight
    AmbientLight: typeof AmbientLight
    Object3D: typeof Object3D
    PerspectiveCamera: typeof PerspectiveCamera
    OrthographicCamera: typeof OrthographicCamera
    Mesh: typeof Mesh
    BufferGeometry: typeof BufferGeometry
    BufferAttribute: typeof BufferAttribute
    MeshPhysicalMaterial: typeof MeshPhysicalMaterial
    MeshBasicMaterial: typeof MeshBasicMaterial
    /**
     * Load an external (file-path) image referenced by a Blender Image datablock, resolving it
     * relative to the `.blend`'s directory through threepipe's asset pipeline (cache + LoadingManager).
     * Returns a Texture whose image fills in asynchronously (the load is awaited by the loader before
     * the scene is returned). Returns `null` when unavailable (e.g. Node without a DOM). Provided by
     * `BlendLoadPlugin`; absent when the loader is driven outside that plugin.
     */
    loadExternalTexture?: (blenderPath: string, srgb: boolean) => Texture | null
    /**
     * Evaluate modifier stacks as Blender's viewport does, or as its renderer does. Default `'viewport'`
     * - see {@link BlendEvaluationMode}.
     */
    evaluationMode?: BlendEvaluationMode
}

/**
 * Which of Blender's two evaluations of a modifier stack the importer reproduces.
 *
 * Blender evaluates every stack in one of two modes and the mode decides two things: which modifiers
 * run - `required_mode = use_render ? eModifierMode_Render : eModifierMode_Realtime`
 * (`mesh_data_update.cc:303`, checked in `BKE_modifier_is_enabled`) - and, for Subsurf, which level -
 * `levels = use_render_params ? renderLevels : levels` (`MOD_subsurf.cc:86`). Its own exporters default
 * to the viewport (`IO_wavefront_obj.hh:53`, `export_eval_mode = DAG_EVAL_VIEWPORT`), and a real-time
 * viewer is the viewport case: a model authored with Subsurf `levels: 0, renderLevels: 2`, or with a
 * heavy modifier turned off in the viewport, is saying what it wants shown interactively.
 */
export type BlendEvaluationMode = 'viewport' | 'render'
