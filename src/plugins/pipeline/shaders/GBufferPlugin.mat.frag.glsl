// Similar to meshnormal.glsl.js in three.js, check for ref

#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

#glMarker importsEnd

#define DEPTH_NORMAL
#define IS_DEPTH_MATERIAL

//uniform float opacity;

varying vec3 vViewPosition;

#ifdef USE_ALPHAMAP
#define USE_UV

#include <packing>

#endif

#if IS_GLSL3 > 0

#ifndef gl_FragColor // webgl2 with glsl3
layout(location = 0) out vec4 gDepthNormal;
layout(location = 1) out vec4 gFlags;
//#define gl_FragColor gDepthNormal
#endif

#endif

uniform vec2 cameraNearFar;
uniform vec4 flags;

//vec2 pack16(float value) {
//    float sMax = 65535.0;
//    int v = int(clamp(value, 0.0, 1.0)*sMax+0.5);
//    int digit0 = v/256;
//    int digit1 = v-digit0*256;
//    return vec2(float(digit0)/255.0, float(digit1)/255.0);
//}
vec2 pack16(float value){
    float f = clamp(value, 0.0, 1.0)*255.0;
    float digitLow = fract(f);
    float digitHigh = floor(f)/255.0;
    return vec2(digitHigh, digitLow);
}
//float unpack16(vec2 value){
//    return value.x+value.y/255.0;
//}

vec2 packNormal(vec3 n){
    float p = sqrt(n.z*8.0+8.0);
    return vec2(n.xy/p + 0.5);
}

float linstep(float edge0, float edge1, float value) {
    return clamp((value-edge0)/(edge1-edge0), 0.0, 1.0);
}

void main() {
    #glMarker mainStart

    #include <clipping_planes_fragment>

    vec4 diffuseColor = vec4( 1.0 );

    #include <map_fragment>

    //#/include <alphamap_fragment> // changed for ALPHA_I_RGBA_PACKING
    #ifdef USE_ALPHAMAP

    float alphaMapValue =
    #ifdef ALPHA_I_RGBA_PACKING
    1. - unpackRGBAToDepth( texture2D( alphaMap, vAlphaMapUv ) );
    #else
    texture2D( alphaMap, vAlphaMapUv ).g;
    #endif

    #if defined(INVERSE_ALPHAMAP) && INVERSE_ALPHAMAP >= 1
    diffuseColor.a *= 1.0 - alphaMapValue;
    #else
    diffuseColor.a *= alphaMapValue;
    #endif

    #endif

    #include <alphatest_fragment>

    #include <logdepthbuf_fragment>
    #include <normal_fragment_begin>
    #include <normal_fragment_maps>

    #glMarker beforeOutput

    #ifdef FORCED_LINEAR_DEPTH
    float linearZ = float(FORCED_LINEAR_DEPTH);
    #else
    float linearZ = linstep(-cameraNearFar.x, -cameraNearFar.y, -vViewPosition.z);
    #endif
    vec2 packedZ = pack16(pow(max(0.,linearZ), 0.5));
    vec2 packedNormal = packNormal(normal);

    #if IS_GLSL3 > 0
    #ifndef gl_FragColor // webgl2 with glsl3
    gDepthNormal = vec4(packedZ.x, packedZ.y, packedNormal.x, packedNormal.y);
    gFlags = flags;
    #else
    gl_FragColor = vec4(packedZ.x, packedZ.y, packedNormal.x, packedNormal.y);
    #endif
    #else
    gl_FragColor = vec4(packedZ.x, packedZ.y, packedNormal.x, packedNormal.y);
    #endif
}
