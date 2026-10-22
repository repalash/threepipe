// World-space intervals (RadianceCascadesWorld.ts): cascades from worldCascade up trace the scene BVH (three-mesh-bvh)
// instead of the depth buffer, so they see what the screen does not show. A hit that the screen shows (and that is not
// hidden there) reads the last final frame, as the screen trace does; any other hit is shaded from its mean albedo:
// the sun with a shadow ray, the mean environment radiance above/below the horizon where a ray along the normal
// escapes, plus its emission.
uniform BVH bvh;
uniform sampler2D tBvhNormal;   // world normals per vertex
uniform sampler2D tBvhMaterial; // material index per vertex
uniform sampler2D tMaterials;   // 2 texels per material: mean albedo, emission
uniform vec3 sunDirection;      // world, towards the sun
uniform vec3 sunRadiance;       // light color x intensity
uniform vec3 envUp;             // mean environment radiance above the horizon
uniform vec3 envDown;
uniform mat4 rcProjectionView;  // current projection x view

vec4 rcTraceWorld(vec3 originWorld, vec3 dir, float t0, float t1) {
    vec3 o = originWorld + dir * t0;
    uvec4 faceIndices = uvec4(0u);
    vec3 faceNormal = vec3(0.0, 0.0, 1.0);
    vec3 bary = vec3(0.0);
    float side = 1.0, dist = 0.0;
    if (!bvhIntersectFirstHit(bvh, o, dir, faceIndices, faceNormal, bary, side, dist) || dist > t1 - t0)
        return vec4(0.0, 0.0, 0.0, 1.0);
    vec3 p = o + dir * dist;
    vec4 clip = rcProjectionView * vec4(p, 1.0);
    if (clip.w > 0.0) {
        vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
            float hitZ = (rcViewMatrix * vec4(p, 1.0)).z;
            if (abs(rcSceneViewZ(uv) - hitZ) < 0.02 * abs(hitZ)) return vec4(rcHitRadiance(uv, mat3(rcViewMatrix) * dir), 0.0);
        }
    }
    vec3 n = normalize(textureSampleBarycoord(tBvhNormal, bary, faceIndices.xyz).xyz);
    if (dot(n, dir) > 0.0) return vec4(0.0); // back face: blocks, sends no light
    int mi = int(texelFetch1D(tBvhMaterial, faceIndices.x).r + 0.5);
    vec3 albedo = texelFetch(tMaterials, ivec2(2 * mi, 0), 0).rgb;
    vec3 emission = texelFetch(tMaterials, ivec2(2 * mi + 1, 0), 0).rgb;
    float cosSun = dot(n, sunDirection);
    float sun = 0.0;
    if (cosSun > 0.0) {
        uvec4 fi; vec3 fn; vec3 bc; float sd, d2;
        sun = bvhIntersectFirstHit(bvh, p + n * 1e-3 * (1.0 + dist), sunDirection, fi, fn, bc, sd, d2) ? 0.0 : cosSun;
    }
    // Sky light at the hit only when a ray along its normal escapes the scene (inside a room it hits the opposite wall):
    // without this test every surface off screen got the full sky and indoor bounce came out too bright.
    uvec4 fi2; vec3 fn2; vec3 bc2; float sd2, d3;
    float sky = bvhIntersectFirstHit(bvh, p + n * 1e-3 * (1.0 + dist), n, fi2, fn2, bc2, sd2, d3) ? 0.0 : 1.0;
    vec3 c = albedo * (sunRadiance * sun * 0.3183098861837907 + sky * mix(envDown, envUp, n.y * 0.5 + 0.5)) + emission;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return vec4(c * min(1.0, radianceClamp / max(lum, 1e-4)), 0.0);
}
