#include <randomHelpers>
#include <common>
varying vec2 vUv;
//uniform sampler2D colorTexture;
uniform vec2 colorTextureSize;
uniform float blurRadius; // = 16
#ifndef D_frameCount
#define D_frameCount
uniform float frameCount;
#endif
//const float MAXIMUM_BLUR_SIZE = 16.0;

//float ditheringNoise(const in vec2 fragCoord, const in float frameMod) {
//    // float fm = mod(frameMod, 2.0) == 0.0 ? 1.0 : -1.0;
//    float fm = frameMod;
//    float dither5 = fract((fragCoord.x + fragCoord.y * 2.0 - 1.5 + fm) / 5.0);
//    float noise = fract(dot(vec2(171.0, 231.0) / 71.0, fragCoord.xy));
//    return (dither5 * 5.0 + noise) * (1.2 / 6.0);
//}

vec4 CircularBlur() {
    vec4 color = colorTextureTexelToLinear(texture2D(colorTexture, vUv));

    #ifdef DOF_MODE
    float blurDist = blurRadius * ( 2. * color.a - 1.);
    #else
    float blurDist = blurRadius * color.a;
    #endif

//    #ifdef DEPTH_BLUR
//    float depth = texture2D(depthTexture, vUv).r;
//    blurDist *= depth;
//    #endif

    float rnd = PI2 * random3( vec3(vUv, frameCount * 0.1) );
    float costheta = cos(rnd);
    float sintheta = sin(rnd);
    vec4 rotationMatrix = vec4(costheta, -sintheta, sintheta, costheta);

    vec3 colorSum = vec3(0.0);
    float weightSum = 0.001;
    vec2 ofs;
    vec4 sampleColor;
//    float cocWeight;

    setPds(); // sets poisson_disk_samples

    #pragma unroll_loop_start
    for ( int i = 0; i < 16; i ++ ) {
        ofs = poisson_disk_samples[UNROLLED_LOOP_INDEX];
        ofs = vec2(dot(ofs, rotationMatrix.xy), dot(ofs, rotationMatrix.zw) );
        sampleColor = colorTextureTexelToLinear(texture2D(colorTexture, vUv + blurDist * ofs / colorTextureSize.xy));
        #ifdef DOF_MODE
        sampleColor.a = abs(sampleColor.a * 2.0 - 1.0);
        sampleColor.a *= sampleColor.a*sampleColor.a;
        #endif
        colorSum += sampleColor.rgb * sampleColor.a;
        weightSum += sampleColor.a;
    }
    #pragma unroll_loop_end

    // rnd = PI2 * random3( vec3(vUv, frameCount * 0.1 + 2.) );
    // costheta = cos(rnd);
    // sintheta = sin(rnd);
    // rotationMatrix = vec4(costheta, -sintheta, sintheta, costheta);

    // for (int i = 0; i < NUM_SAMPLES; i++) {
    //     vec2 ofs = poisson_disk_samples[i];
    //     ofs = vec2(dot(ofs, rotationMatrix.xy), dot(ofs, rotationMatrix.zw) );
    //     vec2 texcoord = vUv + blurDist * ofs / colorTextureSize.xy;
    //     vec4 sample = texture2D(colorTexture, texcoord);
    //     float cocWeight = abs(2. * sample.a - 1.);
    //     cocWeight *= cocWeight * cocWeight;
    //     colorSum += sample.rgb * cocWeight;
    //     weightSum += cocWeight;
    // }

    colorSum /= weightSum;

//    return vec4(saturate(colorSum), saturate((weightSum-0.001)/16.0));
    return vec4(min(vec3(72.), max(vec3(0.), colorSum)), 1.0);
//    return vec4(saturate(colorSum), 1.0);
}

void main() {
    gl_FragColor = CircularBlur();

    #include <colorspace_fragment>
}

