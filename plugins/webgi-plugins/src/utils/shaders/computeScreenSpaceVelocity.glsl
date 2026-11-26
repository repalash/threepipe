
uniform mat4 lastProjectionViewMatrix;
uniform mat4 currentProjectionViewMatrix;

vec2 computeScreenSpaceVelocity(const in vec3 worldPosition) {
    vec4 currentPositionClip = currentProjectionViewMatrix * vec4(worldPosition, 1.0);
    vec4 prevPositionClip = lastProjectionViewMatrix * vec4(worldPosition, 1.0);

    vec2 currentPositionNDC = currentPositionClip.xy / currentPositionClip.w;
    vec2 prevPositionNDC = prevPositionClip.xy / prevPositionClip.w;

    if(prevPositionNDC.x >= 1.0 || prevPositionNDC.x <= -1.0 || prevPositionNDC.x >= 1.0 || prevPositionNDC.y <= -1.0) {
        return vec2(0.0);
    }
    return 0.5 * (currentPositionNDC - prevPositionNDC);
}
