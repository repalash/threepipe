// Sky visibility volume (SkyVisibilityVolume.ts), bake: one texel per probe of a regular grid over the scene bounds.
// Each probe casts svvRays rays (a spherical Fibonacci set) through the scene BVH and projects "the ray escapes the
// scene" onto L1 spherical harmonics: rgba = (V00, V1-1, V10, V11), the order of shBasisL1 in svvSample.glsl.
// An open sky gives (4 pi Y00, 0, 0, 0) = (3.5449, 0, 0, 0). The result does not depend on the environment map, so
// rotating or swapping the environment needs no new bake.
// A probe inside geometry (more than a quarter of its rays hit a back face within two cells) writes V00 = -1; the
// lookup leaves it out, so walls do not leak the sky of the other side.
// svvFill writes the open-sky value instead (the start value of probes that are not baked yet).

layout(location = 0) out highp vec4 outVisibility;
uniform BVH bvh;
uniform sampler2D tBvhNormal;
uniform vec3 svvMin;
uniform vec3 svvCell;
uniform vec3 svvDims;
uniform float svvTilesX;
uniform float svvRays;
uniform bool svvFill;

void main() {
    if (svvFill) { outVisibility = vec4(3.5449077, 0.0, 0.0, 0.0); return; }
    ivec2 tile = ivec2(gl_FragCoord.xy);
    int nx = int(svvDims.x), ny = int(svvDims.y);
    int i = tile.x + tile.y * int(svvTilesX);
    if (i >= nx * ny * int(svvDims.z)) { outVisibility = vec4(-1.0, 0.0, 0.0, 0.0); return; }
    ivec3 g = ivec3(i - (i / nx) * nx, (i / nx) - ((i / nx) / ny) * ny, i / (nx * ny));
    vec3 p = svvMin + (vec3(g) + 0.5) * svvCell;
    float reach = 2.0 * max(svvCell.x, max(svvCell.y, svvCell.z));
    int n = int(svvRays);
    vec4 sh = vec4(0.0);
    int back = 0;
    for (int k = 0; k < 256; k++) {
        if (k >= n) break;
        // spherical Fibonacci point k of n
        float z = 1.0 - (2.0 * float(k) + 1.0) / float(n);
        float r = sqrt(max(0.0, 1.0 - z * z));
        float phi = 2.399963229728653 * float(k);
        vec3 dir = vec3(r * cos(phi), z, r * sin(phi));
        uvec4 fi; vec3 fn, bc; float sd, dist;
        if (bvhIntersectFirstHit(bvh, p, dir, fi, fn, bc, sd, dist)) {
            if (dist < reach && dot(textureSampleBarycoord(tBvhNormal, bc, fi.xyz).xyz, dir) > 0.0) back++;
            continue;
        }
        sh += vec4(0.282095, 0.488603 * dir.y, 0.488603 * dir.z, 0.488603 * dir.x);
    }
    outVisibility = 4 * back > n ? vec4(-1.0, 0.0, 0.0, 0.0) : sh * (12.566370614359172 / float(n));
}
