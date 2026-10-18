/**
 * Material presets for product surfaces (16-realism.md §5). Values are the area-weighted looks measured on the
 * realism benchmark's reference (§1.4: base colour, roughness, metalness, transmission, and which surfaces carry a
 * tiling relief map), named by what they are rather than by that file's slot names.
 */
import type {SurfacePattern} from './textures'

export interface MaterialPreset {
    color: string
    roughness: number
    metalness: number
    transmission?: number
    ior?: number
    thickness?: number
    opacity?: number
    emissive?: string
    emissiveIntensity?: number
    /** Tiling relief: the pattern, its normal-map strength. One texture tile = one UV unit (see `uv`). */
    relief?: {pattern: SurfacePattern, strength: number}
}

const lin = (v: number) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    return Math.round(Math.max(0, Math.min(1, c)) * 255)
}
/** A linear base-colour grey as a CSS colour (CSS colours are sRGB). */
const grey = (v: number) => { const h = lin(v).toString(16).padStart(2, '0'); return `#${h}${h}${h}` }

export const MATERIAL_PRESETS: Record<string, MaterialPreset> = {
    'plastic-satin-black': {color: grey(0.007), roughness: 0.23, metalness: 0, relief: {pattern: 'grain', strength: 0.15}},
    'plastic-gloss-black': {color: grey(0.004), roughness: 0.22, metalness: 0},
    'rubber': {color: grey(0.006), roughness: 0.30, metalness: 0, relief: {pattern: 'rubber', strength: 0.25}},
    'rubber-matte': {color: grey(0.006), roughness: 0.56, metalness: 0, relief: {pattern: 'rubber', strength: 0.3}},
    'leather-black': {color: grey(0.016), roughness: 0.53, metalness: 0, relief: {pattern: 'leather', strength: 0.4}},
    'matte-black': {color: grey(0.004), roughness: 0.74, metalness: 0},
    'metal-dark': {color: grey(0.068), roughness: 0.23, metalness: 0.93},
    'chrome': {color: grey(0.507), roughness: 0.23, metalness: 1},
    'metal-satin': {color: grey(0.45), roughness: 0.35, metalness: 1},
    'gold-contact': {color: '#e5b75a', roughness: 0.25, metalness: 1},
    'glass': {color: '#ffffff', roughness: 0, metalness: 0, transmission: 1, ior: 1.5, thickness: 2},
    // a coated optical element: clear, a faint cool tint; what shows is its reflection and the dark lens behind it
    'glass-coated': {color: '#e6eef5', roughness: 0.02, metalness: 0, transmission: 1, ior: 1.6, thickness: 4},
    'screen-glass': {color: '#0b0d10', roughness: 0.14, metalness: 0, transmission: 0.58, ior: 1.5},
    'accent-red': {color: '#e74533', roughness: 0.5, metalness: 0},
    'gap-black': {color: '#000000', roughness: 1, metalness: 0},
    'print-white': {color: '#f2f2f2', roughness: 0.5, metalness: 0},
}
