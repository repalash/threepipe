bool doTonemap = true;
#ifdef HAS_GBUFFER
#ifdef GBUFFER_HAS_FLAGS
doTonemap = getToneMapBit(getGBufferFlags(vUv).a) > 0;
#endif
#if TONEMAP_BACKGROUND < 1 // todo - || (defined(CLIP_BACKGROUND) && CLIP_BACKGROUND > 0) || defined(CLIP_BACKGROUND_FORCE)
if(isBackground) doTonemap = false; // isBackground defined in ScreenPass
#endif
#endif
if(doTonemap) diffuseColor = ToneMapping(diffuseColor);
