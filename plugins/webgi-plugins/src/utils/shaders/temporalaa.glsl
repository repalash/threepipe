#include <common>
#include <gbuffer_unpack>

#ifdef HAS_VELOCITY_BUFFER
#pragma <velocity_unpack>
#else
#define HAS_VELOCITY_BUFFER 0
#endif

#include <cameraHelpers>

varying vec2 vUv;
uniform vec2 previousRTSize;
uniform vec2 jitterSample;
uniform vec2 feedBack;
uniform bool firstFrame;

//float getViewZ( const in float depth ) {
//	#if PERSPECTIVE_CAMERA == 1
//	return perspectiveDepthToViewZ( depth, cameraNearFar.x, cameraNearFar.y );
//	#else
//	return orthoDepthToViewZ( depth, cameraNearFar.x, cameraNearFar.y );
//	#endif
//}

vec3 find_closest_fragment_3x3(const in vec2 uv) {
    const vec3 offset = vec3(-1.0, 1.0, 0.0);
    vec2 texelSize = 1.0/previousRTSize;

    vec3 dtr = vec3( 1, 1, getDepth( uv + offset.yy * texelSize) );
    vec3 dtc = vec3( 0, 1, getDepth( uv + offset.zy * texelSize) );
    vec3 dtl = vec3( -1, 1, getDepth( uv + offset.xy * texelSize) );

    vec3 dml = vec3(-1, 0, getDepth( uv + offset.xz * texelSize) );
    vec3 dmc = vec3( 0, 0, getDepth( uv ) );
    vec3 dmr = vec3( 1, 0, getDepth( uv + offset.yz * texelSize) );

    vec3 dbl = vec3(-1, -1, getDepth( uv + offset.xx * texelSize) );
    vec3 dbc = vec3( 0, -1, getDepth( uv + offset.zx * texelSize) );
    vec3 dbr = vec3( 1, -1, getDepth( uv + offset.yx * texelSize) );

    vec3 dmin = dtl;
    if ( dmin.z > dtc.z ) dmin = dtc;
    if ( dmin.z > dtr.z ) dmin = dtr;

    if ( dmin.z > dml.z ) dmin = dml;
    if ( dmin.z > dmc.z ) dmin = dmc;
    if ( dmin.z > dmr.z ) dmin = dmr;

    if ( dmin.z > dbl.z ) dmin = dbl;
    if ( dmin.z > dbc.z ) dmin = dbc;
    if ( dmin.z > dbr.z ) dmin = dbr;

    return vec3(uv + texelSize.xy * dmin.xy, dmin.z);
}

vec3 find_closest_fragment_5tap(const in vec2 uv)
{
    vec2 texelSize = 1.0/previousRTSize;
    vec2 offset = vec2(1.0, -1.0);

    vec3 dtl = vec3(-1, 1, getDepth( uv + offset.yx * texelSize) );
    vec3 dtr = vec3( 1, 1, getDepth( uv + offset.xx * texelSize) );

    vec3 dmc = vec3( 0, 0, getDepth( uv) );

    vec3 dbl = vec3(-1, -1, getDepth( uv + offset.yy * texelSize) );
    vec3 dbr = vec3( 1, -1, getDepth( uv + offset.xy * texelSize) );

    vec3 dmin = dtl;
    if ( dmin.z > dtr.z ) dmin = dtr;
    if ( dmin.z > dmc.z ) dmin = dmc;

    if ( dmin.z > dbl.z ) dmin = dbl;
    if ( dmin.z > dbr.z ) dmin = dbr;

    return vec3(uv + dmin.xy * texelSize, dmin.z);
}

vec4 clip_aabb(const in vec4 aabb_min, const in vec4 aabb_max, vec4 p )
{
    const float FLT_EPS = 1e-8;
    vec4 p_clip = 0.5 * (aabb_max + aabb_min);
    vec4 e_clip = 0.5 * (aabb_max - aabb_min) + FLT_EPS;

    vec4 v_clip = p - p_clip;
    vec4 v_unit = abs(v_clip / e_clip);
    float ma_unit = max(v_unit.x, max(v_unit.y, v_unit.z));

    if (ma_unit > 1.0)
    return p_clip + v_clip / ma_unit;
    else return p;
}

#if HAS_VELOCITY_BUFFER == 0 || defined(DEBUG_VELOCITY)
#include <computeScreenSpaceVelocity>
#include <getWorldPositionFromViewZ>
#endif

vec4 currentRTTexelToLinear1(vec4 a){
    if(isinf(a.x) || isinf(a.y) || isinf(a.z) || isinf(a.w)){
        return vec4(1.);
    }
    return currentRTTexelToLinear(a);
}
vec4 computeTAA(const in vec2 uv, const in vec2 screenSpaceVelocity, const in float feedbackScale) {
//    vec2 jitterOffset = jitterSample/previousRTSize; // todo
    vec2 uvUnJitter = uv;

    vec4 currentColor = currentRTTexelToLinear(texture2D(currentRT, uvUnJitter));
    vec4 previousColor = previousRTTexelToLinear(texture2D(previousRT, uv - screenSpaceVelocity));
    const vec3 offset = vec3(1., -1., 0.);
    vec2 texelSize = 1./previousRTSize;

    float texelSpeed = length( screenSpaceVelocity );

    // todo pick only the neighbors which are not background?
    vec4 tl = currentRTTexelToLinear1(texture2D(currentRT, uvUnJitter + offset.yx * texelSize));
    vec4 tc = currentRTTexelToLinear1(texture2D(currentRT, uvUnJitter + offset.zx * texelSize));
    vec4 tr = currentRTTexelToLinear1(texture2D(currentRT, uvUnJitter + offset.xx * texelSize));
    vec4 ml = currentRTTexelToLinear1(texture2D(currentRT, uvUnJitter + offset.yz * texelSize));
    vec4 mc = currentColor;
    vec4 mr = currentRTTexelToLinear1(texture2D(currentRT, uvUnJitter + offset.xz * texelSize));
    vec4 bl = currentRTTexelToLinear1(texture2D(currentRT, uvUnJitter + offset.yy * texelSize));
    vec4 bc = currentRTTexelToLinear1(texture2D(currentRT, uvUnJitter + offset.zy * texelSize));
    vec4 br = currentRTTexelToLinear1(texture2D(currentRT, uvUnJitter + offset.xy * texelSize));

    // Sharpen the centre sample for the clamp box below: unsharp mask with the diagonal neighbours,
    // mc + k * (4 mc - (tl + tr + bl + br)), k = 0.2718.
    mc = max(vec4(0.0), mc + 0.2718 * (4.0 * mc - (tl + tr + bl + br)));

    vec4 min5 = min(tc, min(ml, min(mc, min(mr, bc))));
    vec4 max5 = max(tc, max(ml, max(mc, max(mr, bc))));

    vec4 cmin = min(min5, min(tl, min(tr, min(bl, br))));
    vec4 cmax = max(min5, max(tl, max(tr, max(bl, br))));;

    cmin = 0.5 * (cmin + min5);
    cmax = 0.5 * (cmax + max5);
    previousColor = clip_aabb(cmin, cmax, previousColor);

    float lum0 = luminance(currentColor.rgb);
    float lum1 = luminance(previousColor.rgb);
    float unbiased_diff = abs(lum0 - lum1) / max(lum0, max(lum1, 0.2));
    float unbiased_weight = 1.0 - unbiased_diff;
    float unbiased_weight_sqr = unbiased_weight * unbiased_weight;
    float k_feedback = mix(feedBack.x, feedBack.y, unbiased_weight_sqr);

    return mix(currentColor, previousColor, clamp(k_feedback * feedbackScale, 0., 1.));

}

void main() {

    //    gl_FragColor.rgb = vec3(getDepth( vUv ));
    //    gl_FragColor.a = 1.;
    //    return;
    // vec2 jitterOffset = jitterSample/previousRTSize;

    #if HAS_VELOCITY_BUFFER == 0 // todo why not using closest fragment in velocity buffer?
    #if QUALITY == 1
    vec3 c_frag = find_closest_fragment_3x3(vUv);
    #else
    vec3 c_frag = find_closest_fragment_5tap(vUv);
    #endif
    #else
    vec3 c_frag = vec3(vUv, 0.);
    #endif

    bool bg = firstFrame;

    #if BACKGROUND_TAA // this is required for edge artifacts in msaa

//    float d = getDepth(vUv);
    float d = c_frag.z;
    float edgef = min(1., max(0., 1.- (d*100. - 99.)));

    #else

    bg = bg || c_frag.z > 0.999;

    #endif

    if( bg ) {

        gl_FragColor = currentRTTexelToLinear1(texture2D(currentRT, vUv));

    } else {
        #if HAS_VELOCITY_BUFFER == 0
        //        #if LINEAR_DEPTH == 0
        //            float sampleViewZ = getViewZ( c_frag.z );
        //        #else
        float sampleViewZ = mix(-cameraNearFar.x, -cameraNearFar.y, c_frag.z);
        //        #endif
        vec3 worldPosition = getWorldPositionFromViewZ(c_frag.xy, sampleViewZ);
        vec2 screenSpaceVelocity = computeScreenSpaceVelocity(worldPosition);
        #else
        vec2 screenSpaceVelocity = getVelocity(c_frag.xy);
        #endif

//        float previousDepth = getDepth(vUv - screenSpaceVelocity);

//        screenSpaceVelocity *= min(1., edgef);
//        screenSpaceVelocity *= (d >= 0.99) ? 0. : 1.;
//        screenSpaceVelocity *= abs(d-previousDepth) > 0.01 ? 0. : 1.;
//        screenSpaceVelocity *= 0.;

        // todo add velocity scale also
        #if BACKGROUND_TAA
        gl_FragColor = computeTAA(vUv, screenSpaceVelocity * edgef, edgef);
        #else
        gl_FragColor = computeTAA(vUv, screenSpaceVelocity, 1.);
        #endif

//        gl_FragColor = firstFrame /* || previousDepth > 0.999*/ ? currentRTTexelToLinear1(texture2D(currentRT, vUv)) : computeTAA(vUv, screenSpaceVelocity, edgef);
//        gl_FragColor = vec4(1. - max(0., (d - 0.9) * 10.0), 0., 0., 1.0);
//        gl_FragColor = vec4(10. * length(screenSpaceVelocity));
//        gl_FragColor = vec4(abs(d-previousDepth) > 0.1, 0., 0., 1.);
//        gl_FragColor = vec4(abs(d-previousDepth) > 0.1, 0., 0., 1.);

    }

    #include <colorspace_fragment>

    #ifdef DEBUG_VELOCITY
    float sampleViewZ = mix(-cameraNearFar.x, -cameraNearFar.y, c_frag.z);
    vec3 worldPosition = getWorldPositionFromViewZ(c_frag.xy, sampleViewZ);
    vec2 screenSpaceVelocity = computeScreenSpaceVelocity(worldPosition);
//    screenSpaceVelocity *= min(1., edgef);
    gl_FragColor = vec4(10. * length(screenSpaceVelocity), 0., 0., 1.);
    #endif

}
