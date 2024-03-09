bool doTonemap = true;
#ifdef HAS_GBUFFER
doTonemap = getToneMapBit(getGBufferFlags(vUv).a) > 0;
#if TONEMAP_BACKGROUND < 1
if(isBackground) doTonemap = false;
#endif
#endif
if(doTonemap) diffuseColor = ToneMapping(diffuseColor);
