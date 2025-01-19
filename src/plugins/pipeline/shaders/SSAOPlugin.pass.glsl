#include <randomHelpers>
#include <common>
#include <packing>
#define THREE_PACKING_INCLUDED
#include <cameraHelpers>

varying vec2 vUv;

uniform sampler2D tLastThis;

#ifndef D_frameCount
#define D_frameCount
uniform float frameCount;
#endif

uniform vec4 saoData;
uniform vec3 saoBiasEpsilon;
uniform vec2 screenSize;

const float INV_NUM_SAMPLES = 1.0 / float(NUM_SAMPLES);

int getSelectionBit(in int number) {
    #ifdef WebGL2Context
    return (number/8) % 2;
    #else
    return int(mod(floor(float(number)/8.), 2.));
    #endif
}

vec3 packFloatToRGB(const in float x) {
    const vec3 code = vec3(1.0, 255.0, 65025.0);
    vec3 pack = vec3(code * x);
    pack.gb = fract(pack.gb);
    pack.rg -= pack.gb * (1.0 / 256.0);
    return pack;
}

vec3 getPositionFromOffset(const in vec2 uvOffset) {
    #if defined(HAS_DEPTH_BUFFER) || defined(HAS_NORMAL_DEPTH_BUFFER)
    float d = getDepth(uvOffset);
    #else
    float d = 0.5;
    #endif

    #if LINEAR_DEPTH == 0
    float centerViewZ = viewZFromNDCZ(d);
    return screenToView3(uvOffset, centerViewZ);
    #else
    d = mix(-cameraNearFar.x, -cameraNearFar.y, d);
    return screenToView3(uvOffset, d);
    #endif
}

float getOcclusion(const in vec2 uv,
const in int id,
const in float randomAngle,
const in float occlusionSphereRadius,
const in vec3 centerPosition,
const in vec3 centerNormal) {
    float screenSpaceRadius = (float(id) + mod(randomAngle, 1.) + 0.5) * INV_NUM_SAMPLES;
    float angle = screenSpaceRadius * (float(NUM_SPIRAL_TURNS) * 6.28318) + randomAngle;
    screenSpaceRadius = (screenSpaceRadius * occlusionSphereRadius);
    vec2 uvOffset = uv + floor(screenSpaceRadius * vec2(cos(angle), sin(angle))) / screenSize;
    #if CHECK_GBUFFER_FLAG == 1
    if (getSelectionBit(getGBufferFlags(uvOffset.xy).a) < 1) return 0.0;
    #endif
    vec3 samplePosition = getPositionFromOffset(uvOffset);
    vec3 direction = samplePosition - centerPosition;
    float d2 = dot(direction, direction);
    float ao = max((dot(centerNormal, direction) + centerPosition.z * saoBiasEpsilon.x) / (saoBiasEpsilon.z * d2 + saoBiasEpsilon.y), 0.0);
    return ao;
}

void main() {

    // initial values
    float centerDepth = 0.5;
    vec3 centerNormal = vec3(0, 1, 0);

    #ifdef HAS_NORMAL_DEPTH_BUFFER
    getDepthNormal(vUv, centerDepth, centerNormal);
    #else
    #ifdef HAS_DEPTH_BUFFER
    centerDepth = getDepth(vUv);
    #endif

// todo - add support for NormalBufferPlugin
//    #ifdef HAS_NORMAL_BUFFER
//    centerDepth = getDepth(vUv);
//    #endif

    #endif

    //    if (centerDepth >= (1.0 - EPSILON)) {
    //        discard;
    //    }

    #if LINEAR_DEPTH == 0
    float centerViewZ = viewZFromNDCZ(centerDepth);
    #else
    float centerViewZ = mix(-cameraNearFar.x, -cameraNearFar.y, centerDepth);
    #endif

    vec3 centerPosition = screenToView3(vUv, centerViewZ);

    float occlusionSphereScreenRadius = 200. * saoData.z / (-centerPosition.z);

    //    if (occlusionSphereScreenRadius < 1.) {
    //        discard;
    //    }

    float randomAngle = 6.2 * random3(vec3(vUv, frameCount * 0.1));

    float sum = 0.0;

    sum += getOcclusion(vUv, 0, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #if NUM_SAMPLES > 1
    sum += getOcclusion(vUv, 1, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #endif
    #if NUM_SAMPLES > 2
    sum += getOcclusion(vUv, 2, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #endif
    #if NUM_SAMPLES > 3
    sum += getOcclusion(vUv, 3, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #endif
    #if NUM_SAMPLES > 4
    sum += getOcclusion(vUv, 4, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #endif
    #if NUM_SAMPLES > 5
    sum += getOcclusion(vUv, 5, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #endif
    #if NUM_SAMPLES > 6
    sum += getOcclusion(vUv, 6, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #endif
    #if NUM_SAMPLES > 7
    sum += getOcclusion(vUv, 7, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #endif
    #if NUM_SAMPLES > 8
    sum += getOcclusion(vUv, 8, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #endif
    #if NUM_SAMPLES > 9
    sum += getOcclusion(vUv, 9, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #endif
    #if NUM_SAMPLES > 10
    sum += getOcclusion(vUv, 10, randomAngle, occlusionSphereScreenRadius, centerPosition, centerNormal);
    #endif

    float aoValue = sum * saoData.y * INV_NUM_SAMPLES;

    // this is not needed since ao can be disabled by not adding the material extension or the patch.
    // bool disableAO = getSelectionBit(getGBufferFlags(vUv).a) > 0 ? true : false;

    aoValue = 1. - clamp(aoValue, 0., 1.);

    // todo why so many packing options?
    #if SSAO_PACKING == 1 // (r: ssao, gba: depth)
    // so that depth can also be sampled with ssao if required?
    gl_FragColor.gba = packFloatToRGB(centerDepth);
    gl_FragColor.r = aoValue;// + (lastAO.r) * frameCount)/(frameCount+1.);
    #elif SSAO_PACKING == 2 // (rgb: ssao, a: 1)
    gl_FragColor.rgb = vec3(aoValue);
    gl_FragColor.a = 1.;
    #elif SSAO_PACKING == 3 // (rgba: packed_ssao)
    gl_FragColor.rgba = packDepthToRGBA(aoValue); // from packing
    #elif SSAO_PACKING == 4 // (rgb: packed_ssao, a: 1)
    gl_FragColor.rgb = packFloatToRGB(aoValue);
    gl_FragColor.a = 1.;
    #endif

    //    vec4 lastAO = texture2D( tLastThis, vUv );
    //    gl_FragColor.r = (vec4(aoValue)).r;// + (lastAO.r) * frameCount)/(frameCount+1.);
    //    gl_FragColor.r = aoValue + (lastAO.r) * frameCount)/(frameCount+1.);
    //    gl_FragColor.r = aoValue;
    //    gl_FragColor = vec4(centerDepth);
}
