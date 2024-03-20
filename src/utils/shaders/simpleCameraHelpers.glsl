#ifndef SIMPLE_CAMERA_HELPERS
#define SIMPLE_CAMERA_HELPERS
#ifndef USE_TRANSMISSION
uniform mat4 projectionMatrix;
#endif
vec3 viewToScreen(const in vec3 pos) {
    vec4 projected = projectionMatrix * vec4(pos, 1.0);
    return vec3(0.5 + 0.5 * projected.xy / projected.w, projected.w);
}
#endif
