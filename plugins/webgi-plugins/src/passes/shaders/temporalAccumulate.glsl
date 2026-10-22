// Temporal accumulation with reprojection, after the temporal part of SVGF
// (Schied et al., "Spatiotemporal Variance-Guided Filtering", HPG 2017).
//
// Inputs:  tRaw          - this frame's noisy signal (rgb + a)
//          tHistColor    - accumulated signal of the last frame
//          tHistMoments  - last frame's moments: r = mean, g = mean of squares (of the luminance signal),
//                          b = history length in frames
//          tPrevNormalDepth - last frame's G-buffer depth and normal (same packing as tNormalDepth)
//          tGradient     - temporal gradient of the trace, when hasGradient is true: rgb = change of the light over the
//                          same rays since the last frame (in the units of tRaw), a = its level (see ssgiTrace.glsl)
//          tReflectionData - REFLECTION_MODE only: r = hit distance of the reflection rays (view units, 0: no hit),
//                          g = roughness (see ssreflectionMain.glsl)
// Outputs: location 0 - accumulated signal
//          location 1 - moments (r, g, b as above) and a = variance estimate for the spatial filter

layout(location = 0) out highp vec4 outColor;
layout(location = 1) out highp vec4 outMoments;

varying vec2 vUv;

uniform sampler2D tPrevNormalDepth;
uniform vec2 screenSize;

uniform mat4 inverseViewMatrix;       // current view -> world
uniform mat4 lastProjectionViewMatrix; // previous world -> clip
uniform mat4 prevInverseViewMatrix;    // previous view -> world
uniform mat4 prevProjection;
uniform vec2 prevCameraNearFar;

uniform bool historyValid;  // false on the first frame, after a resize, or after a camera switch
uniform bool staticFrame;   // true when nothing changed since the last frame (no reprojection needed)
uniform float maxHistory;   // history length cap in frames
uniform float historyCap;   // cap of the history length taken over from the last frame (first still frame after motion)
uniform float momentsAlphaMin; // minimum blend weight of the moments
uniform float planeTolerance;  // reprojection test: allowed distance from the tangent plane, relative to depth
uniform float normalTolerance; // reprojection test: minimum cosine between the normals
uniform float antiLag;         // > 0 shortens the history where the new samples disagree with it
uniform sampler2D tGradient;
uniform bool hasGradient;
uniform float gradientAntiLag;   // strength of the gradient anti-lag and history shift; 0 turns both off
uniform float gradientThreshold; // relative change of the light below which the history is kept

// Relative change of the samples below which the history shift ignores the gradient (residual flicker, jitter).
#define SHIFT_THRESHOLD 0.02

#ifdef REFLECTION_MODE
uniform sampler2D tReflectionData;
uniform float historyClamp; // > 0 clamps the history to the 3x3 mean +- historyClamp standard deviations of the new samples
uniform float parallaxHistory; // shortens the history by the surface/reflection parallax relative to the lobe footprint
#endif

#ifdef HAS_VELOCITY_BUFFER
#pragma <velocity_unpack>
#else
#define HAS_VELOCITY_BUFFER 0
#endif

float signalLuminance(const in vec4 c) {
    return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)) + c.a;
}

vec3 prevScreenToView(const in vec2 uv, const in float viewZ) {
    vec2 ndc = 2.0 * uv - 1.0;
    float x = -(ndc.x + prevProjection[2][0]) * viewZ / prevProjection[0][0];
    float y = -(ndc.y + prevProjection[2][1]) * viewZ / prevProjection[1][1];
    return vec3(x, y, viewZ);
}

void main() {
    float depth;
    vec3 normal;
    getDepthNormal(vUv, depth, normal);
    vec4 raw = tRawTexelToLinear(texture2D(tRaw, vUv));

    if (depth > 0.999) {
        outColor = vec4(0.0);
        outMoments = vec4(0.0);
        return;
    }

    float viewZ = depthToViewZ(depth);
    vec3 viewPos = screenToView3(vUv, viewZ);
    vec3 worldPos = (inverseViewMatrix * vec4(viewPos, 1.0)).xyz;
    vec3 worldNormal = normalize(mat3(inverseViewMatrix) * normalize(normal));

    // Spatial statistics of the new samples in a 3x3 window: the variance fallback for short histories,
    // and the reference for the anti-lag test.
    vec2 texel = 1.0 / screenSize;
    float sum1 = 0.0, sum2 = 0.0;
    vec4 m1 = vec4(0.0), m2 = vec4(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec4 c = tRawTexelToLinear(texture2D(tRaw, vUv + vec2(float(x), float(y)) * texel));
            float l = signalLuminance(c);
            sum1 += l;
            sum2 += l * l;
            m1 += c;
            m2 += c * c;
        }
    }
    m1 /= 9.0;
    m2 /= 9.0;
    float spatialMean = sum1 / 9.0;
    float spatialVariance = max(0.0, sum2 / 9.0 - spatialMean * spatialMean);

    // Previous screen position.
    vec2 prevUv = vUv;
    float localMaxHistory = maxHistory;
    if (!staticFrame) {
        #if HAS_VELOCITY_BUFFER == 1
        prevUv = vUv - getVelocity(vUv);
        #else
        vec4 prevClip = lastProjectionViewMatrix * vec4(worldPos, 1.0);
        prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;
        #endif

        #ifdef REFLECTION_MODE
        // A reflection moves with the reflected point, not with the surface (Stachowiak 2015): reproject the virtual
        // point behind the surface, on the camera ray continued by the hit distance. Exact for mirrors; for glossy
        // reflections it is still closer than the surface motion (measured on the ssrGloss floor at roughness 0.2-0.5).
        // A pixel where no ray hit in this frame takes the mean hit distance of its neighbors (9 taps, 2 pixels apart):
        // with the surface motion, the pixels next to a moving reflection would fetch the place where it was and
        // smear it. Only where nothing around hit, the surface motion applies.
        float hitDistance = texture2D(tReflectionData, vUv).r;
        if (hitDistance <= 0.0) {
            float distanceSum = 0.0, hitTaps = 0.0;
            for (int y = -1; y <= 1; y++) {
                for (int x = -1; x <= 1; x++) {
                    float d = texture2D(tReflectionData, vUv + vec2(float(x), float(y)) * 2.0 * texel).r;
                    distanceSum += d;
                    hitTaps += d > 0.0 ? 1.0 : 0.0;
                }
            }
            hitDistance = hitTaps > 0.0 ? distanceSum / hitTaps : 0.0;
        }
        if (hitDistance > 0.0) {
            vec3 virtualWorld = (inverseViewMatrix * vec4(viewPos + normalize(viewPos) * hitDistance, 1.0)).xyz;
            vec4 virtualClip = lastProjectionViewMatrix * vec4(virtualWorld, 1.0);
            vec2 virtualUv = virtualClip.xy / virtualClip.w * 0.5 + 0.5;
            // A glossy reflection moves only roughly with the virtual point. The history gets shorter where the
            // parallax between the surface and the reflected point is large against the size of the reflection lobe
            // on screen (roughness^2 x hit distance): a blurry reflection hides more misregistration. Both are in
            // pixels, so the ratio does not depend on the resolution.
            float roughness = texture2D(tReflectionData, vUv).g;
            float pixelSize = 2.0 * abs(viewZ) / (projection[1][1] * screenSize.y);
            float footprint = max(1.0, roughness * roughness * hitDistance / pixelSize);
            float parallax = length((virtualUv - prevUv) * screenSize);
            localMaxHistory = max(1.0, maxHistory / (1.0 + parallaxHistory * parallax / footprint));
            prevUv = virtualUv;
        }
        #endif
    }

    // Bilinear history fetch where each of the 4 taps must lie on the same surface: close to this
    // pixel's tangent plane and with a similar normal. Rejected taps drop out of the weights.
    vec4 histColor = vec4(0.0);
    vec3 histMoments = vec3(0.0);
    float weightSum = 0.0;
    if (historyValid) {
        vec2 pos = prevUv * screenSize - 0.5;
        vec2 base = floor(pos);
        vec2 fr = pos - base;
        float pixelDepth = abs(viewZ);
        for (int i = 0; i < 4; i++) {
            vec2 o = vec2(float(i - (i / 2) * 2), float(i / 2));
            vec2 tapUv = (base + o + 0.5) * texel;
            if (tapUv.x < 0.0 || tapUv.x > 1.0 || tapUv.y < 0.0 || tapUv.y > 1.0) continue;
            vec4 nd = texture2D(tPrevNormalDepth, tapUv);
            float prevDepth = unpackDepth(nd.xy);
            if (prevDepth > 0.999) continue;
            float prevViewZ = -mix(prevCameraNearFar.x, prevCameraNearFar.y, prevDepth);
            vec3 prevWorldPos = (prevInverseViewMatrix * vec4(prevScreenToView(tapUv, prevViewZ), 1.0)).xyz;
            vec3 prevWorldNormal = normalize(mat3(prevInverseViewMatrix) * unpackNormal(nd.zw));
            float planeDistance = abs(dot(worldNormal, prevWorldPos - worldPos));
            if (planeDistance > planeTolerance * pixelDepth) continue;
            if (dot(worldNormal, prevWorldNormal) < normalTolerance) continue;
            float w = (o.x > 0.5 ? fr.x : 1.0 - fr.x) * (o.y > 0.5 ? fr.y : 1.0 - fr.y);
            histColor += w * tHistColorTexelToLinear(texture2D(tHistColor, tapUv));
            histMoments += w * texture2D(tHistMoments, tapUv).rgb;
            weightSum += w;
        }
    }

    float rawLum = signalLuminance(raw);
    float historyLength = 0.0;
    float lambda = 0.0;
    if (weightSum > 1e-3) {
        histColor /= weightSum;
        histMoments /= weightSum;
        historyLength = min(histMoments.b, historyCap);

        #ifdef REFLECTION_MODE
        // Neighborhood clamp (as in TAA and the AMD FidelityFX reflection denoiser): a reflection that left this pixel
        // (a moving object, a wrong reprojection) cannot stay in the history. The 3x3 statistics are only reliable
        // where most pixels have a hit (a = coverage, 1 where a ray hit): in the sparse tails of glossy reflections a
        // window often has no hit at all, and a full clamp there would pull the history to black.
        // The coverage itself is the exception: a window with few or no hits does bound it from above, so a history
        // with more coverage than the window allows (its mean + historyClamp deviations + 0.1) is scaled down, color
        // and coverage together (premultiplied). This removes the ghost of a reflection that moved away.
        if (historyClamp > 0.0 && !staticFrame) {
            vec4 sigma = sqrt(max(vec4(0.0), m2 - m1 * m1));
            vec4 clamped = clamp(histColor, m1 - historyClamp * sigma, m1 + historyClamp * sigma);
            histColor = mix(histColor, clamped, smoothstep(0.2, 0.6, m1.a));
            float maxCoverage = m1.a + historyClamp * sigma.a + 0.1;
            if (histColor.a > maxCoverage) histColor *= maxCoverage / histColor.a;
        }
        #endif

        // Temporal gradient, after A-SVGF (Schied et al., "Gradient Estimation for Real-Time Adaptive Temporal
        // Filtering", HPG 2018), averaged over 9 taps 2 pixels apart (a 5x5 area).
        if (hasGradient && gradientAntiLag > 0.0) {
            vec4 g = vec4(0.0);
            for (int y = -1; y <= 1; y++) {
                for (int x = -1; x <= 1; x++) {
                    g += texture2D(tGradient, vUv + vec2(float(x), float(y)) * 2.0 * texel);
                }
            }
            g /= 9.0;

            // 1. History shift. The gradient is the change of the expected sample at this pixel, so adding it moves
            //    the history to the new light without dropping samples. This lets the bounce light settle through the
            //    bounces: each bounce reads the last frame, so after a light change the input keeps changing for a few
            //    frames, by amounts too small to reset the history. A soft threshold keeps residual flicker out.
            vec3 shift = sign(g.rgb) * max(abs(g.rgb) - SHIFT_THRESHOLD * g.a, 0.0) * gradientAntiLag;
            vec3 shifted = max(histColor.rgb + shift, 0.0);
            // The moments move by the shift that applied, so the variance stays.
            float lumShift = dot(shifted - histColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            histColor.rgb = shifted;
            histMoments.g += (2.0 * histMoments.r + lumShift) * lumShift;
            histMoments.r += lumShift;

            // 2. Anti-lag. lambda grows with the fraction of the light that changed above gradientThreshold (1 when
            //    all of it changed); the blend weight of the new sample becomes (1 - lambda) / historyLength + lambda.
            //    A large change (a light moved, a shadow appeared) shortens the history, where the blurred shift above
            //    is not exact enough.
            float relative = max(max(abs(g.r), abs(g.g)), abs(g.b)) / max(g.a, 1e-4);
            lambda = clamp(gradientAntiLag * (relative - gradientThreshold) / (1.0 - gradientThreshold), 0.0, 1.0);
        }

        if (antiLag > 0.0) {
            // Where the new samples clearly disagree with the history (a light moved, a shadow appeared),
            // shorten the history so the change shows up in a few frames instead of maxHistory frames.
            float histLum = signalLuminance(histColor);
            float sigma = sqrt(spatialVariance) / 3.0 + 0.05 * max(histLum, spatialMean) + 0.01;
            float disagreement = abs(spatialMean - histLum) / sigma;
            float keep = clamp(1.0 - (disagreement - 2.0) * 0.25 * antiLag, 0.0, 1.0);
            historyLength = min(historyLength, max(1.0, maxHistory * keep));
        }
    }

    historyLength = min(historyLength + 1.0, localMaxHistory);
    historyLength = 1.0 / ((1.0 - lambda) / historyLength + lambda);
    float alpha = 1.0 / historyLength;
    float alphaMoments = max(alpha, momentsAlphaMin);

    vec4 color = historyLength > 1.0 ? mix(histColor, raw, alpha) : raw;
    vec2 moments = historyLength > 1.0 ?
        mix(histMoments.rg, vec2(rawLum, rawLum * rawLum), alphaMoments) :
        vec2(rawLum, rawLum * rawLum);

    // Variance of one sample: from the temporal moments once the history is long enough, from the 3x3
    // window before. Dividing by the history length gives the variance of the accumulated mean, so the
    // spatial filter gets weaker as samples accumulate and a still image converges without blur.
    float sampleVariance = max(0.0, moments.g - moments.r * moments.r);
    if (historyLength < 4.0) sampleVariance = max(sampleVariance, spatialVariance * (4.0 - historyLength) / 3.0);
    float variance = sampleVariance / historyLength;

    outColor = color;
    outMoments = vec4(moments, historyLength, variance);
}
