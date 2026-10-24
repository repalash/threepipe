// Applies the SSGI buffer to the material. Replaces three.js aomap_fragment (the plugin removes that include), so
// the material's own occlusion map is applied here too: the darker of the baked and the screen-space occlusion
// wins, so a baked map is never lost and an occluder seen by both is not counted twice.
#if defined(SSRTAO_ENABLED) && SSRTAO_ENABLED > 0

float ambientOcclusion = 1.;
#ifdef USE_AOMAP
// reads channel R, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
#endif

vec3 screenPos_gi = viewToScreen(vViewPosition.xyz);
vec4 ssgi = vec4(0.);
bool ssgiApply = true;
#if SSRTAO_ENABLED == 2 // split mode: the left side shows the material without SSGI
ssgiApply = screenPos_gi.x > ssrtaoSplitX;
#endif

if (ssgiApply) {
    ssgi = tSSGIMapTexelToLinear( texture2D( tSSGIMap, screenPos_gi.xy) );
    float ssgiVisibility = pow(clamp(1. - ssgi.a, 0., 1.), ssaoPower);
    ambientOcclusion = min(ambientOcclusion, ssgiVisibility);
}
// Near occlusion (baked map, screen space), for the specular term below.
float nearOcclusion = ambientOcclusion;

#ifdef SVV_ENABLED
// World sky visibility (SkyVisibilityVolume.ts): far occluders that the screen does not show. The darker of near and
// far wins, as for the baked map, so an occluder that both see is not counted twice.
vec3 svvViewPos = -vViewPosition;
vec3 svvWorldPos = (svvViewPos - viewMatrix[3].xyz) * mat3(viewMatrix); // inverse of a rigid view transform
vec3 svvWorldNormal = normalize(geometryNormal * mat3(viewMatrix));
vec4 svvSH = svvLookup(svvWorldPos, svvWorldNormal);
if (ssgiApply) ambientOcclusion = min(ambientOcclusion, svvDiffuse(svvSH, svvWorldNormal));
#endif

reflectedLight.indirectDiffuse *= ambientOcclusion;

#if defined( USE_CLEARCOAT )
clearcoatSpecularIndirect *= ambientOcclusion;
#endif

#if defined( USE_SHEEN )
sheenSpecularIndirect *= ambientOcclusion;
#endif

#if defined(SSGI_ENABLED) && SSGI_ENABLED > 0
vec3 ssgiColor = ssgi.rgb * ssgiIntensity;
reflectedLight.indirectDiffuse += ssgiColor * (material.diffuseColor.rgb);
#endif

#if defined( USE_ENVMAP )

float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
// computeSpecularOcclusion of three.js
float specularOcclusion = saturate( pow( dotNV + nearOcclusion, exp2( - 16.0 * material.roughness - 1.0 ) ) - 1.0 + nearOcclusion );
#if defined(SVV_ENABLED) && SVV_ENABLED == 2
// Sky visibility over a cosine lobe around the reflection direction (L1 cannot hold a narrower lobe): a floor that
// mirrors the ceiling stops mirroring the sky. What it mirrors instead comes from SSR or the GI color; without them
// the reflection only loses light (apartment mean 22.8 against 33.9 path traced, 39.6 without this term; IJ-851).
if (ssgiApply) {
    vec3 svvR = normalize(reflect(-geometryViewDir, geometryNormal) * mat3(viewMatrix));
    specularOcclusion = min(specularOcclusion, svvDiffuse(svvSH, svvR));
}
#endif
reflectedLight.indirectSpecular *= specularOcclusion;

#if defined(SSGI_ENABLED) && SSGI_ENABLED > 0
#if !defined(SSR_ENABLED) || SSR_ENABLED < 1
reflectedLight.indirectSpecular += ssgiColor * material.specularColor;
#endif
#endif

#endif

#endif
