
#include <randomHelpers>

#ifndef D_sceneBoundingRadius
#define D_sceneBoundingRadius
uniform float sceneBoundingRadius;
#endif

#ifndef D_frameCount
#define D_frameCount
uniform float frameCount;
#endif


varying vec4 vRefUv;
uniform sampler2D tRefDiffuse;
uniform vec2 tRefDiffuseSize;
//uniform sampler2D tRefDepth;
float getSpecularMIPLevel(const in float roughness, const in float maxMIPLevel) {
    float sigma = PI * roughness * roughness / (1.0 + roughness);
    float desiredMIPLevel = maxMIPLevel + log2(sigma);
    // clamp to allowable LOD ranges.
    return clamp(desiredMIPLevel, 0.0, maxMIPLevel);
}

vec4 getReflectionColor(const in float roughness, const in float depthModifier){
    float mip = getSpecularMIPLevel(roughness + depthModifier, 4.0);
    vec4 color = texture2D(tRefDiffuse, vRefUv.xy/vRefUv.w, mip);
    float blurDist = saturate(2.0 / (1. + pow(abs(vViewPosition.z), 0.25))) * roughness * 64. * color.a;

    float rnd = PI2 * interleavedGradientNoise( vUv.xy, frameCount );
    vec4 rotationMatrix = vec4(cos(rnd), -sin(rnd), 0.,0.);
    rotationMatrix.z = -rotationMatrix.y;
    rotationMatrix.w = rotationMatrix.x;

    vec3 colorSum = color.rgb * color.a;
    float weightSum = 0.001 + color.a;
    vec2 ofs;

    setPds(); // sets poisson_disk_samples

    #pragma unroll_loop_start
    for ( int i = 0; i < 16; i ++ ) {
        ofs = poisson_disk_samples[UNROLLED_LOOP_INDEX];
        ofs = vec2(dot(ofs, rotationMatrix.xy), dot(ofs, rotationMatrix.zw) );
        ofs = vRefUv.xy + vRefUv.w * blurDist * ofs / tRefDiffuseSize.xy;
        color = texture2D(tRefDiffuse, ofs / vRefUv.w, mip);
        colorSum += color.rgb * color.a;
        weightSum += color.a;
    }
    #pragma unroll_loop_end

    return vec4(colorSum / weightSum, 1.0);
}
