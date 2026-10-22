// Traces the world probe grid (rcGrid.glsl) through the scene BVH (rcWorldTrace.glsl). Each frame updates a band of
// probe rows (a scissor on the atlas); a probe inside geometry (tGridValid r = 0) is skipped by the lookup, so its
// texels are not traced.

layout(location = 0) out highp vec4 outRadiance;
uniform float gridStart; // rays start this far from the probe
uniform sampler2D tGridValid;

void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    int side = int(gridDirSide);
    ivec2 tile = t / side;
    ivec2 d = t - tile * side;
    int i = tile.x + tile.y * int(gridTilesX);
    if (i >= int(gridDims.x * gridDims.y * gridDims.z) || texelFetch(tGridValid, tile, 0).r < 0.5) {
        outRadiance = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    vec3 p = rcGridProbePos(rcGridProbe(i));
    vec3 dir = rcSquareToSphere((vec2(d) + 0.5) / gridDirSide);
    vec4 r = rcTraceWorld(p, dir, gridStart, 1e6);
    outRadiance = vec4(r.rgb, r.a > 0.5 ? 1.0 : 0.0);
}
