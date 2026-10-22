// Radiance cascades: projects each cascade-0 probe (dirSide^2 equal-area directions, rcCommon.glsl) onto L1 spherical
// harmonics, so the final gather reads 4 texels per probe instead of every direction. Texel (4 p.x + i, p.y) holds
// coefficient i (Y00, Y1-1 = y, Y10 = z, Y11 = x) of probe p: rgb for the radiance, a for the transmittance.
// Every direction cell has the solid angle 4 pi / N, so the projection is a plain sum.

layout(location = 0) out highp vec4 outSH;

void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    int i = t.x - (t.x / 4) * 4;
    ivec2 p = ivec2(t.x / 4, t.y);
    ivec2 grid = rcProbeGrid(probeSpacing);
    if (p.x >= grid.x || p.y >= grid.y) { outSH = vec4(0.0); return; }
    int side = int(dirSide);
    vec4 sum = vec4(0.0);
    for (int y = 0; y < 16; y++) {
        if (y >= side) break;
        for (int x = 0; x < 16; x++) {
            if (x >= side) break;
            vec3 d = rcSquareToSphere((vec2(x, y) + 0.5) / dirSide);
            float b = i == 0 ? 0.282095 : 0.488603 * (i == 1 ? d.y : i == 2 ? d.z : d.x);
            sum += b * texelFetch(tCascade0, ivec2(x, y) * grid + p, 0);
        }
    }
    outSH = sum * (12.566370614359172 / (dirSide * dirSide));
}
