// Pretty much the same as meshnormal.glsl.js in three.js with minor changes.

//#/include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

#glMarker importsEnd

#define DEPTH_NORMAL
#define IS_DEPTH_MATERIAL

varying vec3 vViewPosition;

#ifdef USE_ALPHAMAP
#define USE_UV // see todo in GBufferMaterialOverride updateMaterialDefines
#endif

void main() {

    #include <uv_vertex>
	#include <batching_vertex>

    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <normal_vertex>

    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    #include <displacementmap_vertex>
    #include <project_vertex>
    #include <logdepthbuf_vertex>
    #include <clipping_planes_vertex>

    #glMarker beforeOutput

    vViewPosition = - mvPosition.xyz;

}
