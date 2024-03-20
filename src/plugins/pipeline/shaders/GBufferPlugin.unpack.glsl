#ifndef UNPACK_GBUFFER_SNIPPET
#define UNPACK_GBUFFER_SNIPPET

//precision highp usampler2D;

uniform sampler2D tNormalDepth;
//float unpack16(vec2 value) {
//    return (
//    value.x*0.996108949416342426275150501169264316558837890625 +
//    value.y*0.00389105058365758760263730664519243873655796051025390625
//    );
//}
float unpack16(vec2 value){
    return value.x+value.y/255.0;
}

vec3 unpackNormal(vec2 enc) {
    vec2 fenc = enc*4.0-2.0;
    float f = dot(fenc, fenc);
    float g = sqrt(1.0-f/4.0);
    return vec3(fenc*g, 1.0-f/2.0);
}
float unpackDepth(vec2 uncodedDepth) {
    float x = unpack16(uncodedDepth.xy);
    return x*x;
}
#define getDepth(uv) unpackDepth(texture2D(tNormalDepth, uv).xy)

void getDepthNormal(const in vec2 uv, out float depth, out vec3 normal){
    vec4 uncodedDepth = texture2D(tNormalDepth, uv);
    depth = unpackDepth(uncodedDepth.xy);
    normal = unpackNormal(uncodedDepth.zw);
}
vec3 getViewNormal(const in vec2 uv ) {
    //    #if DEPTH_NORMAL_TEXTURE == 1
    return unpackNormal( texture2D( tNormalDepth, uv ).zw );
    //    #else
    //    return unpackRGBToNormal( texture2D( tNormal, uv ).xyz );
    //    #endif
}
#if defined(GBUFFER_HAS_FLAGS) && GBUFFER_HAS_FLAGS == 1
uniform sampler2D tGBufferFlags;
#endif
ivec4 getGBufferFlags(const in vec2 uv){
    #if defined(GBUFFER_HAS_FLAGS) && GBUFFER_HAS_FLAGS == 1
    return ivec4(texture2D(tGBufferFlags, uv) * 255.);
    #else
    return ivec4(1);
    #endif
}

#if defined(GBUFFER_HAS_DEPTH_TEXTURE) && GBUFFER_HAS_DEPTH_TEXTURE == 1
// NOT TESTED
uniform sampler2D tGBufferDepthTexture;
// needs <packing>. Its made sure that its included in the unpackExtension
float getDepthTexture( vec2 coord, float cameraNear, float cameraFar ) {
    float fragCoordZ = texture2D( tGBufferDepthTexture, coord ).x;
    float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
    return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );
}
#endif

//#if DEPTH_NORMAL_TEXTURE == 1
//uniform sampler2D tNormalDepth;
//#else
//uniform sampler2D tNormal;
//#endif

//float decodeDepth( const in vec2 uv ) {
//    vec4 uncodedDepth;
//    #if DEPTH_PACKING_MODE == 2
//    uncodedDepth = texture2D( tNormalDepth, uv );
//    #else
//    uncodedDepth = texture2D( tDepth, uv );
//    #endif
//
//    #if DEPTH_PACKING_MODE == 0
//    return uncodedDepth.x;
//    #elif DEPTH_PACKING_MODE == 1
//    #if LINEAR_DEPTH == 1
//    return pow2(unpackRGBAToDepth(uncodedDepth));
//    #else
//    return unpackRGBAToDepth( uncodedDepth );
//    #endif
//    #else
//    return pow2(unpack16(uncodedDepth.xy));
//    #endif
//}
#endif
