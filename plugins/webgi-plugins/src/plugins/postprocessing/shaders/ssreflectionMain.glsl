//uniform sampler2D tLastThis;

void main() {

    vec4 texel = tDiffuseTexelToLinear(texture2D( tDiffuse, vUv ));
    vec4 lastAO = tLastThisTexelToLinear(texture2D( tLastThis, vUv ));
    float depth;
    vec3 normal;
//    float alpha = opacity;
    getDepthNormal(vUv, depth, normal);

    if (depth >= 0.999) {
        discard;
    }

    float viewZ = depthToViewZ(depth);
    vec3 screenPos = vec3(vUv.x, vUv.y, viewZ);
    vec3 viewPos = screenToView3(screenPos.xy, screenPos.z);
    viewPos.z = viewZ/viewPos.z;
    vec4 ao = vec4(0.);
    //    screenPos.z += 0.001;
    ao += calculateSSR(8., screenPos, normal, 1., 0.1);
    //    ao += getSSR(0.5, normal, viewPos, -normalize(viewPos));
    //    if(radius > 0.5)
    //    ao = max(ao, calculateSSR(2., screenPos, normal, 0.4));
    //    if(radius > 1.)
    //    ao = max(ao, calculateSSR(1., screenPos, normal, 0.6));
    //    if(radius > 1.5)
    //    ao = max(ao, calculateSSR(3., screenPos, normal, 2.));


    //        ao += calculateSSR(3., screenPos, normal, 1.);
    //        ao += calculateSSR(4., screenPos, normal, 1.);
    //        ao += calculateSSR(5., screenPos, normal, 1.);
    //        ao += calculateSSR(6., screenPos, normal, 1.);
    //        ao += calculateSSR(7., screenPos, normal, 1.);
    //
    //        ao = ao / 6.;
    //        ao = ao / 3.;

    //     gl_FragColor = vec4(texel) * (1.-ao);

    //    ao = ao;
    //    ao *= intensity/1.;

    ao.rgb = min(vec3(3.), ao.rgb);
    ao.rgb = max(vec3(0.), ao.rgb);

    if(currentFrameCount < 2.){
        gl_FragColor = ao;
        return;
    }
    if(ao.a < 0.01){
        gl_FragColor.rgb = lastAO.rgb;
        gl_FragColor.a = (((lastAO.a) * currentFrameCount)/(currentFrameCount+1.));
    }else {
        gl_FragColor = ((ao + (lastAO) * currentFrameCount)/(currentFrameCount+1.));
    }
    //    gl_FragColor = ((ao + (lastAO) * currentFrameCount)/(currentFrameCount+1.));
    //    gl_FragColor.r = ((ao.a + (lastAO.r) * currentFrameCount)/(currentFrameCount+1.));
    //    gl_FragColor.g = power/10.;
    //    gl_FragColor.rgb = texel.rgb;
    //    gl_FragColor.a = ((texel.a + (lastAO.a) * currentFrameCount)/(currentFrameCount+1.));
    //    gl_FragColor.a = 1.;
    //     gl_FragColor = texel;

    #include <colorspace_fragment>

}
