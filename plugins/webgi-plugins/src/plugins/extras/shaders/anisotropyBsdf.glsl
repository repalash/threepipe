uniform float anisotropyFactor;
uniform float anisotropyNoise;
#if ANISOTROPY_TEX_MODE == 0
uniform float anisotropyDirection;
#else
uniform sampler2D anisotropyDirectionMap;
varying vec2 vAnisotropy2MapUv;
#endif
const float MIN_ROUGHNESS = 0.05;

// Adapted from getReflectedVector() in Filament: https://github.com/google/filament/blob/v1.12.0/shaders/src/light_indirect.fs#L139-L152
// Filament, Apache License 2.0, Copyright (C) 2015 The Android Open Source Project
vec3 indirectAnisotropyBentNormal(const in vec3 normal, const in vec3 viewDir, const in float roughness, const in vec3 anisotropicT, const in vec3 anisotropicB) {
    vec3 aDirection = anisotropyFactor >= 0.0 ? anisotropicB : anisotropicT;
    vec3 aTangent = cross(aDirection, viewDir);
    vec3 aNormal = cross(aTangent, aDirection);
    float bendFactor = abs(anisotropyFactor) * saturate(5.0 * max(roughness, MIN_ROUGHNESS));
    return normalize(mix(normal, aNormal, bendFactor));
}

// ShaderChunk.bsdfs
// Anisotropic lobe adapted from anisotropicLobe() in Filament: https://github.com/google/filament/blob/v1.12.0/shaders/src/shading_model_standard.fs#L31-L58
// Filament, Apache License 2.0, Copyright (C) 2015 The Android Open Source Project
vec3 BRDF_GGX_Anisotropy( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 f0, const in float f90, const in float roughness, const in vec3 anisotropicT, const in vec3 anisotropicB ) {

    float alpha = pow2( roughness ); // UE4's roughness

    vec3 halfDir = normalize( lightDir + viewDir );

    float dotNL = saturate( dot( normal, lightDir ) );
    float dotNV = saturate( dot( normal, viewDir ) );
    float dotNH = saturate( dot( normal, halfDir ) );
    float dotVH = saturate( dot( viewDir, halfDir ) );

    float dotTV =  dot(anisotropicT, viewDir) ;
    float dotBV =  dot(anisotropicB, viewDir) ;
    float dotTL =  dot(anisotropicT, lightDir) ;
    float dotBL =  dot(anisotropicB, lightDir) ;
    float dotTH =  dot(anisotropicT, halfDir) ;
    float dotBH =  dot(anisotropicB, halfDir) ;

    // Anisotropic parameters: at and ab are the roughness along the tangent and bitangent
    // to simplify materials, we derive them from a single roughness parameter
    // Kulla 2017, "Revisiting Physically Based Shading at Imageworks"
    //    float at = max(alpha * (1.0 + anisotropyFactor), MIN_ROUGHNESS);
    //    float ab = max(alpha * (1.0 - anisotropyFactor), MIN_ROUGHNESS);

    // slide 26, Disney 2012, "Physically Based Shading at Disney"
    // https://blog.selfshadow.com/publications/s2012-shading-course/burley/s2012_pbs_disney_brdf_notes_v3.pdf
    float aspect = sqrt(1.0 - min(1.-MIN_ROUGHNESS, abs(anisotropyFactor) * 0.9));
    if (anisotropyFactor > 0.0) aspect = 1.0 / aspect;
    float at = roughness * aspect;
    float ab = roughness / aspect;

    // specular anisotropic BRDF
    vec3 F = F_Schlick( f0, f90, dotVH );

    float V = V_GGX_SmithCorrelated_Anisotropic( at, ab, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );

    float D = D_GGX_Anisotropic( at, ab, dotTH, dotBH, dotNH );

    return F * ( V * D );

}
