#include <randomHelpers>
#include <voronoiNoise>

uniform vec2 noiseBumpParams;
uniform float noiseBumpScale;
uniform float noiseBumpFlakeScale;
uniform float noiseFlakeClamp;
uniform float noiseFlakeRadius;
uniform bool useColorFlakes;
uniform vec4 flakeParams; // Roughness, Metalness, Strength, Threshold
uniform vec3 flakeFallOffParams; // useFallOff, fallOffFactor

vec3 perturbNormalArb_nb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {

    #ifdef BUMP_MAP_SCALE_LEGACY
    vec3 vSigmaX = ( dFdx( surf_pos.xyz ) );
    vec3 vSigmaY = ( dFdy( surf_pos.xyz ) );
    #else
    // normalize is done to ensure that the bump map looks the same regardless of the texture's scale
    vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
    vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
    #endif
    vec3 vN = surf_norm; // normalized

    vec3 R1 = cross( vSigmaY, vN );
    vec3 R2 = cross( vN, vSigmaX );

    float fDet = dot( vSigmaX, R1 ) * faceDirection;

    vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
    return normalize( abs( fDet ) * surf_norm - vGrad );

}
