// Shared helpers of the radiance cascades GI (RadianceCascadesGI.ts).
//
// Layout of a cascade atlas, direction first: cascade n has probes every (probeSpacing << n) screen pixels and
// (dirSide << n)^2 directions per probe. Texel (d * probeGrid + p) holds direction d of probe p, so every direction
// is one screen-shaped tile of the atlas. The directions are the cells of an equal-area octahedral map of the sphere
// (Clarberg, "Fast Equal-Area Mapping of the (Hemi)Sphere using SIMD", JGT 2008; the form of PBRT-v4,
// EqualAreaSquareToSphere): every cell has the same solid angle, and the 2x2 cells of cascade n + 1 inside a cell of
// cascade n split its cone exactly, so merging and integrating are plain averages.
// Directions are in world space, so the cascades do not change when the camera only rotates.

uniform vec2 rcScreenSize;   // size of the G-buffer / GI target in pixels
uniform float probeSpacing;  // cascade 0 probe spacing in pixels
uniform float dirSide;       // cascade 0 directions per side of the octahedral map
uniform mat4 rcViewMatrix;   // world -> view
uniform mat4 rcInverseViewMatrix; // view -> world

vec3 rcSquareToSphere(vec2 p) {
    vec2 uv = 2.0 * p - 1.0;
    vec2 a = abs(uv);
    float signedDistance = 1.0 - (a.x + a.y);
    float r = 1.0 - abs(signedDistance);
    float phi = (r == 0.0 ? 1.0 : (a.y - a.x) / r + 1.0) * 0.7853981633974483;
    float z = signedDistance >= 0.0 ? 1.0 - r * r : -(1.0 - r * r);
    float s = r * sqrt(max(0.0, 2.0 - r * r));
    return vec3((uv.x >= 0.0 ? 1.0 : -1.0) * cos(phi) * s, (uv.y >= 0.0 ? 1.0 : -1.0) * sin(phi) * s, z);
}

// Probe grid size of cascade n (whole probes covering the screen).
ivec2 rcProbeGrid(float spacing) {
    return ivec2(ceil(rcScreenSize / spacing));
}

// Screen uv of the center of a probe.
vec2 rcProbeUv(ivec2 probe, float spacing) {
    return min((vec2(probe) + 0.5) * spacing, rcScreenSize - 0.5) / rcScreenSize;
}

// World size of one pixel at view depth z (perspective).
float rcPixelSize(float viewZ) {
    return 2.0 * abs(viewZ) / (projection[1][1] * rcScreenSize.y);
}
