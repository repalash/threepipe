#if defined(ROUGHNESS_MASK_ENABLED) && ROUGHNESS_MASK_ENABLED > 0

// MaterialX <mix> is out = fg * mix + bg * (1 - mix), so fg(max) maps to mask = 1.
roughnessFactor = mix(roughnessMaskMin, roughnessMaskMax, texture2D(roughnessMaskMap, vRoughnessMaskUv).ROUGHNESS_MASK_CHANNEL);

#endif
