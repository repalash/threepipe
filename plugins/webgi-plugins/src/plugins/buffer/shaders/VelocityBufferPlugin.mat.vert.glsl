#ifdef USE_ALPHAMAP
#define USE_UV
#endif
#include <uv_pars_vertex>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

//varying vec3 vViewPosition;

varying vec3 vWorldPosition;
varying vec3 vWorldPositionPrevious;

uniform mat4 modelMatrixPrevious;

#ifdef USE_INSTANCING
// the previous frame's instance matrices (VelocityBufferPlugin): 4 texels (columns) per instance, 1024 instances a row
uniform sampler2D instanceMatrixPrevious;
uniform bool hasInstanceMatrixPrevious;
mat4 getInstanceMatrixPrevious() {
    int x = (gl_InstanceID % 1024) * 4, y = gl_InstanceID / 1024;
    return mat4(texelFetch(instanceMatrixPrevious, ivec2(x, y), 0), texelFetch(instanceMatrixPrevious, ivec2(x + 1, y), 0),
        texelFetch(instanceMatrixPrevious, ivec2(x + 2, y), 0), texelFetch(instanceMatrixPrevious, ivec2(x + 3, y), 0));
}
#endif

void main() {

    #include <uv_vertex>
    #include <batching_vertex>
    #include <skinbase_vertex>

    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    #include <displacementmap_vertex>

    // project_vertex

    vec4 mvPosition = vec4( transformed, 1.0 );
    vec4 previousPosition = mvPosition;

    #ifdef USE_INSTANCING

    previousPosition = hasInstanceMatrixPrevious ? getInstanceMatrixPrevious() * mvPosition : instanceMatrix * mvPosition;
    mvPosition = instanceMatrix * mvPosition;

    #endif

    vWorldPosition = (modelMatrix * mvPosition).xyz;
    vWorldPositionPrevious = (modelMatrixPrevious * previousPosition).xyz;

    mvPosition = modelViewMatrix * mvPosition;

    gl_Position = projectionMatrix * mvPosition;

    #include <logdepthbuf_vertex>
    #include <clipping_planes_vertex>

    //    vViewPosition = - mvPosition.xyz;

}
