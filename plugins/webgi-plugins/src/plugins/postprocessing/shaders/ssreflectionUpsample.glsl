// SSR half-resolution trace: upsamples the raw reflections to full resolution before the denoiser.
// Each half-resolution texel holds the trace of one full-resolution pixel of its 2x2 block (traceOffset, which changes
// every frame, so the denoiser history sees every pixel). A full-resolution pixel takes the 2x2 texels whose traced
// pixels surround it, weighted by distance and by how close each traced pixel lies to this pixel's surface (tangent
// plane and normal), so reflections do not leak across object edges. The roughness is read at full resolution.
//
// Outputs: the same as ssreflectionMain.glsl.

layout(location = 0) out highp vec4 outReflection;
layout(location = 1) out highp vec4 outReflectionData;

// tHalf (declared by the pass): reflection, premultiplied (ssreflectionMain.glsl output 0)
uniform sampler2D tHalfData; // r = hit distance, g = roughness (output 1)
uniform vec2 traceOffset;    // full-resolution pixel of each 2x2 block traced in this frame (0 or 1 per axis)
uniform vec2 fullSize;       // size of this pass's target (the G-buffer at sizeMultiplier 1)

varying vec2 vUv;

void main() {
    float depth;
    vec3 normal;
    getDepthNormal(vUv, depth, normal);
    if (depth >= 0.999) {
        outReflection = vec4(0.);
        outReflectionData = vec4(0., 1., 0., 0.);
        return;
    }

    #if defined(GBUFFER_HAS_FLAGS) && GBUFFER_HAS_FLAGS == 1
    float roughness = texture2D(tGBufferFlags, vUv).x;
    #else
    float roughness = 0.3;
    #endif

    float viewZ = depthToViewZ(depth);
    vec3 viewPos = screenToView3(vUv, viewZ);
    normal = normalize(normal);
    float planeTolerance = 0.02 * abs(viewZ);

    vec2 pixel = floor(vUv * fullSize);
    vec2 base = floor((pixel - traceOffset) * 0.5);
    ivec2 halfMax = textureSize(tHalf, 0) - 1;

    vec4 sum = vec4(0.);
    float weightSum = 0.;
    float distanceSum = 0.;
    float distanceWeight = 0.;
    for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
            ivec2 q = clamp(ivec2(base) + ivec2(x, y), ivec2(0), halfMax);
            vec2 traced = 2.0 * vec2(q) + traceOffset;
            vec2 tracedUv = (traced + 0.5) / fullSize;
            float tracedDepth;
            vec3 tracedNormal;
            getDepthNormal(tracedUv, tracedDepth, tracedNormal);
            if (tracedDepth >= 0.999) continue;
            vec3 tracedPos = screenToView3(tracedUv, depthToViewZ(tracedDepth));
            float wPlane = exp(-abs(dot(normal, tracedPos - viewPos)) / planeTolerance);
            float wNormal = pow(max(0., dot(normal, normalize(tracedNormal))), 32.);
            vec2 d = traced - pixel;
            float w = wPlane * wNormal / (1. + dot(d, d));
            vec4 c = texelFetch(tHalf, q, 0);
            float hitDistance = texelFetch(tHalfData, q, 0).r;
            sum += w * c;
            weightSum += w;
            if (hitDistance > 0.) {
                distanceSum += w * hitDistance;
                distanceWeight += w;
            }
        }
    }

    outReflection = weightSum > 1e-4 ? sum / weightSum : vec4(0.);
    outReflectionData = vec4(distanceWeight > 1e-4 ? distanceSum / distanceWeight : 0., roughness, 0., 0.);
}
