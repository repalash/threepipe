// reads channel R, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
//float ambientOcclusion = ( texture2D( aoMap, vUv2 ).r - 1.0 ) * aoMapIntensity + 1.0;
#if defined(SSREFL_ENABLED) && SSREFL_ENABLED > 0

vec3 screenPos = viewToScreen(geometryPosition);

#if SSREFL_ENABLED == 2 // split mode
if(screenPos.x > ssrSplitX){
#endif

//vec4 ssrColor = texture2D( tSSReflMap,  screenPos.xy);
vec4 ssrColor = vec4(0,0,0,0);
float alphaModifier = 1.0 - clamp(material.roughness * .3, 0., 1.);
alphaModifier *= ssrIntensity;

#if defined(SSR_MASK_FRONT_RAYS) && SSR_MASK_FRONT_RAYS > 0
alphaModifier *= clamp(-4.0 * dot(geometryViewDir, normal) + (4.0 + ssrMaskFrontFactor), 0.0, 1.0);
#endif

#ifdef USE_TRANSMISSION
alphaModifier *= 1.-transmission;
#endif

float vignette = 1.;
// applyEdgeFade
if(true)
{
    float fadeStrength = 0.1;

//    vec2 itsP = vec2(1.0, 1.0) - screenPos.xy;
    float dist = max(0.,min(min(1.-screenPos.x, 1.-screenPos.y), min(screenPos.x, screenPos.y)));
    float fade = dist*dist / (fadeStrength + 0.001);
    fade = clamp(fade, 0.0, 1.0);
    fade = pow(fade, 0.3);

    vignette = fade;
}
alphaModifier *= vignette;

vec3 specularColor = EnvironmentBRDF(geometryNormal, geometryViewDir, material.specularColor.rgb, material.specularF90, material.roughness);

if(length(specularColor.rgb) * alphaModifier > 0.01 && roughnessFactor < 0.9){ // Note: using material.roughness here causes some clipping issues at edges because of geometryRoughness
    #if defined(SSR_INLINE) && SSR_INLINE > 0
    vec3 scPos = vec3(screenPos.xy, geometryPosition.z);
//    ssrColor = calculateSSR(8., scPos, geometryNormal, 1., material.roughness);
    vec4 scol = vec4(0,0,0,0);

    #pragma unroll_loop_start
    for( int i = 0; i < 8; i++ ) {
        if(SSR_RAY_COUNT > UNROLLED_LOOP_INDEX) {
            scol = calculateSSR(float(UNROLLED_LOOP_INDEX), scPos, geometryNormal, UNROLLED_LOOP_INDEX%3==0?1.:UNROLLED_LOOP_INDEX%3==1?0.5:1.5, material.roughness);
            #ifdef SSR_RAY_BLEND_MAX
            ssrColor = max(ssrColor, scol);
            #else
            ssrColor += scol;
            #endif
        }
    }
    #pragma unroll_loop_end

    #ifndef SSR_RAY_BLEND_MAX
    ssrColor *= ssrColor.a > 0.001 ? 1.0 / ssrColor.a : 1.0;
    #endif
//
//    #if SSR_RAY_COUNT > 1
//    ssrColor += calculateSSR(1., scPos, geometryNormal, 0.4, material.roughness);
//    #endif
//    #if SSR_RAY_COUNT > 2
//    ssrColor += calculateSSR(1., scPos, geometryNormal, 0.25, material.roughness);
//    #endif
//    #if SSR_RAY_COUNT > 3
//    ssrColor += calculateSSR(1., scPos, geometryNormal, 1.5, material.roughness);
//    #endif
//    #if SSR_RAY_COUNT > 3
//    ssrColor += calculateSSR(1., scPos, geometryNormal, 1.25, material.roughness);
//    #endif
//    #if SSR_RAY_COUNT > 4
//    ssrColor += calculateSSR(1., scPos, geometryNormal, 1.25, material.roughness);
//    #endif
//
//    if(gl_FragCoord.x < 680.){
//        ssrColor += calculateSSR(1., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 0.4, material.roughness);
//        ssrColor += calculateSSR(4., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 0.25, material.roughness);
//        ssrColor += calculateSSR(123., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 1., material.roughness);
//        ssrColor += calculateSSR(11., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 1., material.roughness);
//        ssrColor += calculateSSR(1273., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 1., material.roughness);
//        ssrColor += calculateSSR(13., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 1., material.roughness);
//        ssrColor += calculateSSR(38., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 1., material.roughness);
//        ssrColor *= 0.125;
//    }else {
//        ssrColor = max(ssrColor, calculateSSR(1., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 0.4, material.roughness));
//        ssrColor = max(ssrColor, calculateSSR(4., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 0.25, material.roughness));
//        ssrColor = max(ssrColor, calculateSSR(123., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 1., material.roughness));
//        ssrColor = max(ssrColor, calculateSSR(11., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 1., material.roughness));
//        ssrColor = max(ssrColor, calculateSSR(1273., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 1., material.roughness));
//        ssrColor = max(ssrColor, calculateSSR(13., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 1., material.roughness));
//        ssrColor = max(ssrColor, calculateSSR(38., vec3(screenPos.xy, geometryPosition.z), geometryNormal, 1., material.roughness));
//    }
    #else
    ssrColor = tSSReflMapTexelToLinear( texture2D( tSSReflMap,  screenPos.xy) );
    #endif //SSR_INLINE
}
ssrColor.rgb *= ssrBoost;

ssrColor.a *= alphaModifier;

// pow is slow, shouldnt use for no reason
ssrColor.rgb = pow(max(vec3(0.), ssrColor.rgb), vec3(ssrPower));

ssrColor.a = min(ssrColor.a, 1.0);

//#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined ( USE_AOMAP )
//ssrColor.rgb *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
//#endif

// this non-physical is used in ground plugin
#if defined(SSR_NON_PHYSICAL) && SSR_NON_PHYSICAL > 0
diffuseColor.a = max(ssrColor.a, diffuseColor.a * diffuseColor.a);
reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, saturate(diffuseColor.rgb * ssrColor.rgb), 1.0);
reflectedLight.indirectDiffuse = diffuseColor.rgb * (1.0-ssrColor.a);
reflectedLight.directDiffuse = vec3(0.0);
reflectedLight.directSpecular = vec3(0.0);
//diffuseColor.a = min(1.0, ssrColor.a + diffuseColor.a);
#else
// todo is mix clamping
reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, (specularColor.rgb * ssrColor.rgb), ssrColor.a);
// todo saturate for noise?
//reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, saturate(specularColor.rgb * ssrColor.rgb), ssrColor.a);
#endif


#if SSREFL_ENABLED == 2
}
#endif

#endif


//#if DEBUG
// just show ssrColor
//reflectedLight.indirectSpecular = ssrColor.rgb;
//reflectedLight.indirectDiffuse = vec3(0.0);
//reflectedLight.directDiffuse = vec3(0.0);
//reflectedLight.directSpecular = vec3(0.0);
//#endif
