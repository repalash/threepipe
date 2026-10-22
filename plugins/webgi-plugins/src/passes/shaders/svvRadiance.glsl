// Sky visibility volume (SkyVisibilityVolume.ts), far radiance bake: the light that arrives at each probe from the
// surfaces around it, one bounce, as L1 spherical harmonics per color channel (outR, outG, outB, each (L00, L1-1,
// L10, L11)). The same rays as the visibility bake; a hit is shaded from its mean albedo (the material table of
// RadianceCascadesWorld): the sun with a shadow ray, the environment through the sky visibility at the hit (this
// volume, svvSample.glsl), and its emission. A miss adds nothing (the environment is the materials' own term).
// The SSGI trace reads it for rays that leave the screen or hit nothing, so light from walls and floors that the
// screen does not show still reaches the pixel. It depends on the sun and the environment: the first bake takes all
// svvRays directions, in bands of rows; after a light change, passes over the whole grid trace every svvStride-th
// direction (from svvOffset) and the pass blends into the stored result, so many short fragments follow a moving sun
// (one fragment with 128 rays in series took ~240 ms per frame on an M4 Pro).

layout(location = 0) out highp vec4 outR;
layout(location = 1) out highp vec4 outG;
layout(location = 2) out highp vec4 outB;
uniform BVH bvh;
uniform sampler2D tBvhNormal;
uniform sampler2D tBvhMaterial; // material index per vertex
uniform sampler2D tMaterials;   // 2 texels per material: mean albedo, emission
uniform vec3 sunDirection;      // world, towards the sun
uniform vec3 sunRadiance;
uniform vec3 envUp;             // mean environment radiance above / below the horizon
uniform vec3 envDown;
uniform float svvRays;
uniform float svvStride; // 1 for the full bake
uniform float svvOffset;
uniform float radianceClamp;

void main() {
    ivec2 tile = ivec2(gl_FragCoord.xy);
    int nx = int(svvDims.x), ny = int(svvDims.y);
    int i = tile.x + tile.y * int(svvTilesX);
    outR = vec4(0.0); outG = vec4(0.0); outB = vec4(0.0);
    if (i >= nx * ny * int(svvDims.z)) return;
    if (texelFetch(tSkyVis, tile, 0).x < 0.0) return; // inside geometry
    ivec3 g = ivec3(i - (i / nx) * nx, (i / nx) - ((i / nx) / ny) * ny, i / (nx * ny));
    vec3 p = svvMin + (vec3(g) + 0.5) * svvCell;
    int n = int(svvRays), stride = int(svvStride), count = 0;
    for (int j = 0; j < 256; j++) {
        int k = j * stride + int(svvOffset);
        if (k >= n) break;
        count++;
        float z = 1.0 - (2.0 * float(k) + 1.0) / float(n);
        float r = sqrt(max(0.0, 1.0 - z * z));
        float phi = 2.399963229728653 * float(k);
        vec3 dir = vec3(r * cos(phi), z, r * sin(phi));
        uvec4 fi; vec3 fn, bc; float sd, dist;
        if (!bvhIntersectFirstHit(bvh, p, dir, fi, fn, bc, sd, dist)) continue;
        vec3 hn = normalize(textureSampleBarycoord(tBvhNormal, bc, fi.xyz).xyz);
        if (dot(hn, dir) > 0.0) continue; // back face: no light
        vec3 hp = p + dir * dist;
        int mi = int(texelFetch1D(tBvhMaterial, fi.x).r + 0.5);
        vec3 albedo = texelFetch(tMaterials, ivec2(2 * mi, 0), 0).rgb;
        vec3 emission = texelFetch(tMaterials, ivec2(2 * mi + 1, 0), 0).rgb;
        float cosSun = dot(hn, sunDirection), sun = 0.0;
        if (cosSun > 0.0) {
            uvec4 fi2; vec3 fn2, bc2; float sd2, d2;
            sun = bvhIntersectFirstHit(bvh, hp + hn * 1e-3 * (1.0 + dist), sunDirection, fi2, fn2, bc2, sd2, d2) ? 0.0 : cosSun;
        }
        float sky = svvDiffuse(svvLookup(hp, hn), hn);
        vec3 c = albedo * (sunRadiance * sun * 0.3183098861837907 + sky * mix(envDown, envUp, hn.y * 0.5 + 0.5)) + emission;
        c *= min(1.0, radianceClamp / max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
        vec4 y = vec4(0.282095, 0.488603 * dir.y, 0.488603 * dir.z, 0.488603 * dir.x);
        outR += c.r * y; outG += c.g * y; outB += c.b * y;
    }
    float s = 12.566370614359172 / float(max(count, 1));
    outR *= s; outG *= s; outB *= s;
}
