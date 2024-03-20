vec3 outColor, outColor1, outColor2, outColor3, outColor4, outColor5;
float distFac = length(vViewPosition.xyz);
/*float e = floor( log2( 0.3 * distFac + 3.0 ) / 0.3785116);
float level_z = 0.1 * pow( 1.3 , e ) - 0.2;*/
float level = 1.;//0.15 / level_z;
vec2 uvMod = noiseBumpFlakeScale * noiseBumpParams.xy * vUv * level;
float voronoiDist = clamp(voronoi_f1_2d( uvMod, 1., noiseFlakeClamp, noiseFlakeRadius, outColor ), 0.0, 1.0);

vec3 oldNormal = normal;
normal = perturbNormalArb_nb( - vViewPosition, normal, (2. * outColor.xy - 1.) * noiseBumpScale, faceDirection ); 

float oldRoughnessFactor = roughnessFactor;
float oldMetalnessFactor = metalnessFactor;
roughnessFactor = mix(roughnessFactor, flakeParams.x, 1. - voronoiDist);
metalnessFactor = mix(metalnessFactor, flakeParams.y, 1. - voronoiDist);


#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )

    vec3 sparkleRadiance = getIBLRadiance( normalize(vViewPosition), normal, roughnessFactor );
    float sparkleIntensity = length(sparkleRadiance);
    float sparkleIntensityMultiplier = sparkleIntensity > 1.3 ? flakeParams.z : 1.;
    
    vec3 oldDiffuseColor = diffuseColor.rgb;
    vec2 cellPosition_ = floor(uvMod);
    vec3 colorRGB = useColorFlakes ? hash3(cellPosition_) : vec3(1.);
    
    float fallOff_ = mix(1., 1. / (1. + flakeFallOffParams.y * distFac + flakeFallOffParams.z * distFac * distFac), flakeFallOffParams.x);
    diffuseColor.rgb *= mix(vec3(1.), sparkleIntensityMultiplier * colorRGB * fallOff_, vec3(1. - voronoiDist));

    if(sparkleIntensity < flakeParams.w) {
        float mixFactor = 1.;
        roughnessFactor = mix(roughnessFactor, oldRoughnessFactor, mixFactor);
        metalnessFactor = mix(metalnessFactor, oldMetalnessFactor, mixFactor);
        normal = normalize(mix(normal, oldNormal, mixFactor));
        diffuseColor.rgb = mix(diffuseColor.rgb, oldDiffuseColor, mixFactor);
    }
#endif