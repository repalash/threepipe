// Sky visibility volume (SkyVisibilityVolume.ts), lookup in the material shader. The 8 probes around a point,
// trilinear, without probes inside geometry (V00 < 0) and with less weight for probes behind the surface, so a wall
// does not take the sky of its outer side. The point moves half a cell along its normal first (off the surface it
// sits on). Outside the grid the edge probes are used; with no valid probe the point counts as open sky.
uniform sampler2D tSkyVis;
uniform vec3 svvMin;
uniform vec3 svvCell;
uniform vec3 svvDims;
uniform float svvTilesX;

// Atlas texel and weight of probe k (0..7) around p; the weight is 0 for a probe inside geometry.
float svvProbe(vec3 p, vec3 n, int k, out ivec2 texel, out vec4 vis) {
    vec3 g = (p + n * 0.5 * svvCell - svvMin) / svvCell - 0.5;
    ivec3 b = ivec3(floor(g));
    vec3 f = g - vec3(b);
    ivec3 o = ivec3(k & 1, (k >> 1) & 1, k >> 2);
    ivec3 q = clamp(b + o, ivec3(0), ivec3(svvDims) - 1);
    int i = q.x + int(svvDims.x) * (q.y + int(svvDims.y) * q.z);
    int tx = int(svvTilesX);
    texel = ivec2(i - (i / tx) * tx, i / tx);
    vis = texelFetch(tSkyVis, texel, 0);
    if (vis.x < 0.0) return 0.0;
    vec3 w3 = mix(1.0 - f, f, vec3(o));
    vec3 toProbe = svvMin + (vec3(q) + 0.5) * svvCell - p;
    float facing = dot(normalize(toProbe + 1e-5), n) * 0.5 + 0.5;
    return w3.x * w3.y * w3.z * (facing * facing + 0.05);
}

vec4 svvLookup(vec3 p, vec3 n) {
    vec4 sum = vec4(0.0);
    float wSum = 0.0;
    for (int k = 0; k < 8; k++) {
        ivec2 texel; vec4 vis;
        float w = svvProbe(p, n, k, texel, vis);
        sum += w * vis;
        wSum += w;
    }
    return wSum > 1e-5 ? sum / wSum : vec4(3.5449077, 0.0, 0.0, 0.0);
}

#ifdef SVV_FAR
// Far bounce light at p (SkyVisibilityVolume.farLight): L1 spherical harmonics per color channel, same weights.
uniform sampler2D tFarR;
uniform sampler2D tFarG;
uniform sampler2D tFarB;
void svvLookupFar(vec3 p, vec3 n, out vec4 r, out vec4 g, out vec4 b) {
    r = vec4(0.0); g = vec4(0.0); b = vec4(0.0);
    float wSum = 0.0;
    for (int k = 0; k < 8; k++) {
        ivec2 texel; vec4 vis;
        float w = svvProbe(p, n, k, texel, vis);
        if (w <= 0.0) continue;
        r += w * texelFetch(tFarR, texel, 0);
        g += w * texelFetch(tFarG, texel, 0);
        b += w * texelFetch(tFarB, texel, 0);
        wSum += w;
    }
    float s = wSum > 1e-5 ? 1.0 / wSum : 0.0;
    r *= s; g *= s; b *= s;
}
#endif

// Visibility of the sky over a cosine lobe around n (diffuse): (V00 Y00 + 2/3 V1 . Y1(n)), 1 for an open sky.
float svvDiffuse(vec4 sh, vec3 n) {
    return clamp(0.282095 * sh.x + 0.325735 * (sh.y * n.y + sh.z * n.z + sh.w * n.x), 0.0, 1.0);
}

// Visibility around direction d with lobe factor k (1 = the L1 field itself, for a narrow specular lobe; 2/3 = cosine).
float svvDirectional(vec4 sh, vec3 d, float k) {
    return clamp(0.282095 * sh.x + k * 0.488603 * (sh.y * d.y + sh.z * d.z + sh.w * d.x), 0.0, 1.0);
}
