// reads channel R, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
//float ambientOcclusion = ( texture2D( aoMap, vUv2 ).r - 1.0 ) * aoMapIntensity + 1.0;
#if defined(SSRTAO_ENABLED) && SSRTAO_ENABLED > 0

vec3 screenPos_gi = viewToScreen(vViewPosition.xyz);

#if SSRTAO_ENABLED == 2 // split mode
if(screenPos_gi.x > ssrtaoSplitX){
#endif

vec4 ssgi = tSSGIMapTexelToLinear( texture2D( tSSGIMap, screenPos_gi.xy) );

//float ssaoPower = 1.*2.;
//float ssgiIntensity = 1.;
float ambientOcclusion = 1.-ssgi.a;

ambientOcclusion = max(0. ,ambientOcclusion);
ambientOcclusion = pow(ambientOcclusion, ssaoPower);
ambientOcclusion = min(1. ,ambientOcclusion);

reflectedLight.indirectDiffuse *= ambientOcclusion;

#if defined(SSGI_ENABLED) && SSGI_ENABLED > 0

vec3 ssgiColor = ssgi.rgb * ssgiIntensity;
reflectedLight.indirectDiffuse += ssgiColor * (material.diffuseColor.rgb);

#endif

#if defined( USE_ENVMAP )

float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
//float specularOcclusion = 1.;//computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
float specularOcclusion = saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * material.roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
reflectedLight.indirectSpecular *= specularOcclusion;

#if defined(SSGI_ENABLED) && SSGI_ENABLED > 0
#if !defined(SSR_ENABLED) || SSR_ENABLED < 1

reflectedLight.indirectSpecular += ssgiColor * material.specularColor;

#endif
#endif

#endif

//reflectedLight.indirectSpecular = vec3(ssgi.rgb);

#if SSRTAO_ENABLED == 2 // split mode
}
#endif

#endif
