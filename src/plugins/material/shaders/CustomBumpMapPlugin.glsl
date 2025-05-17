#if defined(CUSTOM_BUMP_MAP_ENABLED) && CUSTOM_BUMP_MAP_ENABLED > 0

#if CUSTOM_BUMP_MAP_BICUBIC > 0  // from http://www.java-gaming.org/index.php?topic=35123.0
vec4 cubic_cb(float v){
    vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
    vec4 s = n * n * n;
    float x = s.x;
    float y = s.y - 4.0 * s.x;
    float z = s.z - 4.0 * s.y + 6.0 * s.x;
    float w = 6.0 - x - y - z;
    return vec4(x, y, z, w) * (1.0/6.0);
}

vec4 textureBicubic_cb(sampler2D sampler, vec2 texCoords){

    vec2 texSize = vec2(textureSize(sampler, 0));
    vec2 invTexSize = 1.0 / texSize;

    texCoords = texCoords * texSize - 0.5;

    vec2 fxy = fract(texCoords);
    texCoords -= fxy;

    vec4 xcubic = cubic_cb(fxy.x);
    vec4 ycubic = cubic_cb(fxy.y);

    vec4 c = texCoords.xxyy + vec2 (-0.5, +1.5).xyxy;

    vec4 s = vec4(xcubic.xz + xcubic.yw, ycubic.xz + ycubic.yw);
    vec4 offset = c + vec4 (xcubic.yw, ycubic.yw) / s;

    offset *= invTexSize.xxyy;

    vec4 sample0 = texture(sampler, offset.xz);
    vec4 sample1 = texture(sampler, offset.yz);
    vec4 sample2 = texture(sampler, offset.xw);
    vec4 sample3 = texture(sampler, offset.yw);

    float sx = s.x / (s.x + s.y);
    float sy = s.z / (s.z + s.w);

    return mix(
    mix(sample3, sample2, sx), mix(sample1, sample0, sx)
    , sy);
}
#endif

varying vec2 vCustomBumpUv;
uniform sampler2D customBumpMap;
uniform float customBumpScale;

// same as bumpmap_pars_fragment, but with customBumpMap, customBumpUv and bicubic
vec2 dHdxy_fwd_cb() {

    vec2 dSTdx = dFdx( vCustomBumpUv );
    vec2 dSTdy = dFdy( vCustomBumpUv );

    #if CUSTOM_BUMP_MAP_BICUBIC > 0
    float Hll = customBumpScale * textureBicubic_cb( customBumpMap, vCustomBumpUv ).x;
    float dBx = customBumpScale * textureBicubic_cb( customBumpMap, vCustomBumpUv + dSTdx ).x - Hll;
    float dBy = customBumpScale * textureBicubic_cb( customBumpMap, vCustomBumpUv + dSTdy ).x - Hll;
    #else
    float Hll = customBumpScale * texture2D( customBumpMap, vCustomBumpUv ).x;
    float dBx = customBumpScale * texture2D( customBumpMap, vCustomBumpUv + dSTdx ).x - Hll;
    float dBy = customBumpScale * texture2D( customBumpMap, vCustomBumpUv + dSTdy ).x - Hll;
    #endif

    return vec2( dBx, dBy );

}
#ifndef USE_BUMPMAP
vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {

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
#endif
#endif
