// World probe grid of the radiance cascades GI (RadianceCascadesWorld.ts, proof of concept B2). A regular grid of probes
// over the scene bounds; each probe stores gridDirSide^2 directions (the equal-area octahedral cells of rcCommon.glsl)
// of the light arriving from beyond gridStart: rgb = radiance, a = transmittance (1 = the ray left the scene). Diffuse
// far-field light does not depend on the view, so the grid is traced over several frames and screen cascades with long
// intervals read it instead of tracing the BVH themselves.
// Layout: probe i (x fastest, then y, then z) is the tile (i % gridTilesX, i / gridTilesX) of gridDirSide^2 texels.

uniform vec3 gridMin;      // world position of the corner of cell (0, 0, 0)
uniform vec3 gridCell;     // cell size
uniform vec3 gridDims;     // probes per axis
uniform float gridTilesX;  // probe tiles per atlas row
uniform float gridDirSide; // directions per side of a probe's octahedral map

// Inverse of rcSquareToSphere (PBRT-v4 EqualAreaSphereToSquare).
vec2 rcSphereToSquare(vec3 d) {
    vec3 a = abs(d);
    float r = sqrt(max(0.0, 1.0 - a.z));
    float mx = max(a.x, a.y), mn = min(a.x, a.y);
    float b = mx == 0.0 ? 0.0 : mn / mx;
    float phi = atan(b) * 0.6366197723675814;
    if (a.x < a.y) phi = 1.0 - phi;
    float v = phi * r;
    float u = r - v;
    if (d.z < 0.0) { float t = u; u = 1.0 - v; v = 1.0 - t; }
    u = d.x < 0.0 ? -u : u;
    v = d.y < 0.0 ? -v : v;
    return vec2(0.5 * (u + 1.0), 0.5 * (v + 1.0));
}

ivec2 rcGridTile(ivec3 g) {
    int i = g.x + int(gridDims.x) * (g.y + int(gridDims.y) * g.z);
    int tx = int(gridTilesX);
    return ivec2(i - (i / tx) * tx, i / tx);
}

ivec3 rcGridProbe(int i) {
    int nx = int(gridDims.x), ny = int(gridDims.y);
    return ivec3(i - (i / nx) * nx, (i / nx) - ((i / nx) / ny) * ny, i / (nx * ny));
}

vec3 rcGridProbePos(ivec3 g) {
    return gridMin + (vec3(g) + 0.5) * gridCell;
}
