// One iteration of the edge-avoiding a-trous wavelet filter (Dammertz et al., HPG 2010) with the
// variance-guided luminance weight of SVGF (Schied et al., HPG 2017).
//
// Inputs: tColor   - signal to filter (rgb + a)
//         tMoments - a = variance of the accumulated signal, b = history length (from temporalAccumulate)
// The B-spline kernel (3x3 with ATROUS_RADIUS 1, 5x5 with 2) is spread by stepSize pixels; running it with
// stepSize 1, 2, 4, ... widens the filter at constant cost per iteration.

varying vec2 vUv;

#ifndef ATROUS_RADIUS
#define ATROUS_RADIUS 1
#endif

uniform vec2 screenSize;
uniform float stepSize;
uniform float phiLuminance; // luminance tolerance in standard deviations
uniform float phiNormal;    // exponent of the normal weight
uniform float phiDepth;     // depth tolerance in pixel footprints per pixel of offset

#ifdef REFLECTION_MODE
uniform sampler2D tReflectionData; // r = hit distance (0: no hit), g = roughness (see ssreflectionMain.glsl)
#endif

float signalLuminance(const in vec4 c) {
    return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)) + c.a;
}

void main() {
    vec4 center = tColorTexelToLinear(texture2D(tColor, vUv));
    float depth;
    vec3 normal;
    getDepthNormal(vUv, depth, normal);
    if (depth > 0.999) {
        gl_FragColor = center;
        return;
    }

    vec2 texel = 1.0 / screenSize;

    float viewZ = depthToViewZ(depth);
    vec3 viewPos = screenToView3(vUv, viewZ);
    vec3 n = normalize(normal);
    // World size of one pixel at this depth (perspective).
    float pixelSize = 2.0 * abs(viewZ) / (projection[1][1] * screenSize.y);

    #ifdef REFLECTION_MODE
    // A reflection is only as blurry as its lobe on screen. The lobe widens with the roughness (about roughness^2) and
    // with the distance to the reflected surface, so reflections stay sharp near a contact (the blur of the AMD
    // FidelityFX reflection denoiser scales the same way). An iteration whose step is wider is skipped: mirrors stay
    // sharp, and in motion (short history, high variance) glossy reflections do not smear across the floor.
    vec4 reflectionData = texture2D(tReflectionData, vUv);
    float roughness = reflectionData.g;
    float lobeDistance = reflectionData.r > 0.0 ? reflectionData.r : 0.25 * abs(viewZ); // no hit: a quarter of the depth
    float maxStep = max(1.0, roughness * roughness * lobeDistance / pixelSize);
    if (stepSize > maxStep) {
        gl_FragColor = center;
        return;
    }
    #endif

    // 3x3 Gaussian of the variance at the center, as in SVGF, so a single dark sample does not stop the filter.
    float variance = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            float k = (x == 0 ? 0.5 : 0.25) * (y == 0 ? 0.5 : 0.25);
            variance += k * tMomentsTexelToLinear(texture2D(tMoments, vUv + vec2(float(x), float(y)) * texel)).a;
        }
    }

    float centerLum = signalLuminance(center);
    float lumScale = 1.0 / (phiLuminance * sqrt(max(variance, 0.0)) + 1e-4);

    vec4 sum = center;
    float weightSum = 1.0;
    float kernel[3];
    #if ATROUS_RADIUS == 1
    kernel[0] = 0.5; kernel[1] = 0.25; kernel[2] = 0.0;
    #else
    kernel[0] = 0.375; kernel[1] = 0.25; kernel[2] = 0.0625;
    #endif

    for (int y = -ATROUS_RADIUS; y <= ATROUS_RADIUS; y++) {
        for (int x = -ATROUS_RADIUS; x <= ATROUS_RADIUS; x++) {
            if (x == 0 && y == 0) continue;
            vec2 offset = vec2(float(x), float(y)) * stepSize;
            vec2 uv = vUv + offset * texel;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;

            float d;
            vec3 nq;
            getDepthNormal(uv, d, nq);
            if (d > 0.999) continue;
            vec3 pq = screenToView3(uv, depthToViewZ(d));
            vec4 cq = tColorTexelToLinear(texture2D(tColor, uv));

            float wNormal = pow(max(0.0, dot(n, normalize(nq))), phiNormal);
            float planeDistance = abs(dot(n, pq - viewPos));
            float wDepth = exp(-planeDistance / (phiDepth * pixelSize * length(offset) + 1e-6));
            float wLum = exp(-abs(signalLuminance(cq) - centerLum) * lumScale);

            int ax = x < 0 ? -x : x;
            int ay = y < 0 ? -y : y;
            float w = kernel[ax] * kernel[ay] / (kernel[0] * kernel[0]) * wNormal * wDepth * wLum;
            #ifdef REFLECTION_MODE
            w *= exp(-20.0 * abs(texture2D(tReflectionData, uv).g - roughness)); // no blur across roughness edges
            #endif
            sum += cq * w;
            weightSum += w;
        }
    }

    gl_FragColor = sum / weightSum;
}
