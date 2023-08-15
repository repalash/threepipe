// source: http://filmicworlds.com/blog/filmic-tonemapping-operators/
#define Uncharted2Helper( x ) max( ( ( x * ( 0.15 * x + 0.10 * 0.50 ) + 0.20 * 0.02 ) / ( x * ( 0.15 * x + 0.50 ) + 0.20 * 0.30 ) ) - 0.02 / 0.30, vec3( 0.0 ) )
vec3 Uncharted2ToneMapping( vec3 color ) {
    // John Hable's filmic operator from Uncharted 2 video game
    color *= toneMappingExposure;
    return saturate( Uncharted2Helper( color ) / Uncharted2Helper( vec3( 1.0 ) ) );
}
vec3 CustomToneMapping( vec3 color ) { return Uncharted2ToneMapping( color ); }
