
uniform mat4 inverseViewMatrix;

vec3 getWorldPositionFromViewZ(const in vec2 uv, const in float viewDepth) {
    vec2 uv_ = 2. * uv - 1.;
    float xe = -(uv_.x + projection[2][0]) * viewDepth/projection[0][0];
    float ye = -(uv_.y + projection[2][1]) * viewDepth/projection[1][1];
    return (inverseViewMatrix * vec4(xe, ye, viewDepth, 1.)).xyz;
}
