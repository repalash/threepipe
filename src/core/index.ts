export {PerspectiveCamera2} from './camera/PerspectiveCamera2'
export {ExtendedShaderMaterial} from './material/ExtendedShaderMaterial'
export {PhysicalMaterial, type PhysicalMaterialEventTypes, MeshStandardMaterial2} from './material/PhysicalMaterial'
export {ShaderMaterial2} from './material/ShaderMaterial2'
export {UnlitMaterial, type UnlitMaterialEventTypes, MeshBasicMaterial2} from './material/UnlitMaterial'
export {iObjectCommons} from './object/iObjectCommons'
export {iCameraCommons} from './object/iCameraCommons'
export {iGeometryCommons} from './geometry/iGeometryCommons'
export {iMaterialCommons} from './material/iMaterialCommons'
export {upgradeTexture} from './ITexture'
export {upgradeWebGLRenderer} from './IRenderer'
export {RootScene} from './object/RootScene'
export type {ICameraControls, TControlsCtor} from './camera/ICameraControls'
export type {ICamera, ICameraEvent, ICameraEventTypes, ICameraUserData, TCameraControlsMode, ICameraSetDirtyOptions} from './ICamera'
export type {IGeometry, IGeometryUserData, IGeometryEvent, IGeometryEventTypes, IGeometrySetDirtyOptions} from './IGeometry'
export type {IMaterial, IMaterialEvent, IMaterialEventTypes, IMaterialParameters, IMaterialUserData, IMaterialSetDirtyOptions, IMaterialTemplate, IMaterialGenerator} from './IMaterial'
export type {IObject3D, IObject3DEvent, IObjectSetDirtyOptions, IObjectProcessor, IObject3DEventTypes, IObject3DUserData} from './IObject'
export type {IRenderManager, IRenderManagerOptions, IWebGLRenderer, IRenderManagerEventTypes, IAnimationLoopEvent, TThreeRendererMode, TThreeRendererModeUserData, IRenderManagerUpdateEvent, IRenderManagerEvent} from './IRenderer'
export type {IScene, ISceneEvent, ISceneEventTypes, ISceneSetDirtyOptions, AddObjectOptions, ISceneUserData, IWidget} from './IScene'
export type {ITexture, ITextureUserData} from './ITexture'
