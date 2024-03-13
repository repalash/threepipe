bool doTonemap = true;
#ifdef HAS_GBUFFER
#ifdef GBUFFER_HAS_FLAGS
doTonemap = getToneMapBit(getGBufferFlags(vUv).a) > 0;
#endif
#if TONEMAP_BACKGROUND < 1
if(isBackground) doTonemap = false; // isBackground defined in ScreenPass
#endif
#endif
if(doTonemap) diffuseColor = ToneMapping(diffuseColor);
