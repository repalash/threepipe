import {MeshStandardMaterial2, PhysicalMaterial} from '../core'
import {Object3D, Texture} from 'three'

// todo needs testing with some more files maybe
export function legacySeparateMapSamplerUVFix(config: any, objs: Object3D[]) {
    const version = (config.version ? config.version as string : '0.0.0').split('.').map(v => parseInt(v))
    // separate texture map sampler properties added for materials in this version.
    if (!(config.type === 'ViewerApp' && version[0] === 0 && (version[1] < 7 || version[1] === 7 && version[2].toString()[0] < '6'))) {
        return
    }
    const materials = new Set<any>()
    objs.forEach(o1 => o1.traverse((o: any) => {
        if (o.material) materials.add(o.material)
    }))
    materials.forEach(material => {
        const map = material.map as Texture
        if (!map) return
        const repeat = map.repeat
        const offset = map.offset
        const center = map.center
        const rotation = map.rotation
        const others: ((keyof MeshStandardMaterial2) | (keyof PhysicalMaterial))[] = ['alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'transmissionMap']
        others.forEach(k => {
            const m = material[k] as Texture
            if (m) {
                m.repeat.copy(repeat)
                m.offset.copy(offset)
                m.center.copy(center)
                m.rotation = rotation
                m.needsUpdate = true
            }
        })
        material.needsUpdate = true
    })
}
