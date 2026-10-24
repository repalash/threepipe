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

    #ifdef USE_INSTANCING

    mvPosition = instanceMatrix * mvPosition;

    #endif

    vWorldPosition = (modelMatrix * mvPosition).xyz;
    vWorldPositionPrevious = (modelMatrixPrevious * mvPosition).xyz;

    mvPosition = modelViewMatrix * mvPosition;

    gl_Position = projectionMatrix * mvPosition;

    #include <logdepthbuf_vertex>
    #include <clipping_planes_vertex>

    //    vViewPosition = - mvPosition.xyz;

}
