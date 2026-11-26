import computeScreenSpaceVelocity from './shaders/computeScreenSpaceVelocity.glsl'
import getWorldPositionFromViewZ from './shaders/getWorldPositionFromViewZ.glsl'
import temporalaa from './shaders/temporalaa.glsl'
import ssreflection from './shaders/ssreflection.glsl'
import ssrtao from './shaders/ssrtao.glsl'
import {RenderManager} from "threepipe";

const shadersUtils2 = {
    computeScreenSpaceVelocity: computeScreenSpaceVelocity,
    getWorldPositionFromViewZ: getWorldPositionFromViewZ,
    temporalAA: temporalaa,
    ssReflection: ssreflection,
    calculateGI: ssrtao,

    ['__inited']: false,
}

export function getShaders(){
    if(!shadersUtils2.__inited){
        shadersUtils2.__inited = true
        Object.assign(RenderManager.ShaderChunk, shadersUtils2)
    }
    return shadersUtils2
}
