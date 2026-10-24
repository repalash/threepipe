// SSR trace pass (inlineShaderRayTrace = false): one noisy reflection estimate per pixel from the G-buffer, denoised
// afterwards by SpatioTemporalDenoiser in reflection mode. The roughness comes from the G-buffer flags (x), written by
// the SSR plugin's G-buffer extension (material roughness times the roughness map).
//
// Output 0: rgb = mean radiance of the rays that hit, premultiplied by a; a = 1 when any ray hit, else 0
// Output 1: r = mean hit distance in view units (0 when no ray hit), g = roughness

layout(location = 0) out highp vec4 outReflection;
layout(location = 1) out highp vec4 outReflectionData;

// Rougher surfaces get no screen-space reflection (the material patch uses the same limit).
#define SSR_MAX_ROUGHNESS 0.9

// Half-resolution trace (traceFullSize.x > 0): each pixel of the half-resolution target traces one full-resolution
// pixel of its 2x2 block, traceOffset (0 or 1 per axis, changes every frame); ssreflectionUpsample.glsl fills the rest.
uniform vec2 traceOffset;
uniform vec2 traceFullSize; // size of the full-resolution raw target (the G-buffer at sizeMultiplier 1), 0 at full resolution

void main() {
    vec2 uv = traceFullSize.x > 0. ? (2. * floor(gl_FragCoord.xy) + traceOffset + 0.5) / traceFullSize : vUv;
    float depth;
    vec3 normal;
    getDepthNormal(uv, depth, normal);

    if (depth >= 0.999) {
        outReflection = vec4(0.);
        outReflectionData = vec4(0., 1., 0., 0.);
        return;
    }

    #if defined(GBUFFER_HAS_FLAGS) && GBUFFER_HAS_FLAGS == 1
    float roughness = texture2D(tGBufferFlags, uv).x;
    #else
    float roughness = 0.3; // no flags buffer: one roughness for every surface
    #endif

    float viewZ = depthToViewZ(depth);
    vec3 screenPos = vec3(uv, viewZ);
    vec4 sum = vec4(0.);
    float distanceSum = 0.;

    if (roughness < SSR_MAX_ROUGHNESS) {
        #pragma unroll_loop_start
        for (int i = 0; i < 8; i++) {
            if (SSR_RAY_COUNT > UNROLLED_LOOP_INDEX) {
                vec4 s = calculateSSR(float(UNROLLED_LOOP_INDEX), screenPos, normal, UNROLLED_LOOP_INDEX % 3 == 0 ? 1. : UNROLLED_LOOP_INDEX % 3 == 1 ? 0.5 : 1.5, roughness);
                sum += s;
                distanceSum += ssrHitDistance;
            }
        }
        #pragma unroll_loop_end
    }

    // Weight as the inline trace does: a pixel where any ray hit shows the mean color of its hits at full weight (the
    // physical hit fraction, hits / SSR_RAY_COUNT, made glossy reflections about 20% darker than inline on the
    // ssrGloss floor). Premultiplied, so the denoiser can average pixels and frames with and without hits; the
    // materials divide by a after filtering (ssrPatch.glsl), and a converges to the fraction of frames with a hit.
    float hits = sum.a;
    outReflection = hits > 0. ? vec4(min(sum.rgb / hits, vec3(16.)), 1.) : vec4(0.);
    outReflectionData = vec4(hits > 0. ? distanceSum / hits : 0., roughness, 0., 0.);
}
