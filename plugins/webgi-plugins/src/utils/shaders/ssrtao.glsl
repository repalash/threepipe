
//https://web.archive.org/web/20170808071110/http://graphics.cs.williams.edu/papers/AlchemyHPG11/AlchemyHPG2011-present.pdf

//uniform float opacity;
//varying vec2 vUv;
//#ifndef D_frameCount
//#define D_frameCount
//uniform float frameCount;
//#endif
uniform float currentFrameCount;
uniform float intensity;
uniform float objectRadius;
//uniform float radius;
uniform float rayCount;
uniform float power;
uniform float bias;
uniform float falloff;
uniform float tolerance;
uniform bool autoRadius;

uniform vec2 screenSize;

#ifndef D_sceneBoundingRadius
#define D_sceneBoundingRadius
uniform float sceneBoundingRadius;
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

vec3 ComputeUniformL(vec3 N, vec2 E){
    vec3 L;
    L.xy = E;
    L.z = interleavedGradientNoise(gl_FragCoord.xy, currentFrameCount*5.);
    L = L * 2. - 1.;
    return L;
}

vec2 GetRandomE(float seed){
    vec2 rand_e;
    rand_e.x = random3(vec3(gl_FragCoord.xy, currentFrameCount + seed));
    rand_e.y = random3(vec3(gl_FragCoord.yx, rand_e.x + (currentFrameCount)*7.));
    return rand_e;
}

float saturate2(float v, float mx){
    return max(0., min(mx, v));
}

vec4 calculateGI(in float seed, in vec3 screenPos, in vec3 normal, in float radiusFactor){

    vec3 viewPos = screenToView3(screenPos.xy, screenPos.z);

    normal = normalize(normal);
    vec2 E = GetRandomE(seed);
    vec3 L = ComputeUniformL(normal, E);

    L = normalize(L);
    L *= sign(dot(L, normal));

    float cameraDist = length(cameraPositionWorld);

//    float rayLen = autoRadius ?
//        length(viewPos - screenToView3(screenPos.xy + objectRadius/10., screenPos.z)):
//    mix((cameraNearFar.y) + viewPos.z, -viewPos.z - cameraNearFar.x, L.z * 0.5 + 0.5)*objectRadius;

    float rayLen = objectRadius*sceneBoundingRadius;
    rayLen = autoRadius ?
    //    length(viewPos - screenToView3(screenPos.xy + objectRadius/10., screenPos.z)):
    //    mix((cameraNearFar.y) + viewPos.z, -viewPos.z - cameraNearFar.x, L.z * 0.5 + 0.5)*objectRadius:
    min(max(mix(
    max(0.0, (cameraDist + rayLen) + viewPos.z),
    max(0.0, -viewPos.z - max(0.0, cameraDist - rayLen)),
    L.z * 0.5 + 0.5), rayLen *0.1), rayLen*5.) :
    rayLen;

//    rayLen = min(-viewPos.z, rayLen);
//    rayLen = mix((cameraDist + objectRadius) + viewPos.z, -viewPos.z - (cameraDist - objectRadius), L.z * 0.5 + 0.5);

    rayLen *= radiusFactor;

//    float r = interleavedGradientNoise(gl_FragCoord.xy, currentFrameCount*14. + seed) + 0.05;
    float r = interleavedGradientNoise(gl_FragCoord.xy, currentFrameCount*14. + seed) + 0.05;

    // jitter rayLen
//    rayLen = rayLen * (.75 + 0.5 * (random(r)));//mix(rayLen*(1.-.5), rayLen*(1.+.5), random(r));

    rayLen = max(rayLen, 0.001);

    vec3 state = vec3(1.,(r+0.5)/float(RTAO_STEP_COUNT),2.);
    viewPos += normal * max(-0.01*viewPos.z, 0.001);
    vec3 screenHitP = traceRay(viewPos, L * rayLen, tolerance * rayLen, state, RTAO_STEP_COUNT);

    vec3 viewHitP = screenToView3(screenHitP.xy, screenHitP.z);
    vec3 LRes = viewHitP - viewPos;
    if(state.z > 1.) LRes = vec3(9999999.);
    float dist = length(LRes) * falloff;

    float EPS = 0.01;
    float zBias = (viewPos.z) * bias;
    float ao = (max(dot(normal, L) + zBias, 0.)) / (dist*dist + EPS);

    #if defined(SSGI_ENABLED) && SSGI_ENABLED > 0

        if(currentFrameCount < 1.){
            #if HAS_VELOCITY_BUFFER == 0
            vec3 worldPosition = getWorldPositionFromViewZ(screenHitP.xy, screenHitP.z);
            vec2 screenSpaceVelocity = computeScreenSpaceVelocity(worldPosition);
            #else
            vec2 screenSpaceVelocity = getVelocity(screenHitP.xy);
            #endif
            screenHitP.xy -= screenSpaceVelocity;
        }

        vec3 hitColor = tLastFrameTexelToLinear(texture2D(tLastFrame, screenHitP.xy)).rgb;
        //    vec3 hitColor = tDiffuseTexelToLinear(texture2D( tDiffuse, screenHitP.xy )).rgb;
        vec3 hitNormal = getViewNormal(screenHitP.xy);
        float giWeight = 1.;
        giWeight = saturate2(giWeight / (dist+EPS), 1.);
        giWeight *= saturate2((dot(normal, L)), 1.0);
        giWeight *= saturate2((dot(hitNormal, -L)), 1.0);
        //    giWeight *= saturate2((1.-dot(hitNormal, normal) ), 1.1);

        return vec4(hitColor*giWeight, ao);
    #endif

    return vec4(0,0,0,ao);
}


float normpdf(in float x, in float sigma)
{
    return exp(-0.5*x*x/(sigma*sigma));
}
//float normpdf(in float x, in float sigma)
//{
//    return 0.39894*exp(-0.5*x*x/(sigma*sigma))/sigma;
//}
//


//uniform bool smoothEnabled; // last frame bilateral denoise
//uniform vec4 smoothSigma; // color, depth, pixel, normal
//uniform vec4 smoothScale; // color, depth, pixel, normal
//#define BILATERAL_KERNEL 2

//uniform vec4 smoothModes; // depthScale, 0, 0,
vec4 getLastThis(sampler2D tex, float depth, vec3 normal){
//    vec4 smoothSigma = vec4(5,10,2,2);
    vec2 direction = vec2(1,1);

    vec4 color = clamp(tLastThisTexelToLinear(texture2D(tex, vUv.xy)), 0., 5.);

//    float depth;
//    vec3 normal;
//    getDepthNormal(vUv, depth, normal);

//    if(!smoothEnabled || frameCount < 60. || vUv.x > 0.5)
        return color;

//    direction *= vec2(int(frameCount)%2, int(frameCount+1.)%2);

//    float Z = 1.0;
//    vec4 final_colour = Z * color;
//    float factor;
//    vec2 nuv;
//    vec4 cc, np; float dp; vec3 nor;  // cc is color, np is position, dp is depth, nor is normal
//    direction /= screenSize.xy;
//
//    // -1, 1, -2, 2, -3, 3
//    for (int i = 0; i < BILATERAL_KERNEL; ++i)
//    {
//
//        direction *= -1.;
//        nuv = vUv + direction * float( i/2 + 1 ); // clamp to screen border
//        getDepthNormal(nuv, dp, nor);
//        if(dp > 0.99) continue;
//
//        cc = clamp(texture2D(tex, nuv), 0., 5.); // clamp(texsample(tDiffuse, float(i), float(j)), 0., 1.);
//
//        factor = 1.;
//
//        factor *= normpdf( length(cc-color)       * smoothScale.x, smoothSigma.x); //color
//        factor *= normpdf( sqrt(abs(dp-depth))    * smoothScale.y, smoothSigma.y); //depth
//        factor *= normpdf( float( i/2 + 1 )        * smoothScale.z, smoothSigma.z); //pixel distance
//        factor *= normpdf( (1.-dot(normal, nor))  * smoothScale.w, smoothSigma.w); //normal
////            factor *= normpdf(sqrt(length(np-pos))*smoothScale.y, smoothSigma.y); // position.
//
//        Z += factor;
//        final_colour += factor*cc;
//
//    }
//
//    final_colour /= Z;
//    return final_colour;
}

void main() {

//    vec4 texel = texture2D( tDiffuse, vUv );
    float depth;
    vec3 normal;
//    float alpha = opacity;
    getDepthNormal(vUv, depth, normal);

    if (depth > 0.99) {
        discard;

        gl_FragColor = getLastThis(tLastThis, depth, normal);

        return;
    }

    float viewZ = depthToViewZ(depth);
    vec3 screenPos = vec3(vUv.x, vUv.y, viewZ);

    vec4 gi = vec4(0.);
//    screenPos.z += 0.001;
    gi += calculateGI(8., screenPos, normal, 1.);
    if(rayCount > 1.5)
        gi = max(gi, calculateGI(2., screenPos, normal, 0.4));
    if(rayCount > 2.5)
        gi = max(gi, calculateGI(3., screenPos, normal, 1.5));
    if(rayCount > 3.5)
        gi = max(gi, calculateGI(1., screenPos, normal, 0.6));
    if(rayCount > 4.5)
        gi = max(gi, calculateGI(3., screenPos, normal, 1.));

//        gi += calculateGI(3., screenPos, normal, 1.);
//        gi += calculateGI(4., screenPos, normal, 1.);
//        gi += calculateGI(5., screenPos, normal, 1.);
//        gi += calculateGI(6., screenPos, normal, 1.);
//        gi += calculateGI(7., screenPos, normal, 1.);
//        gi = gi / 6.;
//        gi = gi / 3.;

//     gl_FragColor = vec4(texel) * (1.-ao);

    gi.a = min(1., gi.a);
    gi.a = max(0., gi.a);
//    gi = ao;
//    gi *= intensity/1.;

    gi.rgb = min(vec3(3.), gi.rgb);
    gi.rgb = max(vec3(0.), gi.rgb);

    if(currentFrameCount < 3.){
        gl_FragColor = gi;
        return;
    }

    gl_FragColor = (texture2D( tLastThis, vUv ));
//    gl_FragColor = getLastThis(tLastThis, depth, normal);

    //    if(gi.a < 0.001){
    //        gl_FragColor.rgb = gl_FragColor.rgb;
    //        gl_FragColor.a = (((gl_FragColor.a) * frameCount)/(frameCount+1.));
    //    }else {
    //        gl_FragColor = ((gi + (gl_FragColor) * frameCount)/(frameCount+1.));
    //    }

    gl_FragColor = ((gi + (gl_FragColor) * currentFrameCount)/(currentFrameCount+1.));

    // todo: encodings??

//    #include <colorspace_fragment>

}
