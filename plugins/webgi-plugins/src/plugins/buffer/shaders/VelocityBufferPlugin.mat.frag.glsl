#ifdef USE_ALPHAMAP
#define USE_UV
#include <packing>
uniform sampler2D alphaMap;
uniform float alphaTest;
#endif
#include <uv_pars_fragment>

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
    // alpha test like the GBuffer material, so cut-out texels do not write the mesh's motion
    #ifdef USE_ALPHAMAP
    float alphaMapValue =
    #ifdef ALPHA_I_RGBA_PACKING
    1. - unpackRGBAToDepth( texture2D( alphaMap, vAlphaMapUv ) );
    #else
    texture2D( alphaMap, vAlphaMapUv ).g;
    #endif
    if ( alphaMapValue < alphaTest ) discard;
    #endif

    vec2 velocity = clamp(computeScreenSpaceVelocity2(), -1.0, 1.0);
    velocity = sign(velocity) * pow(abs(velocity), vec2(1./4.));
    velocity = velocity * 0.5 + 0.5;
    gl_FragColor = vec4(velocity.x, velocity.y, 1., 1.);

    //    float speed = length(computeScreenSpaceVelocity2());
    //    gl_FragColor = vec4(speed, speed, speed, 1.);
}
