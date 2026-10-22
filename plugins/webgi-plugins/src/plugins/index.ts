import {VelocityBufferPlugin} from './buffer/VelocityBufferPlugin'
import {BloomPlugin} from './postprocessing/BloomPlugin'
import {DepthOfFieldPlugin} from './postprocessing/DepthOfFieldPlugin'
import {SSContactShadowsPlugin} from './postprocessing/SSContactShadowsPlugin'
import {SSReflectionPlugin} from './postprocessing/SSReflectionPlugin'
import {TemporalAAPlugin} from './postprocessing/TemporalAAPlugin'
import {OutlinePlugin} from "./postprocessing/OutlinePlugin";
import {SSGIPlugin} from "./postprocessing/SSGIPlugin";
import {AnisotropyPlugin} from "./extras/AnisotropyPlugin";
import {AdvancedGroundPlugin} from "./extras/AdvancedGroundPlugin";
import {WatchHandsPlugin} from "./extras/WatchHandsPlugin";

export {TemporalAAPlugin, TemporalAAPluginPass} from './postprocessing/TemporalAAPlugin'
export {VelocityBufferPlugin, SSVelocityMaterial} from './buffer/VelocityBufferPlugin'
export type {VelocityBufferPluginPass, VelocityBufferPluginTarget} from './buffer/VelocityBufferPlugin'
export {BloomPlugin, BloomPluginPass} from './postprocessing/BloomPlugin'
export {SSReflectionPlugin, SSReflectionPluginPass, type SSReflectionPluginTarget} from './postprocessing/SSReflectionPlugin'
export {SSGIPlugin, SSGIPluginPass, type SSGIPluginTarget} from './postprocessing/SSGIPlugin'
export {SSContactShadowsPlugin} from './postprocessing/SSContactShadowsPlugin'
export {DepthOfFieldPlugin, DepthOfFieldPluginPass} from './postprocessing/DepthOfFieldPlugin'
export {OutlinePlugin, OutlineRenderPass, type OutlinePluginPass, type OutlinePluginTarget} from './postprocessing/OutlinePlugin'
export {AnisotropyPlugin, anisotropyGLTFExtension} from "./extras/AnisotropyPlugin";
export {AdvancedGroundPlugin} from "./extras/AdvancedGroundPlugin";
export {WatchHandsPlugin} from "./extras/WatchHandsPlugin";

export const webgiPlugins = [
    TemporalAAPlugin,
    VelocityBufferPlugin,
    BloomPlugin,
    SSReflectionPlugin,
    SSContactShadowsPlugin,
    DepthOfFieldPlugin,
    OutlinePlugin,
    SSGIPlugin,
    AnisotropyPlugin,
    AdvancedGroundPlugin,
    WatchHandsPlugin,
]
