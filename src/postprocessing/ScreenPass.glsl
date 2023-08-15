#include <packing>

varying vec2 vUv;

#include <alphatest_pars_fragment>

void main() {

    vec4 diffuseColor = tDiffuseTexelToLinear (texture2D(tDiffuse, vUv));

    #ifdef HAS_TRANSPARENT_TARGET
    vec4 transparentColor = tTransparentTexelToLinear (texture2D(tTransparent, vUv));
    #else
    vec4 transparentColor = vec4(0.0);
    #endif

    #ifdef HAS_GBUFFER
    float depth = getDepth(vUv);
    bool isBackground = depth>0.99 && transparentColor.a < 0.001;
    #endif

    #glMarker

    #ifdef HAS_GBUFFER

        #ifdef CLIP_BACKGROUND
            if(isBackground) diffuseColor.a = 0.0;
            if(depth>0.99 && transparentColor.a >= 0.001) diffuseColor.a = transparentColor.a;
        #endif

        if(depth < 0.00001) diffuseColor.a = 0.0;

    #endif

    #include <alphatest_fragment>
    #ifdef OPAQUE
    diffuseColor.a = 1.0;
    #endif
    gl_FragColor = diffuseColor;
    //gl_FragColor = isBackground ? vec4(0, 0, 0, 1) : gl_FragColor;
//    gl_FragColor = vec4(depth, 0, 0, 1);
    #include <encodings_fragment>
}
