// SSGI ray trace: one noisy estimate per pixel, denoised afterwards by SpatioTemporalDenoiser.
//
// Output rgba:
//   rgb - mean incoming radiance over cosine-weighted rays that hit a surface on screen, weighted by the
//         distance falloff. The material multiplies it by the diffuse color (see giPatch.glsl), which is
//         the Lambert estimator for cosine-weighted directions.
//   a   - occluded fraction of the cosine-weighted hemisphere, with the same weights. The material
//         scales its environment (indirect) diffuse by (1 - a)^power.
//
// A hit reads its radiance from the previous final frame (tLastFrame) at the reprojected position, so
// light bounces once more on every frame. Rays that leave the screen or hit nothing count as misses.
//
// Output 1 (temporal gradient, after A-SVGF: Schied et al., "Gradient Estimation for Real-Time Adaptive Temporal
// Filtering", HPG 2018): each hit also reads the frame before the last one (tPrevLastFrame) at the same surface
// point (exact for static geometry; a moving object is assumed to keep its velocity). The difference of the two
// reads is how much the light arriving over this ray changed. Both reads use the same ray, so the difference has
// almost none of the ray noise, and the denoiser can tell a light change from noise in the first frame that shows it.
// The raw target is half float, so the change can be negative.
//   rgb - mean change of the radiance (last frame minus the frame before), with the same weights as output 0
//   a   - mean of the larger of the two radiances (max over channels), to normalize the change

layout(location = 0) out highp vec4 outRadiance;
layout(location = 1) out highp vec4 outGradient;

varying vec2 vUv;

uniform sampler2D tPrevLastFrame; // final frame before tLastFrame
uniform bool gradientValid;       // false when tPrevLastFrame does not hold the frame before tLastFrame
uniform mat4 lastLastProjectionViewMatrix;

uniform float frameIndex; // free-running frame counter, used to change the noise on every frame
uniform float objectRadius;
uniform bool autoRadius;
uniform float maxScreenRadius; // upper bound of the ray length, in screen heights at the pixel depth
uniform float rayCount;
uniform float bias;
uniform float falloff;
uniform float tolerance;
uniform float radianceClamp;
uniform bool staticFrame; // true when the camera and scene did not change since the last frame
uniform vec2 screenSize;

uniform mat4 lastProjectionViewMatrix;
uniform mat4 inverseViewMatrix;

#ifndef D_sceneBoundingRadius
#define D_sceneBoundingRadius
uniform float sceneBoundingRadius;
#endif

#ifdef HAS_VELOCITY_BUFFER
#pragma <velocity_unpack>
#else
#define HAS_VELOCITY_BUFFER 0
#endif

#ifndef RTAO_STEP_COUNT
#define RTAO_STEP_COUNT 8
#endif

#define SSGI_MAX_RAYS 8
#define SSGI_REFINE_STEPS 3

// Orthonormal basis around a unit vector without branches on its direction.
// Duff et al., "Building an Orthonormal Basis, Revisited", JCGT 6(1), 2017.
void ssgiBasis(const in vec3 n, out vec3 t, out vec3 b) {
    float s = n.z >= 0.0 ? 1.0 : -1.0;
    float a = -1.0 / (s + n.z);
    float c = n.x * n.y * a;
    t = vec3(1.0 + s * n.x * n.x * a, s * c, -s * n.x);
    b = vec3(c, s + n.y * n.y * a, -n.y);
}

// Cosine-weighted direction in the hemisphere around z (pdf = cos(theta) / PI).
vec3 ssgiCosineSample(const in vec2 u) {
    float r = sqrt(u.x);
    float phi = 6.283185307179586 * u.y;
    return vec3(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.x)));
}

// Previous-frame screen position of a surface point at uv, to read tLastFrame.
vec2 ssgiPreviousUv(const in vec2 uv, const in vec3 viewPos) {
    if (staticFrame) return uv;
    #if HAS_VELOCITY_BUFFER == 1
    return uv - getVelocity(uv);
    #else
    vec4 worldPos = inverseViewMatrix * vec4(viewPos, 1.0);
    vec4 prevClip = lastProjectionViewMatrix * worldPos;
    return prevClip.xy / prevClip.w * 0.5 + 0.5;
    #endif
}

float ssgiSceneViewZ(const in vec2 uv) {
    return depthToViewZ(getDepth(uv));
}

// March from origin along dir up to length rayLen in view space. The samples are spaced quadratically, so
// they are dense near the origin (contact occlusion) and sparse far away (long-range bounce).
// Returns the hit distance along the ray, or -1 for a miss. hitUv is set on a hit.
float ssgiTrace(const in vec3 origin, const in vec3 dir, const in float rayLen, const in float jitter, out vec2 hitUv) {
    float tPrev = 0.0;
    float iSteps = 1.0 / float(RTAO_STEP_COUNT);
    for (int k = 0; k < RTAO_STEP_COUNT; k++) {
        float s = (float(k) + jitter) * iSteps;
        float t = rayLen * s * s;
        vec3 q = origin + dir * t;
        if (q.z > -cameraNearFar.x) break; // behind the near plane
        vec2 uv = viewToScreen3(q).xy;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        float dz = ssgiSceneViewZ(uv) - q.z; // > 0 when the ray point is behind the visible surface
        float thickness = tolerance * (abs(q.z) * 0.02 + (t - tPrev));
        if (dz > 0.0 && dz < thickness) {
            // Bisection between the last point in front and this point behind the surface.
            float lo = tPrev, hi = t;
            for (int r = 0; r < SSGI_REFINE_STEPS; r++) {
                float mid = 0.5 * (lo + hi);
                vec3 qm = origin + dir * mid;
                vec2 uvm = viewToScreen3(qm).xy;
                if (ssgiSceneViewZ(uvm) - qm.z > 0.0) hi = mid;
                else lo = mid;
            }
            hitUv = viewToScreen3(origin + dir * hi).xy;
            return hi;
        }
        tPrev = t;
    }
    return -1.0;
}

void main() {
    float depth;
    vec3 normal;
    getDepthNormal(vUv, depth, normal);

    if (depth > 0.999) {
        outRadiance = vec4(0.0);
        outGradient = vec4(0.0);
        return;
    }

    float viewZ = depthToViewZ(depth);
    vec3 viewPos = screenToView3(vUv, viewZ);
    vec3 n = normalize(normal);
    vec3 t, b;
    ssgiBasis(n, t, b);

    // Auto: relative to the scene diameter, so objectRadius = 1 lets rays cross the whole scene.
    float rayLen = autoRadius ? 2.0 * objectRadius * sceneBoundingRadius : objectRadius;
    // At most maxScreenRadius screen heights at this depth (projection[2][3] is 0 for orthographic cameras).
    float screenHeight = 2.0 * (projection[2][3] != 0.0 ? abs(viewZ) : 1.0) / projection[1][1];
    rayLen = max(min(rayLen, maxScreenRadius * screenHeight), 1e-4);

    // Offset the origin along the normal against self-intersection from depth quantization.
    vec3 origin = viewPos + n * abs(viewZ) * max(0.0, 0.002 + bias * 0.05);

    // Per-pixel noise that changes on every frame. The azimuth uses interleaved gradient noise (a
    // well-distributed screen pattern that the spatial filter removes easily), the other dimension uses a
    // hash. Each extra ray adds the R2 low-discrepancy offsets (Roberts, 2018).
    // The pattern repeats every 64 frames; each block of 64 is shifted by a golden-ratio offset, so a still
    // image keeps getting new samples past 64 frames.
    float f = mod(frameIndex, 64.0);
    float block = floor(frameIndex / 64.0);
    vec2 u0 = fract(vec2(
        random3(vec3(gl_FragCoord.xy, f + 0.5)),
        interleavedGradientNoise(gl_FragCoord.xy, f)
    ) + block * vec2(0.6180339887, 0.4142135624));
    float stepJitter = interleavedGradientNoise(gl_FragCoord.yx + 17.0, f);

    vec3 radiance = vec3(0.0);
    float occlusion = 0.0;
    float rays = 0.0;
    #ifdef SSGI_FAR_LIGHT
    // Light from surfaces that the screen does not show (SkyVisibilityVolume.farLight), for the rays that miss.
    vec4 farR, farG, farB;
    svvLookupFar((inverseViewMatrix * vec4(viewPos, 1.0)).xyz, normalize(mat3(inverseViewMatrix) * n), farR, farG, farB);
    #endif
    vec3 change = vec3(0.0);
    float level = 0.0;
    for (int i = 0; i < SSGI_MAX_RAYS; i++) {
        if (float(i) >= rayCount) break;
        vec2 u = fract(u0 + float(i) * vec2(0.7548776662, 0.5698402910));
        vec3 l = ssgiCosineSample(u);
        vec3 dir = t * l.x + b * l.y + n * l.z;
        float jitter = fract(stepJitter + float(i) * 0.6180339887);
        rays += 1.0;

        vec2 hitUv;
        float hitT = ssgiTrace(origin, dir, rayLen, jitter, hitUv);
        if (hitT < 0.0) {
            #ifdef SSGI_FAR_LIGHT
            vec3 dw = mat3(inverseViewMatrix) * dir;
            vec4 y = vec4(0.282095, 0.488603 * dw.y, 0.488603 * dw.z, 0.488603 * dw.x);
            radiance += max(vec3(dot(farR, y), dot(farG, y), dot(farB, y)), vec3(0.0));
            #endif
            continue;
        }

        // Backfaces occlude but send no light.
        vec3 hitNormal = getViewNormal(hitUv);
        float facing = step(0.0, -dot(hitNormal, dir));

        // Optional distance falloff, applied to the occlusion and the light alike so they stay consistent.
        float x = hitT / rayLen;
        float w = falloff > 0.0 ? pow(clamp(1.0 - x * x, 0.0, 1.0), falloff) : 1.0;

        vec3 hitViewPos = screenToView3(hitUv, ssgiSceneViewZ(hitUv));
        vec2 prevUv = ssgiPreviousUv(hitUv, hitViewPos);
        vec3 hitRadiance = vec3(0.0);
        if (prevUv.x >= 0.0 && prevUv.x <= 1.0 && prevUv.y >= 0.0 && prevUv.y <= 1.0) {
            hitRadiance = tLastFrameTexelToLinear(texture2D(tLastFrame, prevUv)).rgb;
            // One NaN or Inf pixel in the frame (a material bug) would spread through the history and the filter
            // into large black blocks: read it as no light.
            if (any(isnan(hitRadiance)) || any(isinf(hitRadiance))) hitRadiance = vec3(0.0);
            // Clamp bright samples (specular highlights, emitters) to keep fireflies out of the history.
            float lum = dot(hitRadiance, vec3(0.2126, 0.7152, 0.0722));
            hitRadiance *= min(1.0, radianceClamp / max(lum, 1e-4));

            if (gradientValid) {
                // The same surface point one frame earlier: the camera motion from the matrices, plus the object
                // motion of the last frame (velocity buffer minus camera motion), assumed constant.
                vec4 hitWorld = inverseViewMatrix * vec4(hitViewPos, 1.0);
                vec4 c1 = lastProjectionViewMatrix * hitWorld;
                vec4 c2 = lastLastProjectionViewMatrix * hitWorld;
                vec2 objectMotion = staticFrame ? vec2(0.0) : prevUv - (c1.xy / c1.w * 0.5 + 0.5);
                vec2 prevPrevUv = c2.xy / c2.w * 0.5 + 0.5 + objectMotion;
                if (prevPrevUv.x >= 0.0 && prevPrevUv.x <= 1.0 && prevPrevUv.y >= 0.0 && prevPrevUv.y <= 1.0) {
                    vec3 older = tLastFrameTexelToLinear(texture2D(tPrevLastFrame, prevPrevUv)).rgb;
                    if (any(isnan(older)) || any(isinf(older))) older = vec3(0.0);
                    older *= min(1.0, radianceClamp / max(dot(older, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
                    change += (hitRadiance - older) * (w * facing);
                    level += max(max(max(hitRadiance.r, hitRadiance.g), hitRadiance.b), max(max(older.r, older.g), older.b)) * (w * facing);
                }
            }
        }
        radiance += hitRadiance * (w * facing);
        occlusion += w;
    }

    rays = max(rays, 1.0);
    outRadiance = vec4(radiance / rays, occlusion / rays);
    outGradient = vec4(change / rays, level / rays);
}
