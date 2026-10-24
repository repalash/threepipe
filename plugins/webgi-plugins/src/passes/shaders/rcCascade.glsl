// Radiance cascades, one cascade (RadianceCascadesGI.ts). The passes run from the last cascade down to cascade 0; each
// texel traces its own distance interval through the depth buffer and, where the interval hits nothing, appends the
// merged result of cascade n + 1 behind it (Sannikov, "Radiance Cascades", 2023).
//
// Output (one texel = one direction of one probe):
//   rgb - radiance arriving at the probe from this direction cone, from the start of this cascade's interval to the
//         end of the last one
//   a   - transmittance over the same range: 1 when nothing on screen blocks the cone, 0 when it is blocked
// A hit reads its radiance from the previous final frame (tLastFrame), as the SSGI trace does, so light bounces once
// more on every frame. A ray that leaves the screen ends as a miss (the environment light, which the materials apply
// scaled by the transmittance, stands in for what is off screen).

layout(location = 0) out highp vec4 outRadiance;

// tUpper (declared by the pass): merged atlas of cascade n + 1
uniform float cascadeIndex;
uniform float cascadeCount;
uniform float intervalScale;   // cascade 0 interval end, in cascade 0 probe spacings (world size at the probe depth)
uniform float tolerance;       // thickness assumed behind each visible surface, in 3% of its depth
// Depth pyramid (rcHiZ.glsl, packed by rcHiZPack.glsl): level k >= 1 at x = hizOffset[k] of tHiZ, r = nearest linear
// depth of the 2^k x 2^k pixels; level 0 is the G-buffer itself.
uniform sampler2D tHiZ;
uniform float hizOffset[8];
uniform float hizLevels; // number of pyramid levels above 0 (at most 6)

#define RC_MAX_ITERATIONS 64

float rcNearest(int level, ivec2 cell) {
    return texelFetch(tHiZ, ivec2(int(hizOffset[level]) + cell.x, cell.y), 0).r;
}

// Marches [t0, t1] along dir from origin (view space) through the depth pyramid: a cell whose nearest surface is
// behind the whole ray segment inside it is skipped in one step, and the next step tries a cell twice as large;
// otherwise the march descends a level, down to single pixels, where a hit needs the surface within the ray's depth
// over that pixel plus a thin layer behind it. So a long interval costs a few dozen steps and still stops at thin
// walls, and a ray that passes behind a thin object near the camera is not blocked by it.
// Returns rgb = hit radiance, a = 0 on a hit; a = 1 on a miss; a = 2 when the ray left the screen or the view.
vec4 rcTrace(vec3 origin, vec3 dir, float t0, float t1) {
    if (dir.z > 0.0) t1 = min(t1, (-cameraNearFar.x - origin.z) / dir.z);
    if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 2.0);
    vec3 a = origin + dir * t0, b = origin + dir * t1;
    vec2 sA = viewToScreen3(a).xy * rcScreenSize, sB = viewToScreen3(b).xy * rcScreenSize;
    float iA = -1.0 / a.z, iB = -1.0 / b.z; // inverse linear depth is linear in screen space
    vec2 d = sB - sA;
    float len = max(length(d), 1e-3);
    vec2 invD = vec2(abs(d.x) > 1e-6 ? 1.0 / d.x : 1e6, abs(d.y) > 1e-6 ? 1.0 / d.y : 1e6);
    float lambda = 0.0;
    int level = 0;
    int maxLevel = int(hizLevels);
    for (int i = 0; i < RC_MAX_ITERATIONS; i++) {
        if (lambda >= 1.0) break;
        vec2 sp = sA + d * lambda;
        if (sp.x < 0.0 || sp.y < 0.0 || sp.x >= rcScreenSize.x || sp.y >= rcScreenSize.y) return vec4(0.0, 0.0, 0.0, 2.0);
        float cell = exp2(float(level));
        vec2 cellIdx = floor(sp / cell);
        vec2 boundary = (cellIdx + step(0.0, d)) * cell;
        vec2 lam = (boundary - sp) * invD;
        float lamNext = min(1.0, lambda + max(min(lam.x, lam.y), 0.0) + 0.01 / len);
        float dStart = 1.0 / (iA + (iB - iA) * lambda);
        float dEnd = 1.0 / (iA + (iB - iA) * lamNext);
        float rayFar = max(dStart, dEnd), rayNear = min(dStart, dEnd);
        if (level > 0) {
            if (rayFar < rcNearest(level, ivec2(cellIdx))) {
                lambda = lamNext;
                level = min(level + 1, maxLevel);
            } else level--;
            continue;
        }
        vec2 uv = (cellIdx + 0.5) / rcScreenSize;
        float depth = getDepth(uv);
        float sceneD = depth > 0.999 ? 1e9 : -depthToViewZ(depth);
        if (rayFar >= sceneD && rayNear <= sceneD * (1.0 + 0.03 * tolerance)) return vec4(rcHitRadiance(uv, dir), 0.0);
        lambda = lamNext;
        if (rayFar < sceneD) level = min(1, maxLevel); // in front of this pixel: try larger cells again
    }
    return vec4(0.0, 0.0, 0.0, 1.0);
}

#ifdef RC_WORLD
uniform float worldCascade; // first cascade traced in world space
#endif

// Merged radiance of cascade n + 1 for the cone of direction cell d of a probe of cascade n at pixel position px:
// the 2x2 child cells of d, averaged, on the 4 upper probes around px, interpolated bilinearly. An upper probe on
// another surface (far from this probe's tangent plane) gets a lower weight, so light does not leak across edges.
vec4 rcUpper(ivec2 d, vec2 px, vec3 probePos, vec3 probeNormal, float spacing) {
    float upperSpacing = spacing * 2.0;
    ivec2 upperGrid = rcProbeGrid(upperSpacing);
    vec2 g = px / upperSpacing - 0.5;
    ivec2 base = ivec2(floor(g));
    vec2 f = g - vec2(base);
    vec4 sum = vec4(0.0);
    float wSum = 0.0;
    vec4 plainSum = vec4(0.0);
    for (int i = 0; i < 4; i++) {
        ivec2 o = ivec2(i & 1, i >> 1);
        ivec2 up = clamp(base + o, ivec2(0), upperGrid - 1);
        float wb = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
        vec2 upUv = rcProbeUv(up, upperSpacing);
        float upDepth = getDepth(upUv);
        float wd = 0.0;
        if (upDepth < 0.999) {
            vec3 upPos = screenToView3(upUv, depthToViewZ(upDepth));
            float plane = abs(dot(probeNormal, upPos - probePos));
            wd = exp(-plane / (0.02 * abs(probePos.z) + 1e-4));
        }
        vec4 c = vec4(0.0);
        for (int j = 0; j < 4; j++) {
            ivec2 child = d * 2 + ivec2(j & 1, j >> 1);
            c += texelFetch(tUpper, child * upperGrid + up, 0);
        }
        c *= 0.25;
        plainSum += wb * c;
        sum += wb * wd * c;
        wSum += wb * wd;
    }
    return wSum > 1e-3 ? sum / wSum : plainSum;
}

#ifdef RC_GRID
// World probe grid (rcGrid.glsl): an interval that starts at least gridMinT from the probe reads the grid instead of
// tracing: the 8 grid probes around the interval's start point, trilinear, without probes inside geometry; the
// direction cell nearest to the ray. The grid holds everything beyond gridStart of its probes, so no merge follows.
uniform sampler2D tGrid;
uniform sampler2D tGridValid;
uniform float gridMinT;

vec4 rcSampleGrid(vec3 p, vec3 dir) {
    vec3 g = (p - gridMin) / gridCell - 0.5;
    ivec3 b = ivec3(floor(g));
    vec3 f = g - vec3(b);
    ivec3 maxG = ivec3(gridDims) - 1;
    int side = int(gridDirSide);
    ivec2 dc = min(ivec2(rcSphereToSquare(dir) * gridDirSide), ivec2(side - 1));
    vec4 sum = vec4(0.0);
    float wSum = 0.0;
    for (int k = 0; k < 8; k++) {
        ivec3 o = ivec3(k & 1, (k >> 1) & 1, k >> 2);
        ivec3 q = clamp(b + o, ivec3(0), maxG);
        ivec2 tile = rcGridTile(q);
        float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y) * (o.z == 1 ? f.z : 1.0 - f.z);
        w *= texelFetch(tGridValid, tile, 0).r;
        sum += w * texelFetch(tGrid, tile * side + dc, 0);
        wSum += w;
    }
    return wSum > 1e-4 ? sum / wSum : vec4(0.0, 0.0, 0.0, 1.0);
}
#endif

void main() {
    ivec2 texel = ivec2(gl_FragCoord.xy);
    float spacing = probeSpacing * exp2(cascadeIndex);
    float side = dirSide * exp2(cascadeIndex);
    ivec2 grid = rcProbeGrid(spacing);
    ivec2 d = texel / grid;
    ivec2 probe = texel - d * grid;
    if (d.x >= int(side) || d.y >= int(side)) {
        outRadiance = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    vec2 uv = rcProbeUv(probe, spacing);
    float depth;
    vec3 normal;
    getDepthNormal(uv, depth, normal);
    if (depth > 0.999) {
        outRadiance = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    float viewZ = depthToViewZ(depth);
    vec3 n = normalize(normal);
    vec3 pos = screenToView3(uv, viewZ);
    vec3 dirWorld = rcSquareToSphere((vec2(d) + 0.5) / side);
    vec3 dir = normalize(mat3(rcViewMatrix) * dirWorld);

    // Intervals grow 4x per cascade: cascade 0 covers [0, e], cascade n covers [e 4^(n-1), e 4^n], where e is
    // intervalScale probe spacings at the probe depth. The last cascade runs to the edge of the screen.
    float e = intervalScale * probeSpacing * rcPixelSize(viewZ);
    float t0 = cascadeIndex < 0.5 ? 0.0 : e * exp2(2.0 * cascadeIndex - 2.0);
    bool last = cascadeIndex > cascadeCount - 1.5;
    float t1 = last ? 1e6 : e * exp2(2.0 * cascadeIndex);
    if (last) t1 = min(t1, 4.0 * abs(viewZ) / projection[1][1] * 4.0); // a few screen heights at this depth

    // Start a little off the surface against self-hits; directions below the surface see the surface itself.
    vec3 origin = pos + n * (0.5 * rcPixelSize(viewZ) + 0.002 * abs(viewZ));
    vec4 r;
    #ifdef RC_GRID
    if (t0 >= gridMinT) {
        outRadiance = dot(dir, n) < -0.2 ? vec4(0.0) : rcSampleGrid((rcInverseViewMatrix * vec4(origin, 1.0)).xyz + dirWorld * t0, dirWorld);
        return;
    }
    #endif
    if (dot(dir, n) < -0.2) r = vec4(0.0); // into the surface: blocked, no light
    else {
        #ifdef RC_WORLD
        if (cascadeIndex > worldCascade - 0.5) r = rcTraceWorld((rcInverseViewMatrix * vec4(origin, 1.0)).xyz, dirWorld, t0, last ? 1e6 : t1);
        else
        #endif
        r = rcTrace(origin, dir, t0, t1);
        if (r.a > 1.5) r.a = 1.0; // left the screen: a miss
    }
    if (r.a > 0.5 && !last) {
        vec4 upper = rcUpper(d, uv * rcScreenSize, pos, n, spacing);
        r = vec4(upper.rgb, upper.a);
    }
    outRadiance = r;
}
