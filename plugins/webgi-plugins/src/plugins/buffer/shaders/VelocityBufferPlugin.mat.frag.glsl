varying vec3 vWorldPosition;
varying vec3 vWorldPositionPrevious;
uniform mat4 currentProjectionViewMatrix;
uniform mat4 lastProjectionViewMatrix;

vec2 computeScreenSpaceVelocity2() {
    vec4 currentPositionClip = currentProjectionViewMatrix * vec4(vWorldPosition, 1.0);
    vec4 prevPositionClip = lastProjectionViewMatrix * vec4(vWorldPositionPrevious, 1.0);

    vec2 currentPositionNDC = currentPositionClip.xy / currentPositionClip.w;
    vec2 prevPositionNDC = prevPositionClip.xy / prevPositionClip.w;

    if(prevPositionNDC.x >= 1.0 || prevPositionNDC.x <= -1.0 || prevPositionNDC.x >= 1.0 || prevPositionNDC.y <= -1.0) {
        return vec2(0.0);
    }
    return 0.5 * (currentPositionNDC - prevPositionNDC);
}

void main() {
    vec2 velocity = clamp(computeScreenSpaceVelocity2(), -1.0, 1.0);
    velocity = sign(velocity) * pow(abs(velocity), vec2(1./4.));
    velocity = velocity * 0.5 + 0.5;
    gl_FragColor = vec4(velocity.x, velocity.y, 1., 1.);

    //    float speed = length(computeScreenSpaceVelocity2());
    //    gl_FragColor = vec4(speed, speed, speed, 1.);
}
