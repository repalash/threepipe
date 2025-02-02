float fragClippingDist = 0.0;
#if FRAG_CLIPPING_MODE == FragmentClippingMode.Circle
fragClippingDist = fragClippingCircle();
#elif FRAG_CLIPPING_MODE == FragmentClippingMode.Ellipse
fragClippingDist = fragClippingEllipse();
#elif FRAG_CLIPPING_MODE == FragmentClippingMode.Rectangle
fragClippingDist = fragClippingRectangle();
#elif FRAG_CLIPPING_MODE == FragmentClippingMode.Plane
fragClippingDist = fragClippingPlane();
#elif FRAG_CLIPPING_MODE == FragmentClippingMode.Sphere
fragClippingDist = fragClippingSphere();
#endif
#if FRAG_CLIPPING_DEBUG
gl_FragColor = vec4(max(fragClippingDist, 0.0), 0.0, 0.0, 1.0);
//    gl_FragColor = vec4(vViewPosition.xyz, 1.0);
#include <colorspace_fragment>
return;
#endif

#if FRAG_CLIPPING_INVERSE == 1
if (fragClippingDist > 0.0) discard;
#else
if (fragClippingDist < 0.0) discard;
#endif
