
#ifdef USE_BUMPMAP

mat3 mat3_inverse( mat3 A )
{
    mat3 M_t = mat3(
    vec3( A[0][0], A[1][0], A[2][0] ),
    vec3( A[0][1], A[1][1], A[2][1] ),
    vec3( A[0][2], A[1][2], A[2][2] ) );
    float det = dot( cross( M_t[0], M_t[1] ), M_t[2] );
    mat3 adjugate = mat3( cross( M_t[1], M_t[2] ),
    cross( M_t[2], M_t[0] ),
    cross( M_t[0], M_t[1] ) );
    return adjugate / det;
}


float CalculateHeight( in vec2 texCoords )
{
    float height = texture2D( bumpMap, texCoords ).x;
    return clamp( height, 0.0, 1.0 );
}

const vec2 bumpMapSize = vec2(512, 512);
// Return normal in tangent space from normal map if available or bump map
vec3 CalculateNormal( in vec2 texCoords )
{
    #if defined( TANGENTSPACE_NORMALMAP ) && 0 //todo: fix. not working properly.
    vec3  mapN = texture2D( normalMap, texCoords ).xyz;
    mapN.xy *= normalScale;
    return normalize( mapN );
    #else
    vec2 texOffs = 1.0 / bumpMapSize;
    #if PARALLAX_NORMAL_MAP_QUALITY > 0
    float hx[9];
    hx[0] = texture2D( bumpMap, texCoords.st + texOffs * vec2(-1.0, -1.0) ).r;
    hx[1] = texture2D( bumpMap, texCoords.st + texOffs * vec2( 0.0, -1.0) ).r;
    hx[2] = texture2D( bumpMap, texCoords.st + texOffs * vec2( 1.0, -1.0) ).r;
    hx[3] = texture2D( bumpMap, texCoords.st + texOffs * vec2(-1.0,  0.0) ).r;
    hx[4] = texture2D( bumpMap, texCoords.st ).r;
    hx[5] = texture2D( bumpMap, texCoords.st + texOffs * vec2( 1.0, 0.0) ).r;
    hx[6] = texture2D( bumpMap, texCoords.st + texOffs * vec2(-1.0, 1.0) ).r;
    hx[7] = texture2D( bumpMap, texCoords.st + texOffs * vec2( 0.0, 1.0) ).r;
    hx[8] = texture2D( bumpMap, texCoords.st + texOffs * vec2( 1.0, 1.0) ).r;
    vec2  deltaH = vec2(hx[0]-hx[2] + 2.0*(hx[3]-hx[5]) + hx[6]-hx[8], hx[0]-hx[6] + 2.0*(hx[1]-hx[7]) + hx[2]-hx[8]);
    #else
    float h_xa   = texture2D( bumpMap, texCoords.st + texOffs * vec2(-1.0,  0.0) ).r;
    float h_xb   = texture2D( bumpMap, texCoords.st + texOffs * vec2( 1.0,  0.0) ).r;
    float h_ya   = texture2D( bumpMap, texCoords.st + texOffs * vec2( 0.0, -1.0) ).r;
    float h_yb   = texture2D( bumpMap, texCoords.st + texOffs * vec2( 0.0,  1.0) ).r;
    vec2  deltaH = vec2(h_xa-h_xb, h_ya-h_yb);
    #endif
    return normalize( vec3( deltaH / texOffs, 1.0 ) );
    #endif
}

//https://github.com/Rabbid76/graphics-snippets/blob/master/html/technique/parallax_005_parallax_relief_mapping_derivative_tbn.html
//https://web.archive.org/web/20190128023901/http://sunandblackcat.com/tipFullView.php?topicid=28
vec3 ReliefParallax( in float frontFace, in vec3 texDir3D, in vec2 texCoord )
{
    float surf_sign       = frontFace;
    float back_face       = step(0.0, -surf_sign);
    vec2  texStep         = surf_sign * texDir3D.xy / abs(texDir3D.z); // (z is negative) the direction vector points downwards in tangent-space
    vec2  texC            = texCoord.st + surf_sign * texStep + back_face * texStep.xy;
    float mapHeight       = 1.0;
    float bumpHeightStep  = 1.0 / float(PARALLAX_MAP_STEPS);
    float bestBumpHeight  = mapHeight+bumpHeightStep;

    #pragma unroll_loop_start
    for ( int i = 0 ; i < PARALLAX_MAP_STEPS ; i ++ ) {

        if ( mapHeight < bestBumpHeight )
        {
            bestBumpHeight -= bumpHeightStep;
            mapHeight = back_face + surf_sign * CalculateHeight(texC.xy - bestBumpHeight * texStep.xy);
        }

    }
    #pragma unroll_loop_end

    bestBumpHeight += bumpHeightStep;

    #pragma unroll_loop_start
    for ( int i = 0; i < PARALLAX_MAP_B_STEPS ; i ++ ) {

        bumpHeightStep *= 0.5;
        bestBumpHeight -= bumpHeightStep;
        mapHeight       = back_face + surf_sign * CalculateHeight( texC.xy - bestBumpHeight * texStep.xy );
        bestBumpHeight += ( bestBumpHeight < mapHeight ) ? bumpHeightStep : 0.0;

    }
    #pragma unroll_loop_end

    bestBumpHeight -= bumpHeightStep * clamp( ( bestBumpHeight - mapHeight ) / bumpHeightStep, 0.0, 1.0 );
    mapHeight       = bestBumpHeight;
    texC           -= mapHeight * texStep;

    return vec3( texC.xy, mapHeight );
}

vec3 reliefParallaxPerturbNormal(in float faceDirection, inout vec3 normal){
    if(abs(bumpScale) < 0.001) return vec3(vBumpMapUv, 0.);

    //    #ifdef DOUBLE_SIDED
    //
    //    normal = normal * faceDirection;
    //
    //    #endif

    float parallaxHeight;

    vec2  texCoords     = vBumpMapUv;
    float face_sign     = sign(dot(normal, vViewPosition));

    // Followup: Normal Mapping Without Precomputed Tangents [http://www.thetenthplanet.de/archives/1180]
    vec3  N             = normalize(normal);
    vec3  dp1           = dFdx(-vViewPosition);
    vec3  dp2           = dFdy(-vViewPosition);
    vec2  duv1          = dFdx(vBumpMapUv);
    vec2  duv2          = dFdy(vBumpMapUv);
    vec3  dp2perp       = cross(dp2, N);
    vec3  dp1perp       = cross(N, dp1);
    vec3  T             = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3  B             = dp2perp * duv1.y + dp1perp * duv2.y;
    float invmax        = inversesqrt(max(dot(T, T), dot(B, B)));
    mat3 tbnMat        = mat3(T * invmax, B * invmax, N * bumpScale);

    vec3 tangentPos = normalize(mat3_inverse(tbnMat) * -vViewPosition);

    // vec2 parallaxUv = parallaxMapping(tangentPos, vBumpMapUv, parallaxHeight);
    vec3 parallaxUv = ReliefParallax(face_sign, tangentPos, vBumpMapUv);

    tbnMat[2] = face_sign * N / bumpScale;

    normal = normalize(tbnMat * CalculateNormal(parallaxUv.xy).xyz);

    //todo test this.
    #ifdef FLIP_SIDED

    normal = - normal;

    #endif

    //    #ifdef DOUBLE_SIDED
    //
    //    normal = normal * faceDirection;
    //
    //    #endif

    // normal = geometryNormal;

    // todo: modify geometryPosition (vViewPosition) for point, spot and area lights

    return parallaxUv;
}

#endif // USE_BUMPMAP
