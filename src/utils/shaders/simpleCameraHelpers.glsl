#ifndef SIMPLE_CAMERA_HELPERS
#define SIMPLE_CAMERA_HELPERS
#ifndef USE_TRANSMISSION
uniform mat4 projectionMatrix;
#endif
vec3 viewToScreen(const in vec3 pos) {
    vec4 projected = projectionMatrix * vec4(pos, 1.0);
    return vec3(0.5 + 0.5 * projected.xy / projected.w, projected.w);
}
vec3 screenToView(const in vec2 uv, const in float viewZ) {
    vec2 uv_ = 2. * uv - 1.;
    float xe = -(uv_.x + projectionMatrix[2][0]) * viewZ / projectionMatrix[0][0];
    float ye = -(uv_.y + projectionMatrix[2][1]) * viewZ / projectionMatrix[1][1];
    return vec3(xe, ye, viewZ);
}
#endif
