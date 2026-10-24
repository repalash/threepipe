// Light at a ray hit that the screen shows (radiance cascades, RadianceCascadesGI.ts): the last final frame
// (tLastFrame, declared by the pass) at the reprojected position, as the SSGI trace does. Shared by the cascade pass and
// the world probe grid update.

uniform float radianceClamp;
uniform bool staticFrame;
uniform mat4 lastProjectionViewMatrix;

#ifdef HAS_VELOCITY_BUFFER
#pragma <velocity_unpack>
#else
#define HAS_VELOCITY_BUFFER 0
#endif


float rcSceneViewZ(vec2 uv) {
    return depthToViewZ(getDepth(uv));
}

vec2 rcPreviousUv(vec2 uv, vec3 viewPos) {
    if (staticFrame) return uv;
    #if HAS_VELOCITY_BUFFER == 1
    return uv - getVelocity(uv);
    #else
    vec4 prevClip = lastProjectionViewMatrix * (rcInverseViewMatrix * vec4(viewPos, 1.0));
    return prevClip.xy / prevClip.w * 0.5 + 0.5;
    #endif
}

// Light leaving the surface seen at uv towards a ray with direction dir (view space): the last final frame there.
// Back faces block the ray but send no light.
vec3 rcHitRadiance(vec2 uv, vec3 dir) {
    if (dot(getViewNormal(uv), dir) > 0.0) return vec3(0.0);
    vec2 prevUv = rcPreviousUv(uv, screenToView3(uv, rcSceneViewZ(uv)));
    if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) return vec3(0.0);
    vec3 c = tLastFrameTexelToLinear(texture2D(tLastFrame, prevUv)).rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return c * min(1.0, radianceClamp / max(lum, 1e-4));
}
