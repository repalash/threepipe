
//https://web.archive.org/web/20170808071110/http://graphics.cs.williams.edu/papers/AlchemyHPG11/AlchemyHPG2011-present.pdf

//uniform float opacity;
//uniform sampler2D tDiffuse;
//uniform sampler2D tLastFrame;
uniform float currentFrameCount;
#ifndef D_frameCount
#define D_frameCount
uniform float frameCount;
#endif
uniform float objectRadius;
uniform float radius;
//uniform float power;
//uniform float bias;
//uniform float falloff;
uniform float tolerance;
uniform float ssrRoughnessFactor;
uniform bool autoRadius;
//uniform bool giEnabled;

#ifndef D_sceneBoundingRadius
#define D_sceneBoundingRadius
uniform float sceneBoundingRadius;
#endif

#if SSREFL_ENABLED == 2 // split mode
uniform float ssrSplitX;
#endif

#ifdef HAS_VELOCITY_BUFFER
#pragma <velocity_unpack>
#else
#define HAS_VELOCITY_BUFFER 0
#endif
#if HAS_VELOCITY_BUFFER == 0
#include <computeScreenSpaceVelocity>
#include <getWorldPositionFromViewZ>
#endif

vec3 ComputeReflectionL(vec3 N, vec2 E, vec3 V, float rough){
//    vec3 L;
//    L = reflect(normalize(V), N);
//    return L;

    float rough4 = rough *rough *rough *rough;
    // importance sampling
    float phi = 2.0 * PI * E.x;
    //    float cos_theta = sqrt((1.0 - E.y) / (1.0 + (rough4 - 1.0) * E.y)); // ggx, NOISY
    float cos_theta = pow(max(E.y, 0.000001), rough4 / (2.0 - rough4));// blinn
    float sin_theta = sqrt(max(0., 1.0 - cos_theta * cos_theta));
    vec3 half_vec = vec3(sin_theta * cos(phi), sin_theta * sin(phi), cos_theta);
    vec3 tangentX = normalize(cross(abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0), N));
    vec3 tangentY = cross(N, tangentX);
    half_vec = half_vec.x * tangentX + half_vec.y * tangentY + half_vec.z * N;

    // in view space
    vec3 ray_dir = (2.0 * dot(V, half_vec)) * half_vec - V;
//    ray_dir = normalize(ray_dir);

    return ray_dir;

}

vec2 GetRandomE(float seed){

    vec2 rand_e;// random
    rand_e.x = interleavedGradientNoise(gl_FragCoord.xy, frameCount*34. + seed);
    rand_e.y = fract(rand_e.x * 38.65435);
    // https://www.slideshare.net/DICEStudio/stochastic-screenspace-reflections#p=67
    rand_e.y = mix(rand_e.y, 1.0, 0.7);
    return rand_e;

}

vec4 calculateSSR(in float seed, in vec3 screenPos, in vec3 normal, in float radiusFactor, in float roughness){

//    if(roughness > 0.9) return vec4(0.);

    vec3 viewPos = screenToView3(screenPos.xy, screenPos.z);
    normal = normalize(normal);
    vec2 E = GetRandomE(seed);
    vec3 L = ComputeReflectionL(normal, E, -normalize(viewPos), roughness * ssrRoughnessFactor);

    L = normalize(L);
//    L *= sign(dot(L, normal));

    float cameraDist = length(cameraPositionWorld);

    float rayLen = objectRadius*sceneBoundingRadius;
    rayLen = autoRadius ?
    //    length(viewPos - screenToView3(screenPos.xy + objectRadius/10., screenPos.z)):
    //    mix((cameraNearFar.y) + viewPos.z, -viewPos.z - cameraNearFar.x, L.z * 0.5 + 0.5)*objectRadius:
    min(max(mix(
    max(0.0, (cameraDist + rayLen) + viewPos.z),
    max(0.0, -viewPos.z - max(0.0, cameraDist - rayLen)),
    L.z * 0.5 + 0.5), rayLen *0.1), rayLen*5.) :
    rayLen;
//    rayLen = mix((cameraDist + objectRadius) + viewPos.z, -viewPos.z - (cameraDist - objectRadius), L.z * 0.5 + 0.5);

    rayLen *= radiusFactor;
//    rayLen = 10.;

    float r = interleavedGradientNoise(gl_FragCoord.xy, frameCount + seed);

    // jitter rayLen
    //    rayLen = rayLen * (.75 + 0.5 * (random(r)));//mix(rayLen*(1.-.5), rayLen*(1.+.5), random(r));

    rayLen = max(rayLen, 0.001);

    int steps = SSR_STEP_COUNT / (currentFrameCount < float(SSR_LOW_QUALITY_FRAMES) ? 2 : 1);
    vec3 state = vec3(0.,(r+0.5)/float(steps),2.);
    viewPos += normal * max(-0.0001*viewPos.z, 0.001);

    vec3 screenHitP = traceRay(viewPos, L * rayLen, tolerance * rayLen, state, steps);
//    return vec4(screenHitP.x);
//    return vec4(-viewPos.z,0,0,1);
    if(state.z < 0.99){

        if(currentFrameCount < 1.){
            #if HAS_VELOCITY_BUFFER == 0
            vec3 worldPosition = getWorldPositionFromViewZ(screenHitP.xy, screenHitP.z);
            vec2 screenSpaceVelocity = computeScreenSpaceVelocity(worldPosition);
            #else
            vec2 screenSpaceVelocity = getVelocity(screenHitP.xy);
            #endif
            screenHitP.xy -= screenSpaceVelocity;
        }

        vec3 hitColor = (tLastFrameTexelToLinear(texture2D( tLastFrame , screenHitP.xy))).rgb;
//        vec3 hitColor = tDiffuseTexelToLinear(texture2D( tDiffuse, screenHitP.xy )).rgb;
//        vec3 hitNormal = getViewNormal(screenHitP.xy);

        float ssrWeight = 1.;

        return vec4(hitColor*ssrWeight, 1.);
    }

    return vec4(0.);
}

