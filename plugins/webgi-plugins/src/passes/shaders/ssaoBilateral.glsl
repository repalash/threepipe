
uniform vec2 tDiffuseSize; //tDiffuse is the color buffer
//uniform vec2 tDiffuse2Size;
uniform vec2 bilDirection;
varying vec2 vUv;

uniform bool smoothEnabled;

uniform float edgeSharpness;

vec4 bilaterialAO(){
    vec4 color = clamp((texture2D(tDiffuse, vUv.xy)).B_SRC_ACCESSOR, 0., 5.);

    if(!smoothEnabled) return color;

    float depth; vec3 normal;
    getDepthNormal(vUv.xy, depth, normal);

    float gaussianWeights[4];
    gaussianWeights[0] = 0.153170;
    gaussianWeights[1] = 0.144893;
    gaussianWeights[2] = 0.122649;
    gaussianWeights[3] = 0.092902;

    float Z = gaussianWeights[0] + 0.03;
    vec4 final_colour = Z * color;
    vec2 nuv;
    vec4 cc; float dp; vec3 nor;  // cc is color, np is position, dp is depth, nor is normal
    vec2 direction = bilDirection / tDiffuseSize.xy;


    // -1, 1, -2, 2, -3, 3

    #pragma unroll_loop_start
    for (int i = 0; i < 6; i++){

        direction *= -1.;
        nuv = vUv + 2. * direction * float( UNROLLED_LOOP_INDEX / 2 + 1 ); // clamp to screen border
        getDepthNormal(nuv, dp, nor);

        if(dp < 0.999) {

            float normalCloseness = dot(normal, nor);
            normalCloseness *= normalCloseness;
            float normalError = (1.0 - normalCloseness) * 8.;
            float normalWeight = max((1.0 - normalError * edgeSharpness), 0.00);

            float depthWeight = max(0.0, 1.0 - edgeSharpness * 4000. * abs(depth - dp));

            float kernelWeight = gaussianWeights[UNROLLED_LOOP_INDEX / 2] + 0.03;
            float bilateralWeight = kernelWeight * depthWeight * normalWeight;

            Z += bilateralWeight;

            cc = clamp((texture2D(tDiffuse, nuv)).B_SRC_ACCESSOR, 0., 5.);// clamp(texsample(tDiffuse, float(i), float(j)), 0., 1.);
            final_colour += bilateralWeight*cc;

        }

    }
    #pragma unroll_loop_end

    final_colour /= Z;
//    final_colour.a = color.a;
    return final_colour;
}


void main() {

    vec4 ao = clamp(bilaterialAO(), vec4(0.), vec4(1.));
//    ao.a = 1.;
    gl_FragColor = ao;

}

//float normpdf(in float x, in float sigma){
//    return exp(-0.5*x*x/(sigma*sigma));
//    //    return 0.39894*exp(-0.5*x*x/(sigma*sigma))/sigma;
//}
//uniform vec4 smoothSigma; // color, depth, pixel, normal
//uniform vec4 smoothScale; // color, depth, pixel, normal
//factor = 1.;
//factor *= normpdf( length(cc-color)     * smoothScale.x, smoothSigma.x); //color
//factor *= normpdf(sqrt(abs(dp-depth))     * smoothScale.y, smoothSigma.y); //depth
//factor *= normpdf( float( i/2 + 1 )        * smoothScale.z, smoothSigma.z); //pixel distance
//factor *= normpdf((1.-dot(normal, nor)) * smoothScale.w, smoothSigma.w); //normal
//factor *= normpdf(sqrt(length(np-pos))*smoothScale.y, smoothSigma.y); // position.

