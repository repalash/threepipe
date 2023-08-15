#if defined(HAS_DEPTH_BUFFER)
#if DEPTH_PACKING == 3200
#define unpackDepth(rgba_depth) (1.0 - rgba_depth.r)
#elif DEPTH_PACKING == 3201
#define unpackDepth(rgba_depth) unpackRGBAToDepth(rgba_depth)
#endif
uniform sampler2D tDepthBuffer;
#define getDepth(uv) unpackDepth(texture2D(tDepthBuffer, uv))
#endif

