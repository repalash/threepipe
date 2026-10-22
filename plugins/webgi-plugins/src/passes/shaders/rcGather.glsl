// Radiance cascades, final gather (RadianceCascadesGI.ts): the GI buffer at each pixel from the merged cascade 0.
//
// Output (the contract of the SSGI trace, see ssgiTrace.glsl and giPatch.glsl):
//   rgb - mean incoming radiance over the cosine-weighted hemisphere of the pixel normal (irradiance / PI); the
//         material multiplies it by its diffuse color
//   a   - occluded fraction of the same hemisphere; the material scales its environment light by (1 - a)^power
// The 4 cascade-0 probes around the pixel are interpolated bilinearly, with a lower weight for probes off the pixel's
// tangent plane or with another normal. Every direction cell has the same solid angle, so the hemisphere integral is
// the cosine-weighted mean over the cells.

layout(location = 0) out highp vec4 outGI;
layout(location = 1) out highp vec4 outGradient; // zero: lets the pass write the SSGI raw target (signal + gradient)

varying vec2 vUv;
// tCascade0 (declared by the pass): the merged cascade 0 atlas
#ifdef RC_GATHER_SH
uniform sampler2D tProbeSH; // rcProbeSH.glsl
#endif

void main() {
    float depth;
    vec3 normal;
    getDepthNormal(vUv, depth, normal);
    outGradient = vec4(0.0);
    if (depth > 0.999) {
        outGI = vec4(0.0);
        return;
    }
    float viewZ = depthToViewZ(depth);
    vec3 pos = screenToView3(vUv, viewZ);
    vec3 n = normalize(normal);
    vec3 nWorld = normalize(mat3(rcInverseViewMatrix) * n);

    ivec2 grid = rcProbeGrid(probeSpacing);
    vec2 g = vUv * rcScreenSize / probeSpacing - 0.5;
    ivec2 base = ivec2(floor(g));
    vec2 f = g - vec2(base);
    int side = int(dirSide);

    vec4 sum = vec4(0.0);
    float wSum = 0.0;
    vec4 nearest = vec4(0.0, 0.0, 0.0, 1.0);
    float nearestW = -1.0;
    for (int i = 0; i < 4; i++) {
        ivec2 o = ivec2(i & 1, i >> 1);
        ivec2 p = clamp(base + o, ivec2(0), grid - 1);
        vec2 pUv = rcProbeUv(p, probeSpacing);
        float pDepth;
        vec3 pNormal;
        getDepthNormal(pUv, pDepth, pNormal);
        if (pDepth > 0.999) continue;
        vec3 pPos = screenToView3(pUv, depthToViewZ(pDepth));
        float wb = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
        float plane = abs(dot(n, pPos - pos));
        float wg = exp(-plane / (0.01 * abs(viewZ) + 1e-4)) * pow(max(0.0, dot(n, normalize(pNormal))), 8.0);

        // Cosine-weighted mean of the probe's radiance and transmittance over the pixel's hemisphere.
        #ifdef RC_GATHER_SH
        // From the probe's L1 spherical harmonics (rcProbeSH.glsl): irradiance / pi = c0 Y00 + 2/3 (c1 . Y1(n)).
        vec4 acc = 0.282095 * texelFetch(tProbeSH, ivec2(4 * p.x, p.y), 0) + (2.0 / 3.0) * 0.488603 * (
            nWorld.y * texelFetch(tProbeSH, ivec2(4 * p.x + 1, p.y), 0) +
            nWorld.z * texelFetch(tProbeSH, ivec2(4 * p.x + 2, p.y), 0) +
            nWorld.x * texelFetch(tProbeSH, ivec2(4 * p.x + 3, p.y), 0));
        acc = max(acc, vec4(0.0));
        acc.a = min(acc.a, 1.0);
        #else
        vec4 acc = vec4(0.0);
        float cosSum = 0.0;
        for (int y = 0; y < 16; y++) {
            if (y >= side) break;
            for (int x = 0; x < 16; x++) {
                if (x >= side) break;
                vec3 dir = rcSquareToSphere((vec2(x, y) + 0.5) / dirSide);
                float c = dot(dir, nWorld);
                if (c <= 0.0) continue;
                acc += c * texelFetch(tCascade0, ivec2(x, y) * grid + p, 0);
                cosSum += c;
            }
        }
        acc /= max(cosSum, 1e-4);
        #endif
        sum += wb * wg * acc;
        wSum += wb * wg;
        if (wb * wg > nearestW) { nearestW = wb * wg; nearest = acc; }
    }
    vec4 r = wSum > 1e-4 ? sum / wSum : nearest;
    outGI = vec4(r.rgb, 1.0 - r.a);
    #ifdef RC_DEBUG_FALLBACK
    outGI = vec4(wSum > 1e-4 ? vec3(0.0) : vec3(1.0, 0.0, 0.0), 0.0);
    #endif
}
