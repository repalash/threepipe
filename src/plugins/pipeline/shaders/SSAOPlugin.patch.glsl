
#ifndef USE_TRANSMISSION

#if defined(SSAO_ENABLED) && SSAO_ENABLED > 0

// note: depth can also be sampled and used when SSAO_PACKING = 1.

// reads channel R, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
float ambientOcclusion = tSSAOMapTexelToLinear ( texture2D( tSSAOMap, viewToScreen(vViewPosition.xyz).xy )).r; //todo: check encoding for tSSAOMap

reflectedLight.indirectDiffuse *= ambientOcclusion;

#if defined( USE_ENVMAP )

float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );

reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );

#endif

#else
#include <aomap_fragment>
#endif

#endif

