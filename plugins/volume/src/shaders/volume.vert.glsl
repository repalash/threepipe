// Volume ray march: vertex shader.
// The box is drawn with its back faces, so the ray also starts when the camera is inside the box.
// Everything the fragment shader needs is linear in the vertex position, so it interpolates exactly.

varying vec3 vOrigin;      // ray origin, object space
varying vec3 vDirection;   // ray direction, object space, not normalized
varying vec3 vOriginView;  // ray origin, view space
varying vec3 vDirectionView; // ray direction, view space, same parametrization as vDirection

uniform vec3 uBoxSize;

#include <common>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {
    mat4 invModel = inverse(modelMatrix);
    if (isOrthographic) {
        // every ray has the camera's forward direction; start it behind the box
        vec3 forwardWorld = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vDirection = (invModel * vec4(forwardWorld, 0.0)).xyz;
        vOrigin = position - vDirection * 4.0 * dot(abs(uBoxSize), vec3(1.0)) / max(length(vDirection), 1e-6);
    } else {
        vOrigin = (invModel * vec4(cameraPosition, 1.0)).xyz;
        vDirection = position - vOrigin;
    }
    vOriginView = (modelViewMatrix * vec4(vOrigin, 1.0)).xyz;
    vDirectionView = (modelViewMatrix * vec4(vDirection, 0.0)).xyz;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    #include <logdepthbuf_vertex>
    #include <clipping_planes_vertex>
}
