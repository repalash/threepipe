// <packing> of three.js, once in a shader. The material shaders of three.js do not include it since r182, so a material
// extension that uses its functions (unpackRGBAToDepth, perspectiveDepthToViewZ, ...) includes this.
// A shader that includes <packing> itself defines THREE_PACKING_INCLUDED after it.
#ifndef THREE_PACKING_INCLUDED
#define THREE_PACKING_INCLUDED
#include <packing>
#endif
