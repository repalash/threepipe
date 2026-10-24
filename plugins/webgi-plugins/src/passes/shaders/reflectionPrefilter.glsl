// Reflection prefilter (SpatioTemporalDenoiser reflection mode, before the temporal pass on changing frames).
// The AMD FidelityFX reflection denoiser filters spatially before its temporal pass, so the temporal pass can clamp its
// history against a low-noise neighborhood and keep a long history without lag. This pass does the same: an edge-aware
// blur of the raw reflections over the size of the reflection lobe on screen (roughness^2 x hit distance, in pixels),
// so the radius follows the reflection, not the resolution. The SSR sampler (Blinn-Phong, exponent 2 / roughness^4 - 2)
// spreads its rays over about roughness^2 radians. It also smooths the hit distance (the reprojection uses it)
// and fills it in where no ray hit.
//
// Inputs:  tRaw            - raw reflections (premultiplied, a = coverage; declared by the pass)
//          tReflectionData - r = hit distance in view units (0: no hit), g = roughness
// Outputs: location 0 - prefiltered reflections
//          location 1 - r = smoothed hit distance (0 where nothing around hit), g = roughness

layout(location = 0) out highp vec4 outColor;
layout(location = 1) out highp vec4 outData;

varying vec2 vUv;

uniform vec2 screenSize;
uniform sampler2D tReflectionData;
uniform float frameIndex;  // rotates the sample pattern every frame, so the temporal pass averages it
uniform float radiusScale; // multiplies the lobe footprint
uniform float maxRadius;   // in pixels

#define PREFILTER_SAMPLES 16

float prefilterNoise(const in vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
    ivec2 size = ivec2(screenSize);
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    vec4 center = texelFetch(tRaw, pixel, 0);
    vec4 data = texelFetch(tReflectionData, pixel, 0);
    float depth;
    vec3 normal;
    getDepthNormal(vUv, depth, normal);
    if (depth > 0.999 || data.g >= 0.9) {
        outColor = center;
        outData = data;
        return;
    }
    float roughness = data.g;
    float viewZ = depthToViewZ(depth);
    vec3 viewPos = screenToView3(vUv, viewZ);
    normal = normalize(normal);
    // World size of one pixel at this depth (perspective).
    float pixelSize = 2.0 * abs(viewZ) / (projection[1][1] * screenSize.y);
    float planeTolerance = 0.02 * abs(viewZ);

    // Hit distance for the footprint: this pixel's, else the mean of the neighbors that hit (8 taps, 4 pixels away),
    // else a quarter of the view depth.
    float hitDistance = data.r;
    if (hitDistance <= 0.0) {
        float s = 0.0, n = 0.0;
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                float d = texelFetch(tReflectionData, clamp(pixel + ivec2(x, y) * 4, ivec2(0), size - 1), 0).r;
                s += d;
                n += d > 0.0 ? 1.0 : 0.0;
            }
        }
        hitDistance = n > 0.0 ? s / n : 0.0;
    }
    float footprint = roughness * roughness * (hitDistance > 0.0 ? hitDistance : 0.25 * abs(viewZ)) / pixelSize;
    float radius = clamp(footprint * radiusScale, 1.0, maxRadius);

    // Disk of samples on a golden-angle spiral, rotated per pixel and per frame.
    float angle0 = 6.2831853 * fract(prefilterNoise(gl_FragCoord.xy) + frameIndex * 0.6180339887);
    vec4 sum = center;
    float weightSum = 1.0;
    float distanceSum = data.r > 0.0 ? data.r : 0.0;
    float distanceWeight = data.r > 0.0 ? 1.0 : 0.0;
    for (int i = 0; i < PREFILTER_SAMPLES; i++) {
        float fi = float(i) + 0.5;
        float a = angle0 + fi * 2.39996323;
        float t = sqrt(fi / float(PREFILTER_SAMPLES)); // uniform over the disk
        vec2 offset = vec2(cos(a), sin(a)) * radius * t;
        ivec2 q = pixel + ivec2(floor(offset + 0.5));
        if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y || q == pixel) continue;
        vec2 qUv = (vec2(q) + 0.5) / screenSize;
        float qDepth;
        vec3 qNormal;
        getDepthNormal(qUv, qDepth, qNormal);
        if (qDepth > 0.999) continue;
        vec4 qData = texelFetch(tReflectionData, q, 0);
        vec3 qPos = screenToView3(qUv, depthToViewZ(qDepth));
        // Gaussian falloff (sigma = radius / 2), so the blur adds less than the lobe width to the reflection.
        float w = exp(-2.0 * t * t)
            * exp(-abs(dot(normal, qPos - viewPos)) / planeTolerance)        // same surface
            * pow(max(0.0, dot(normal, normalize(qNormal))), 32.0)          // same orientation
            * exp(-20.0 * abs(qData.g - roughness));                         // same roughness
        sum += w * texelFetch(tRaw, q, 0);
        weightSum += w;
        if (qData.r > 0.0) {
            distanceSum += w * qData.r;
            distanceWeight += w;
        }
    }

    outColor = sum / weightSum;
    outData = vec4(distanceWeight > 0.0 ? distanceSum / distanceWeight : 0.0, roughness, 0.0, 0.0);
}
