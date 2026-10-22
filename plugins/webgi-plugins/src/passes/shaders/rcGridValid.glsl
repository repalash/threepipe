// Marks probes of the world grid that sit inside geometry (r = 0): more than a quarter of 14 test rays hit a back face
// within two cells. Their light would leak into the rooms around them, so the lookup leaves them out.

layout(location = 0) out highp vec4 outValid;
uniform BVH bvh;
uniform sampler2D tBvhNormal;

void main() {
    ivec2 tile = ivec2(gl_FragCoord.xy);
    int i = tile.x + tile.y * int(gridTilesX);
    if (i >= int(gridDims.x * gridDims.y * gridDims.z)) { outValid = vec4(0.0); return; }
    vec3 p = rcGridProbePos(rcGridProbe(i));
    float reach = 2.0 * max(gridCell.x, max(gridCell.y, gridCell.z));
    int back = 0;
    for (int k = 0; k < 14; k++) {
        vec3 dir = k < 6 ? vec3(k == 0 ? 1.0 : k == 1 ? -1.0 : 0.0, k == 2 ? 1.0 : k == 3 ? -1.0 : 0.0, k == 4 ? 1.0 : k == 5 ? -1.0 : 0.0)
            : normalize(vec3((k & 1) == 0 ? 1.0 : -1.0, (k & 2) == 0 ? 1.0 : -1.0, (k & 4) == 0 ? 1.0 : -1.0));
        uvec4 fi; vec3 fn, bc; float sd, dist;
        if (bvhIntersectFirstHit(bvh, p, dir, fi, fn, bc, sd, dist) && dist < reach) {
            vec3 n = textureSampleBarycoord(tBvhNormal, bc, fi.xyz).xyz;
            if (dot(n, dir) > 0.0) back++;
        }
    }
    outValid = vec4(back > 3 ? 0.0 : 1.0, 0.0, 0.0, 1.0);
}
